import { describe, expect, it } from 'vitest';
import { AsyncMutex } from '../../src/shared/AsyncMutex';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('AsyncMutex', () => {
  it('runs critical sections one at a time, in arrival order', async () => {
    const mutex = new AsyncMutex();
    const trace: string[] = [];
    const task = (name: string) =>
      mutex.runExclusive(async () => {
        trace.push(`${name}:start`);
        await tick();
        trace.push(`${name}:end`);
        return name;
      });

    const results = await Promise.all([task('a'), task('b'), task('c')]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(trace).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('keeps working after a task rejects', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(mutex.runExclusive(async () => 'recovered')).resolves.toBe('recovered');
  });
});
