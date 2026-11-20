export const MAX_CONCURRENCY = 6;
export const MAX_REQUESTS = 45;

/**
 * Concurrency and budget limiter for TMDB API calls.
 * Enforces at most 6 requests in-flight simultaneously,
 * and at most 45 requests total per generation by default.
 */
export class RequestLimiter {
  private running = 0;
  private totalRequests = 0;
  private waiters: Array<{
    resolve: () => void;
    reject: (err: any) => void;
  }> = [];
  private onAbortListener?: () => void;

  constructor(
    private signal?: AbortSignal,
    private readonly maxConcurrency = MAX_CONCURRENCY,
    private readonly maxRequests = MAX_REQUESTS
  ) {
    if (this.signal) {
      if (this.signal.aborted) {
        this.abortWaiters();
      } else {
        this.onAbortListener = () => this.abortWaiters();
        this.signal.addEventListener('abort', this.onAbortListener, { once: true });
      }
    }
  }

  dispose() {
    if (this.signal && this.onAbortListener) {
      this.signal.removeEventListener('abort', this.onAbortListener);
      this.onAbortListener = undefined;
    }
    this.abortWaiters();
  }

  private abortWaiters() {
    const err = this.signal?.reason || new DOMException('The operation was aborted', 'AbortError');
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      w.reject(err);
    }
  }

  async schedule<T>(task: () => Promise<T>): Promise<T | null> {
    if (this.signal?.aborted) {
      throw this.signal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    if (this.totalRequests >= this.maxRequests) {
      return null;
    }

    if (this.running >= this.maxConcurrency || this.waiters.length > 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    } else {
      this.running++;
    }

    if (this.signal?.aborted) {
      this.running--;
      this.release();
      throw this.signal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    if (this.totalRequests >= this.maxRequests) {
      this.running--;
      this.release();
      return null;
    }

    this.totalRequests++;

    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (this.signal?.aborted) {
        reject(this.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
      } else if (this.signal) {
        onAbort = () => {
          reject(this.signal!.reason || new DOMException('The operation was aborted', 'AbortError'));
        };
        this.signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    try {
      const taskPromise = Promise.resolve(task());
      taskPromise.catch(() => {});
      return await (this.signal ? Promise.race([taskPromise, abortPromise]) : taskPromise);
    } finally {
      if (this.signal && onAbort) {
        this.signal.removeEventListener('abort', onAbort);
      }
      this.running--;
      this.release();
    }
  }

  private release() {
    if (this.waiters.length > 0 && this.running < this.maxConcurrency) {
      if (this.signal?.aborted) {
        this.abortWaiters();
        return;
      }
      this.running++;
      const next = this.waiters.shift()!;
      next.resolve();
    }
  }

  get inFlight(): number {
    return this.running;
  }

  get totalExecuted(): number {
    return this.totalRequests;
  }
}
