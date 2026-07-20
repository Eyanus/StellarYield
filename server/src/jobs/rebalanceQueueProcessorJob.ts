import {
  PartialFillConfig,
  RebalanceExecutionResult,
  RebalanceQueueEntryDTO,
  rebalanceQueueService,
} from '../services/rebalanceQueueService';

/**
 * Rebalance Queue Processor Job
 *
 * Processes items from the rebalance queue:
 * - Handles retries of failed executions
 * - Processes deferred entries when ready
 * - Manages partial fills and follow-ups
 * - Prevents replay of stale intents
 *
 * Can be triggered via cron schedule or called directly.
 */

export interface JobConfig {
  enabled: boolean;
  schedule?: string; // Cron expression (optional if triggered manually)
  batchSize: number; // Process N items per job run
  enableRetries: boolean;
  enableDeferredProcessing: boolean;
  partialFillConfig?: Partial<PartialFillConfig>;
  logResults: boolean;
}

export interface RebalanceQueueProcessorService {
  getPendingRetries(): Promise<RebalanceQueueEntryDTO[]>;
  getDeferredEntries(): Promise<RebalanceQueueEntryDTO[]>;
  markAsProcessing(queueEntryId: string): Promise<RebalanceQueueEntryDTO>;
  recordPartialExecution(
    queueEntryId: string,
    result: RebalanceExecutionResult,
    config?: Partial<PartialFillConfig>,
  ): Promise<RebalanceQueueEntryDTO>;
  recordFailedAttempt(
    queueEntryId: string,
    error: string,
    config?: Partial<PartialFillConfig>,
  ): Promise<RebalanceQueueEntryDTO>;
}

export interface RebalanceQueueProcessorDependencies {
  queueService?: RebalanceQueueProcessorService;
  executeRebalance?: (
    entry: RebalanceQueueEntryDTO,
  ) => Promise<RebalanceExecutionResult>;
  now?: () => number;
}

const REBALANCE_RESULT_MAX_AGE_MS = Number(
  process.env.REBALANCE_RESULT_MAX_AGE_MS ?? 2 * 60 * 1000,
);

let jobHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the rebalance queue processor job.
 * Runs on an interval to process pending and deferred items.
 */
export function startRebalanceQueueProcessorJob(
  config: Partial<JobConfig> = {},
): void {
  const finalConfig: JobConfig = {
    enabled: config.enabled !== false,
    batchSize: config.batchSize ?? 10,
    enableRetries: config.enableRetries !== false,
    enableDeferredProcessing: config.enableDeferredProcessing !== false,
    partialFillConfig: config.partialFillConfig,
    logResults: config.logResults !== false,
  };

  if (!finalConfig.enabled) {
    console.log('Rebalance queue processor job is disabled');
    return;
  }

  // Run job every 30 seconds
  const intervalMs = 30000;
  console.log(
    `Starting rebalance queue processor job (interval: ${intervalMs}ms, batch size: ${finalConfig.batchSize})`,
  );

  jobHandle = setInterval(async () => {
    try {
      await runRebalanceQueueProcessorJob(finalConfig);
    } catch (error) {
      console.error('Rebalance queue processor job failed:', error);
    }
  }, intervalMs);
}

/**
 * Stop the rebalance queue processor job.
 */
export function stopRebalanceQueueProcessorJob(): void {
  if (jobHandle) {
    clearInterval(jobHandle);
    jobHandle = null;
    console.log('Rebalance queue processor job stopped');
  }
}

/**
 * Run the rebalance queue processor job.
 * Processes retries, deferred items, and handles failures.
 */
