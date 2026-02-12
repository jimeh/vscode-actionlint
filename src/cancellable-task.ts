/**
 * Manages a single cancellable async task per key. Starting a
 * new run automatically aborts and invalidates the previous one.
 * Staleness is detected via reference equality on an internal
 * entry object — no counters needed.
 */
export class CancellableTask {
  private current?: { ctrl: AbortController };

  /**
   * Run `fn` with an {@link AbortSignal}. If another `run()`
   * is called before this one completes, or `cancel()` is
   * called, the signal is aborted and `undefined` is returned.
   */
  async run<T>(
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    this.current?.ctrl.abort();
    const ctrl = new AbortController();
    const entry = { ctrl };
    this.current = entry;

    const result = await fn(ctrl.signal);

    if (this.current !== entry) {
      return undefined;
    }
    this.current = undefined;
    return result;
  }

  /** Abort any in-flight run. Safe to call when idle. */
  cancel(): void {
    this.current?.ctrl.abort();
    this.current = undefined;
  }
}
