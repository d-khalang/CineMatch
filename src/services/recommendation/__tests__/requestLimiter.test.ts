import { describe, it, expect } from 'vitest';
import {
  RequestLimiter,
  MAX_CONCURRENCY,
  MAX_REQUESTS,
} from '../requestLimiter';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RequestLimiter', () => {
  it('exports unchanged default constants MAX_CONCURRENCY (6) and MAX_REQUESTS (45)', () => {
    expect(MAX_CONCURRENCY).toBe(6);
    expect(MAX_REQUESTS).toBe(45);
  });

  describe('request cap', () => {
    it('executes up to MAX_REQUESTS (45) by default and returns null for excess tasks', async () => {
      const limiter = new RequestLimiter();
      let executed = 0;

      const results = await Promise.all(
        Array.from({ length: 60 }, (_, idx) =>
          limiter.schedule(async () => {
            executed++;
            return idx;
          })
        )
      );

      expect(executed).toBe(45);
      expect(limiter.totalExecuted).toBe(45);
      expect(results.filter((r) => r !== null)).toHaveLength(45);
      expect(results.filter((r) => r === null)).toHaveLength(15);
    });

    it('enforces maxRequests across queued waiters without exceeding the cap', async () => {
      const limiter = new RequestLimiter(undefined, 2, 3);
      const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
      const ran: number[] = [];

      const promises = Array.from({ length: 6 }, (_, idx) =>
        limiter.schedule(async () => {
          ran.push(idx);
          if (idx < gates.length) {
            return await gates[idx].promise;
          }
          return `unexpected-${idx}`;
        })
      );

      // Tasks 0 and 1 start immediately; 2..5 queue behind concurrency cap 2
      expect(ran).toEqual([0, 1]);
      expect(limiter.inFlight).toBe(2);
      expect(limiter.totalExecuted).toBe(2);

      gates[0].resolve('r0');
      gates[1].resolve('r1');
      await Promise.resolve();
      await Promise.resolve();

      // Task 2 runs to reach maxRequests=3; queued tasks 3..5 must resolve to null without running
      gates[2].resolve('r2');
      const results = await Promise.all(promises);

      expect(ran).toEqual([0, 1, 2]);
      expect(limiter.totalExecuted).toBe(3);
      expect(limiter.inFlight).toBe(0);
      expect(results).toEqual(['r0', 'r1', 'r2', null, null, null]);
    });

    it('counts rejected tasks against maxRequests and releases their slot', async () => {
      const limiter = new RequestLimiter(undefined, 1, 2);

      const first = limiter.schedule(async () => {
        throw new Error('boom');
      });
      const second = limiter.schedule(async () => 'ok');
      const third = limiter.schedule(async () => 'over-budget');

      await expect(first).rejects.toThrow('boom');
      expect(await second).toBe('ok');
      expect(await third).toBeNull();
      expect(limiter.totalExecuted).toBe(2);
      expect(limiter.inFlight).toBe(0);
    });

    it('returns null without running when maxRequests is 0', async () => {
      const limiter = new RequestLimiter(undefined, 2, 0);
      let called = false;

      const result = await limiter.schedule(async () => {
        called = true;
        return 'never';
      });

      expect(result).toBeNull();
      expect(called).toBe(false);
      expect(limiter.totalExecuted).toBe(0);
      expect(limiter.inFlight).toBe(0);
    });

    it('releases its slot and wakes queued waiters if a task throws synchronously', async () => {
      const controller = new AbortController();
      const limiter = new RequestLimiter(controller.signal, 1, 3);

      const syncThrow = limiter.schedule((() => {
        throw new Error('sync boom');
      }) as () => Promise<string>);
      const queued = limiter.schedule(async () => 'recovered');

      await expect(syncThrow).rejects.toThrow('sync boom');
      expect(await queued).toBe('recovered');
      expect(limiter.totalExecuted).toBe(2);
      expect(limiter.inFlight).toBe(0);
    });
  });

  describe('in-flight cap', () => {
    it('caps concurrent execution at maxConcurrency and drains waiters in order', async () => {
      const limiter = new RequestLimiter(undefined, 3, 20);
      let active = 0;
      let peakActive = 0;
      let peakReportedInFlight = 0;
      const startOrder: number[] = [];

      const results = await Promise.all(
        Array.from({ length: 12 }, (_, idx) =>
          limiter.schedule(async () => {
            startOrder.push(idx);
            active++;
            peakActive = Math.max(peakActive, active);
            peakReportedInFlight = Math.max(peakReportedInFlight, limiter.inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active--;
            return idx * 2;
          })
        )
      );

      expect(peakActive).toBe(3);
      expect(peakReportedInFlight).toBe(3);
      expect(limiter.inFlight).toBe(0);
      expect(limiter.totalExecuted).toBe(12);
      expect(startOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(results).toEqual(Array.from({ length: 12 }, (_, idx) => idx * 2));
    });

    it('respects the default in-flight cap of 6', async () => {
      const limiter = new RequestLimiter();
      let active = 0;
      let peak = 0;

      await Promise.all(
        Array.from({ length: 20 }, () =>
          limiter.schedule(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 8));
            active--;
          })
        )
      );

      expect(peak).toBeLessThanOrEqual(6);
      expect(peak).toBe(6);
      expect(limiter.inFlight).toBe(0);
    });
  });

  describe('abort', () => {
    it('rejects immediately when given a pre-aborted AbortSignal without invoking the task', async () => {
      const controller = new AbortController();
      const reason = new DOMException('Pre-aborted', 'AbortError');
      controller.abort(reason);

      const limiter = new RequestLimiter(controller.signal, 6, 45);
      let called = false;

      await expect(
        limiter.schedule(async () => {
          called = true;
          return 'never';
        })
      ).rejects.toBe(reason);

      expect(called).toBe(false);
      expect(limiter.totalExecuted).toBe(0);
      expect(limiter.inFlight).toBe(0);
    });

    it('rejects in-flight and queued tasks immediately on abort and never starts queued waiters', async () => {
      const controller = new AbortController();
      const limiter = new RequestLimiter(controller.signal, 2, 10);
      const gate1 = deferred<string>();
      const gate2 = deferred<string>();
      let queuedStarted = false;

      const p1 = limiter.schedule(() => gate1.promise);
      const p2 = limiter.schedule(() => gate2.promise);
      const p3 = limiter.schedule(async () => {
        queuedStarted = true;
        return 'queued';
      });

      expect(limiter.inFlight).toBe(2);
      expect(limiter.totalExecuted).toBe(2);

      controller.abort();

      await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
      await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
      await expect(p3).rejects.toMatchObject({ name: 'AbortError' });
      expect(queuedStarted).toBe(false);

      // Settle underlying promises and ensure inFlight returns to 0
      gate1.resolve('late-1');
      gate2.resolve('late-2');
      await Promise.resolve();
      await Promise.resolve();
      expect(limiter.inFlight).toBe(0);
    });

    it('dispose rejects pending waiters and detaches the abort listener while letting running tasks settle', async () => {
      const controller = new AbortController();
      const removeSpy = controller.signal.removeEventListener.bind(controller.signal);
      let removedAbortListener = false;
      controller.signal.removeEventListener = (type: string, listener: any, options?: any) => {
        if (type === 'abort') {
          removedAbortListener = true;
        }
        return removeSpy(type, listener, options);
      };

      const limiter = new RequestLimiter(controller.signal, 1, 10);
      const runningGate = deferred<string>();
      let waiterStarted = false;

      const runningPromise = limiter.schedule(() => runningGate.promise);
      const waiterPromise = limiter.schedule(async () => {
        waiterStarted = true;
        return 'waiter';
      });

      limiter.dispose();

      expect(removedAbortListener).toBe(true);
      await expect(waiterPromise).rejects.toMatchObject({ name: 'AbortError' });
      expect(waiterStarted).toBe(false);

      runningGate.resolve('finished');
      expect(await runningPromise).toBe('finished');
      expect(limiter.inFlight).toBe(0);
    });
  });
});
