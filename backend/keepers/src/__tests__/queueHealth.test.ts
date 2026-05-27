import { getQueueHealth, QUEUE_HEALTH_THRESHOLDS } from '../queues/health';
import type { Queue } from 'bullmq';

function makeQueue(name: string, counts: Record<string, number>): Queue {
  return {
    name,
    getJobCounts: jest.fn().mockResolvedValue(counts),
  } as unknown as Queue;
}

describe('getQueueHealth', () => {
  it('returns healthy status when all counts are below thresholds', async () => {
    const queues = [
      makeQueue('liquidation', { waiting: 2, active: 1, completed: 50, failed: 0, delayed: 0 }),
      makeQueue('compound', { waiting: 0, active: 0, completed: 10, failed: 1, delayed: 3 }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.overallStatus).toBe('healthy');
    expect(summary.queues).toHaveLength(2);
    expect(summary.queues[0].status).toBe('healthy');
    expect(summary.queues[0].warnings).toHaveLength(0);
    expect(summary.queues[1].status).toBe('healthy');
  });

  it('returns warning when failed jobs exceed threshold', async () => {
    const failedCount = QUEUE_HEALTH_THRESHOLDS.failed + 1;
    const queues = [
      makeQueue('liquidation', { waiting: 0, active: 0, completed: 0, failed: failedCount, delayed: 0 }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.overallStatus).toBe('warning');
    expect(summary.queues[0].status).toBe('warning');
    expect(summary.queues[0].warnings).toHaveLength(1);
    expect(summary.queues[0].warnings[0]).toMatch(/failed jobs/);
  });

  it('returns warning when delayed jobs exceed threshold', async () => {
    const delayedCount = QUEUE_HEALTH_THRESHOLDS.delayed + 1;
    const queues = [
      makeQueue('compound', { waiting: 0, active: 0, completed: 0, failed: 0, delayed: delayedCount }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.overallStatus).toBe('warning');
    expect(summary.queues[0].status).toBe('warning');
    expect(summary.queues[0].warnings[0]).toMatch(/delayed jobs/);
  });

  it('emits two warnings when both failed and delayed exceed thresholds', async () => {
    const queues = [
      makeQueue('liquidation', {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: QUEUE_HEALTH_THRESHOLDS.failed + 5,
        delayed: QUEUE_HEALTH_THRESHOLDS.delayed + 10,
      }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.queues[0].warnings).toHaveLength(2);
  });

  it('sets overallStatus to warning when at least one queue warns', async () => {
    const queues = [
      makeQueue('liquidation', { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
      makeQueue('compound', {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: QUEUE_HEALTH_THRESHOLDS.failed + 1,
        delayed: 0,
      }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.queues[0].status).toBe('healthy');
    expect(summary.queues[1].status).toBe('warning');
    expect(summary.overallStatus).toBe('warning');
  });

  it('includes all five count fields in each entry', async () => {
    const queues = [
      makeQueue('liquidation', { waiting: 3, active: 2, completed: 100, failed: 1, delayed: 4 }),
    ];

    const summary = await getQueueHealth(queues);

    expect(summary.queues[0].counts).toEqual({
      waiting: 3,
      active: 2,
      completed: 100,
      failed: 1,
      delayed: 4,
    });
  });

  it('defaults missing count fields to 0', async () => {
    const queues = [makeQueue('liquidation', {})];

    const summary = await getQueueHealth(queues);

    expect(summary.queues[0].counts).toEqual({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    });
  });

  it('includes a valid ISO timestamp', async () => {
    const before = Date.now();
    const summary = await getQueueHealth([makeQueue('liquidation', {})]);
    const after = Date.now();

    const ts = new Date(summary.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('returns results for an empty queue list', async () => {
    const summary = await getQueueHealth([]);
    expect(summary.queues).toHaveLength(0);
    expect(summary.overallStatus).toBe('healthy');
  });
});
