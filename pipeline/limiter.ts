/**
 * Sliding-window rate limiter plus retry for one upstream. Tasks start in FIFO order and never
 * exceed any window (e.g. jikan-edge: 30 per 10 s and 60 per minute).
 */
export class Limiter {
  private readonly sent: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly name: string,
    private readonly windows: ReadonlyArray<{ ms: number; max: number }>,
    private readonly retries = 4,
  ) {}

  private async slot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      let wait = 0;
      for (const { ms, max } of this.windows) {
        const inWindow = this.sent.filter((t) => now - t < ms);
        if (inWindow.length >= max) wait = Math.max(wait, inWindow[inWindow.length - max]! + ms - now);
      }
      if (wait <= 0) break;
      await sleep(wait);
    }
    const now = Date.now();
    this.sent.push(now);
    const longest = Math.max(...this.windows.map((w) => w.ms));
    while (this.sent.length && now - this.sent[0]! >= longest) this.sent.shift();
  }

  /** Runs `task` when a slot is free; retries 429 / 5xx / network errors with backoff. */
  schedule = <T>(task: () => Promise<T>): Promise<T> => {
    const attempt = async (n: number): Promise<T> => {
      const gate = this.queue.then(() => this.slot());
      this.queue = gate.catch(() => {});
      await gate;
      try {
        return await task();
      } catch (err) {
        // UpstreamError and MalError both carry the HTTP status; network failures carry none.
        const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || n >= this.retries) throw err;
        const delay = status === 429 ? 15_000 : 1000 * 2 ** n;
        console.warn(`[${this.name}] ${status ?? (err instanceof Error ? err.message : String(err))}: coba lagi dalam ${delay / 1000} dtk`);
        await sleep(delay);
        return attempt(n + 1);
      }
    };
    return attempt(0);
  };
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'anidle-pipeline/0.1' }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new UpstreamError(res.status, `${res.status} ${url}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}
