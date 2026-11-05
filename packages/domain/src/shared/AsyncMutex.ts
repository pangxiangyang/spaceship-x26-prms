/**
 * A minimal FIFO async mutex.
 *
 * Node runs JavaScript on one thread, but any `await` inside a read-check-write
 * sequence (e.g. "count overlapping bookings, then save a new one") lets another
 * request interleave. Running such sequences through `runExclusive` makes them
 * atomic with respect to each other.
 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // Keep the chain alive regardless of whether this task succeeds or fails.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