export async function runRebalanceQueueProcessorJob(
  config: JobConfig,
  deps?: RebalanceQueueProcessorDependencies,
): Promise<{
  success: boolean;
  processedRetries: number;
  processedDeferred: number;
  failedProcessing: number;
  timestamp: string;
}>;
export async function runRebalanceQueueProcessorJob(
  config: JobConfig,
  deps: RebalanceQueueProcessorDependencies = {},
): Promise<{
  success: boolean;
  processedRetries: number;
  processedDeferred: number;
  failedProcessing: number;
  timestamp: string;
}> {
  const startTime = Date.now();
  let processedRetries = 0;
  let processedDeferred = 0;
  let failedProcessing = 0;
  const queueService = deps.queueService ?? rebalanceQueueService;

  try {
    // Process retries
    if (config.enableRetries) {
      const pendingRetries = await queueService.getPendingRetries();
      const toProcess = pendingRetries.slice(0, config.batchSize);

      if (config.logResults && toProcess.length > 0) {
        console.log(`Processing ${toProcess.length} pending retries...`);
      }

      for (const entry of toProcess) {
        try {
          await processQueueEntry(entry, config, deps);
          processedRetries++;
        } catch (error) {
          console.error(`Failed to process retry for entry ${entry.id}:`, error);
          failedProcessing++;

          // Record the failure
          await queueService.recordFailedAttempt(
            entry.id,
            `Job processing failed: ${error instanceof Error ? error.message : String(error)}`,
            config.partialFillConfig,
          );
        }
      }
    }

    // Process deferred items
    if (config.enableDeferredProcessing) {
      const deferredEntries = await queueService.getDeferredEntries();
      const toProcess = deferredEntries.slice(0, config.batchSize);

      if (config.logResults && toProcess.length > 0) {
        console.log(`Processing ${toProcess.length} deferred entries...`);
      }

      for (const entry of toProcess) {
        try {
          await processQueueEntry(entry, config, deps);
          processedDeferred++;
        } catch (error) {
          console.error(`Failed to process deferred entry ${entry.id}:`, error);
          failedProcessing++;

          // Record the failure
          await queueService.recordFailedAttempt(
            entry.id,
            `Job processing failed: ${error instanceof Error ? error.message : String(error)}`,
            config.partialFillConfig,
          );
        }
      }
    }

    if (config.logResults) {
      const elapsed = Date.now() - startTime;
      console.log(
        `Rebalance queue processor job completed: ` +
        `${processedRetries} retries, ${processedDeferred} deferred, ` +
        `${failedProcessing} failed (${elapsed}ms)`,
      );
    }

    return {
      success: failedProcessing === 0,
      processedRetries,
      processedDeferred,
      failedProcessing,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Rebalance queue processor job error:', error);
    return {
      success: false,
      processedRetries,
      processedDeferred,
      failedProcessing,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Process a single queue entry.
 * This is where the actual rebalance execution would be called.
 */
async function processQueueEntry(
  entry: RebalanceQueueEntryDTO,
  config: JobConfig,
  deps: RebalanceQueueProcessorDependencies,
): Promise<void> {
  const queueService = deps.queueService ?? rebalanceQueueService;
  const executeRebalance = deps.executeRebalance ?? defaultExecuteRebalance;
  const now = deps.now ?? Date.now;

  // Mark as processing
  await queueService.markAsProcessing(entry.id);

  const executionResult = await executeRebalance(entry);
  validateExecutionResult(executionResult, now());

  // Record execution result
  await queueService.recordPartialExecution(
    entry.id,
    executionResult,
    config.partialFillConfig,
  );
}

function defaultExecuteRebalance(
  entry: RebalanceQueueEntryDTO,
): Promise<RebalanceExecutionResult> {
  return Promise.resolve({
    queueEntryId: entry.id,
    totalExecuted: 100,
    expectedAmount: 100,
    filledPercentage: 100,
    transactionHash: `0x${Math.random().toString(16).slice(2)}`,
    executionDetails: {
      status: 'completed',
      allocationsAdjusted: entry.targetAllocations,
      timestamp: new Date().toISOString(),
    },
  });
}

function validateExecutionResult(
  result: RebalanceExecutionResult,
  now: number,
): void {
  if (!result || typeof result !== 'object') {
    throw new Error('Malformed rebalance execution result.');
  }

  if (typeof result.queueEntryId !== 'string' || result.queueEntryId.length === 0) {
    throw new Error('Malformed rebalance execution result: missing queueEntryId.');
  }

  if (
    !Number.isFinite(result.totalExecuted) ||
    !Number.isFinite(result.expectedAmount) ||
    !Number.isFinite(result.filledPercentage)
  ) {
    throw new Error('Malformed rebalance execution result: numeric fields are invalid.');
  }

  if (
    result.filledPercentage < 0 ||
    result.filledPercentage > 100
  ) {
    throw new Error('Malformed rebalance execution result: filledPercentage must be between 0 and 100.');
  }

  const executionDetails =
    result.executionDetails && typeof result.executionDetails === 'object'
      ? (result.executionDetails as Record<string, unknown>)
      : null;

  if (!executionDetails) {
    throw new Error('Malformed rebalance execution result: executionDetails missing.');
  }

  const rawTimestamp = executionDetails.timestamp ?? executionDetails.executedAt;
  if (rawTimestamp !== undefined) {
    const parsedTimestamp =
      rawTimestamp instanceof Date
        ? rawTimestamp.getTime()
        : typeof rawTimestamp === 'string'
          ? new Date(rawTimestamp).getTime()
          : Number.NaN;

    if (!Number.isFinite(parsedTimestamp)) {
      throw new Error('Malformed rebalance execution result: invalid execution timestamp.');
    }

    if (now - parsedTimestamp > REBALANCE_RESULT_MAX_AGE_MS) {
      throw new Error('Stale rebalance execution result received from upstream executor.');
    }
  }
}

/**
 * Manually trigger queue processing for testing/admin purposes.
 */
export async function triggerQueueProcessing(
  batchSize = 10,
): Promise<{
  retries: number;
  deferred: number;
  failed: number;
}> {
  const result = await runRebalanceQueueProcessorJob({
    enabled: true,
    batchSize,
    enableRetries: true,
    enableDeferredProcessing: true,
    logResults: true,
  });

  return {
    retries: result.processedRetries,
    deferred: result.processedDeferred,
    failed: result.failedProcessing,
  };
}
