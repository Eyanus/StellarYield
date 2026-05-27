import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Horizon, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const router = Router();
const prisma = new PrismaClient();

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? "5000");
const _INDEXER_LAG_WARN_THRESHOLD = Number(process.env.INDEXER_LAG_WARN_LEDGERS ?? "50");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_FAILED_THRESHOLD = Number(process.env.QUEUE_FAILED_THRESHOLD ?? "10");
const QUEUE_DELAYED_THRESHOLD = Number(process.env.QUEUE_DELAYED_THRESHOLD ?? "50");

const ALL_QUEUE_NAMES = [
  "liquidation",
  "compound",
  "digest-generation",
  "digest-threshold-check",
  "rebalance-execution",
  "rebalance-retry",
];

type ComponentStatus = "up" | "down" | "warning";
type QueueStatus = "healthy" | "warning" | "error";

export interface QueueJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface QueueHealthEntry {
  name: string;
  counts: QueueJobCounts;
  status: QueueStatus;
  warnings: string[];
}

export interface QueueHealthSummary {
  queues: QueueHealthEntry[];
  overallStatus: QueueStatus;
  timestamp: string;
}

export type HealthStatus = {
  database: ComponentStatus;
  horizon: ComponentStatus;
  sorobanRpc: ComponentStatus;
  indexer: ComponentStatus;
  timestamp: string;
  latestLedger?: number;
  syncedLedger?: number;
  indexerLag?: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS);
    return "up";
  } catch {
    return "down";
  }
}

async function checkHorizon(): Promise<{
  status: ComponentStatus;
  latestLedger?: number;
}> {
  try {
    const horizon = new Horizon.Server(HORIZON_URL);
    const resp = await withTimeout(
      horizon.ledgers().limit(1).order("desc").call(),
      HEALTH_TIMEOUT_MS,
    );
    return { status: "up", latestLedger: resp.records[0]?.sequence };
  } catch {
    return { status: "down" };
  }
}

async function checkSorobanRpc(): Promise<ComponentStatus> {
  try {
    const server = new SorobanRpc.Server(SOROBAN_RPC_URL);
    await withTimeout(server.getNetwork(), HEALTH_TIMEOUT_MS);
    return "up";
  } catch {
    return "down";
  }
}

async function checkIndexer(
  _latestLedger?: number,
): Promise<{
  status: ComponentStatus;
  syncedLedger?: number;
  lag?: number;
}> {
  try {
    const state = await prisma.indexerState.findFirst();
    const syncedLedger = state?.lastLedger ?? 0;
    const lag = _latestLedger ? _latestLedger - syncedLedger : undefined;

    if (!lag || lag < 50) {
      return { status: "up", syncedLedger, lag };
    } else {
      return { status: "warning", syncedLedger, lag };
    }
  } catch {
    return { status: "down" };
  }
}

router.get("/", async (_req: Request, res: Response) => {
  const [dbStatus, horizonResult, rpcStatus] = await Promise.all([
    checkDatabase(),
    checkHorizon(),
    checkSorobanRpc(),
  ]);

  const indexerResult = await checkIndexer(horizonResult.latestLedger);

  const body: HealthStatus = {
    database: dbStatus,
    horizon: horizonResult.status,
    sorobanRpc: rpcStatus,
    indexer: indexerResult.status,
    timestamp: new Date().toISOString(),
    latestLedger: horizonResult.latestLedger,
    syncedLedger: indexerResult.syncedLedger,
    indexerLag: indexerResult.lag,
  };

  const isHealthy = (
    ["database", "horizon", "sorobanRpc", "indexer"] as const
  ).every((k) => body[k] !== "down");

  res.status(isHealthy ? 200 : 503).json(body);
});

router.get("/queues", async (_req: Request, res: Response) => {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  try {
    const entries: QueueHealthEntry[] = await Promise.all(
      ALL_QUEUE_NAMES.map(async (name): Promise<QueueHealthEntry> => {
        const queue = new Queue(name, { connection: redis });
        try {
          const raw = await withTimeout(
            queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
            HEALTH_TIMEOUT_MS,
          );
          const counts: QueueJobCounts = {
            waiting: raw.waiting ?? 0,
            active: raw.active ?? 0,
            completed: raw.completed ?? 0,
            failed: raw.failed ?? 0,
            delayed: raw.delayed ?? 0,
          };
          const warnings: string[] = [];
          if (counts.failed > QUEUE_FAILED_THRESHOLD) {
            warnings.push(
              `failed jobs (${counts.failed}) exceed threshold (${QUEUE_FAILED_THRESHOLD})`,
            );
          }
          if (counts.delayed > QUEUE_DELAYED_THRESHOLD) {
            warnings.push(
              `delayed jobs (${counts.delayed}) exceed threshold (${QUEUE_DELAYED_THRESHOLD})`,
            );
          }
          return {
            name,
            counts,
            status: warnings.length > 0 ? "warning" : "healthy",
            warnings,
          };
        } catch {
          return {
            name,
            counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            status: "error",
            warnings: ["failed to fetch job counts"],
          };
        } finally {
          await queue.close();
        }
      }),
    );

    const overallStatus: QueueStatus = entries.some((e) => e.status === "error")
      ? "error"
      : entries.some((e) => e.status === "warning")
        ? "warning"
        : "healthy";

    const body: QueueHealthSummary = { queues: entries, overallStatus, timestamp: new Date().toISOString() };
    res.status(overallStatus === "error" ? 503 : 200).json(body);
  } finally {
    await redis.quit().catch(() => {});
  }
});

export default router;
