import { describe, expect, it } from 'vitest';
import { SfxConcurrencyLimiter } from './AudioManager';

describe('SfxConcurrencyLimiter', () => {
  it('enforces maxConcurrent cap, queues overflow, drops stale queued requests, and steals for high priority', () => {
    const limiter = new SfxConcurrencyLimiter({
      maxConcurrent: 2,
      maxQueueSize: 2,
      staleAfterMs: 150,
    });

    const first = limiter.requestPlay('step_1', 100);
    const second = limiter.requestPlay('step_2', 110);
    expect(first.status).toBe('play');
    expect(second.status).toBe('play');
    expect(limiter.getActiveCount()).toBe(2);

    // 3rd normal-priority sound queues instead of exceeding cap
    expect(limiter.requestPlay('stale_click', 120).status).toBe('queued');
    expect(limiter.requestPlay('fresh_click', 250).status).toBe('queued');
    expect(limiter.getQueuedCount()).toBe(2);

    // Release at t=300ms: 'stale_click' (age 180ms > 150ms) is dropped; 'fresh_click' (age 50ms) plays
    const firstId = first.status === 'play' ? first.instanceId : -1;
    const dequeued = limiter.release(firstId, 300);
    expect(dequeued?.soundId).toBe('fresh_click');
    expect(limiter.getActiveCount()).toBe(2);

    // High-priority SFX steals the oldest active slot instead of queueing
    const high = limiter.requestPlay('ui_alert', 310, 1);
    expect(high.status).toBe('play');
    if (high.status === 'play') {
      expect(high.stolenInstanceId).toBeDefined();
    }
    expect(limiter.getActiveCount()).toBe(2);
  });
});
