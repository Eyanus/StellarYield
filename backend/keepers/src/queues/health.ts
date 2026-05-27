import { Queue } from 'bullmq';

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
  status: 'healthy' | 'warning';
  warnings: string[];
}

export interface QueueHealthSummary {
  queues: QueueHealthEntry[];
  overallStatus: 'healthy' | 'warning';
  timestamp: string;
}

export const QUEUE_HEALTH_THRESHOLDS = {
  failed: Number(process.env.QUEUE_FAILED_THRESHOLD ?? '10'),
  delayed: Number(process.env.QUEUE_DELAYED_THRESHOLD ?? '50'),
} as const;

export async function getQueueHealth(queues: Queue[]): Promise<QueueHealthSummary> {
  const entries = await Promise.all(
    queues.map(async (queue): Promise<QueueHealthEntry> => {
      const raw = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      const counts: QueueJobCounts = {
        waiting: raw.waiting ?? 0,
        active: raw.active ?? 0,
        completed: raw.completed ?? 0,
        failed: raw.failed ?? 0,
        delayed: raw.delayed ?? 0,
      };

      const warnings: string[] = [];
      if (counts.failed > QUEUE_HEALTH_THRESHOLDS.failed) {
        warnings.push(
          `failed jobs (${counts.failed}) exceed threshold (${QUEUE_HEALTH_THRESHOLDS.failed})`,
        );
      }
      if (counts.delayed > QUEUE_HEALTH_THRESHOLDS.delayed) {
        warnings.push(
          `delayed jobs (${counts.delayed}) exceed threshold (${QUEUE_HEALTH_THRESHOLDS.delayed})`,
        );
      }

      return {
        name: queue.name,
        counts,
        status: warnings.length > 0 ? 'warning' : 'healthy',
        warnings,
      };
    }),
  );

  return {
    queues: entries,
    overallStatus: entries.some((e) => e.status === 'warning') ? 'warning' : 'healthy',
    timestamp: new Date().toISOString(),
  };
}
