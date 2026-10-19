import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorSlice, shouldAutoSlice } from '../src/components/slice-monitor';
import type { SliceJob } from '../src/adapters/slicing';

const status = (state: SliceJob['status']): SliceJob => ({ id: 'slice', status: state, progress: 20,
  manifestHash: 'hash', idempotencyKey: 'attempt', requestHash: 'request', logs: [], createdAt: '', updatedAt: '' });
afterEach(() => vi.useRealTimers());
describe('slicing status recovery', () => {
  it('retries a transient disconnect, delivers completion once, then stops', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(status('running')).mockResolvedValueOnce(status('succeeded'));
    const onStatus = vi.fn(), onDisconnected = vi.fn();
    const stop = monitorSlice('slice', { read, onStatus, onDisconnected });
    await vi.advanceTimersByTimeAsync(700); expect(onDisconnected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1400); expect(onStatus).toHaveBeenLastCalledWith(status('running'));
    await vi.advanceTimersByTimeAsync(700); expect(onStatus).toHaveBeenLastCalledWith(status('succeeded'));
    await vi.advanceTimersByTimeAsync(30000); expect(read).toHaveBeenCalledTimes(3); stop();
  });
  it('never overlaps slow requests and discards a late response after changing jobs', async () => {
    vi.useFakeTimers();
    let finish!: (value: SliceJob) => void;
    const read = vi.fn((_id: string, _signal: AbortSignal) => new Promise<SliceJob>(resolve => { finish = resolve; }));
    const onStatus = vi.fn();
    const stop = monitorSlice('slice', { read, onStatus, onDisconnected: vi.fn() });
    await vi.advanceTimersByTimeAsync(30000); expect(read).toHaveBeenCalledTimes(1);
    stop(); expect(read.mock.calls[0][1].aborted).toBe(true);
    finish(status('succeeded')); await vi.advanceTimersByTimeAsync(30000); expect(onStatus).not.toHaveBeenCalled();
  });
  it('backs off repeated failures and cancels reconnect timers', async () => {
    vi.useFakeTimers(); const read = vi.fn().mockRejectedValue(new Error('offline'));
    const stop = monitorSlice('slice', { read, onStatus: vi.fn(), onDisconnected: vi.fn() });
    await vi.advanceTimersByTimeAsync(60000); expect(read.mock.calls.length).toBeLessThan(12);
    const count = read.mock.calls.length; stop(); await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(count);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('stops polling on %s', async state => {
    vi.useFakeTimers(); const read = vi.fn().mockResolvedValue(status(state));
    const stop = monitorSlice('slice', { read, onStatus: vi.fn(), onDisconnected: vi.fn() });
    await vi.advanceTimersByTimeAsync(30000); expect(read).toHaveBeenCalledTimes(1); stop();
  });
});
it('auto updates once per changed manifest and waits for valid inputs and the previous attempt', () => {
  expect(shouldAutoSlice(true, 'new', 'old', false, false, true)).toBe(true);
  for (const args of [[false, 'new', 'old', false, false, true], [true, '', 'old', false, false, true],
    [true, 'failed-attempt', 'failed-attempt', false, false, true], [true, 'new', 'old', true, false, true],
    [true, 'new', 'old', false, true, true], [true, 'new', 'old', false, false, false]] as const)
    expect(shouldAutoSlice(args[0], args[1], args[2], args[3], args[4], args[5])).toBe(false);
});
