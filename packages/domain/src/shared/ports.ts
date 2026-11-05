/** Abstraction over "now" so time-dependent rules are deterministic under test. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface IdGenerator {
  next(): string;
}

export const uuidGenerator: IdGenerator = {
  next: () => globalThis.crypto.randomUUID(),
};
