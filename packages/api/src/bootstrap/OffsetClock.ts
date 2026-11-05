import { systemClock, type Clock } from '@prms/domain';

/**
 * A clock that can be temporarily shifted. Used only while seeding demo data so
 * historical bookings go through the real domain rules (and the real audit
 * trail) instead of being written straight into storage. The offset is reset
 * to zero before the server accepts requests.
 */
export class OffsetClock implements Clock {
  private offsetMs = 0;

  constructor(private readonly base: Clock = systemClock) {}

  now(): Date {
    return new Date(this.base.now().getTime() + this.offsetMs);
  }

  /** Runs `task` as if "now" were `at`, then restores real time. */
  async travelTo<T>(at: Date, task: () => Promise<T>): Promise<T> {
    this.offsetMs = at.getTime() - this.base.now().getTime();
    try {
      return await task();
    } finally {
      this.offsetMs = 0;
    }
  }
}
