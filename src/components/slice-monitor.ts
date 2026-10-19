import type { SliceJob } from '../adapters/slicing';

export const sliceActive = (job?: SliceJob) => job?.status === 'queued' || job?.status === 'running';

/** One request at a time, bounded backoff, and no late callbacks after disposal. */
export function monitorSlice(id: string, options: {
  read: (id: string, signal: AbortSignal) => Promise<SliceJob>;
  onStatus: (job: SliceJob) => void;
  onDisconnected: (error: unknown) => void;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let failures = 0;
  const poll = async () => {
    let again = true;
    try {
      const job = await options.read(id, controller.signal);
      if (controller.signal.aborted) return;
      failures = 0;
      options.onStatus(job);
      again = sliceActive(job);
    } catch (error) {
      if (controller.signal.aborted) return;
      failures++;
      options.onDisconnected(error);
    }
    if (again && !controller.signal.aborted) timer = setTimeout(poll, Math.min(700 * 2 ** Math.min(failures, 4), 8000));
  };
  timer = setTimeout(poll, 700);
  return () => { controller.abort(); clearTimeout(timer); };
}

/** Failed/cancelled attempts don't loop. A changed manifest can trigger one new attempt. */
export function shouldAutoSlice(enabled: boolean, hash: string, attempted: string | undefined, busy: boolean, running: boolean, ready: boolean) {
  return enabled && !!hash && hash !== attempted && !busy && !running && ready;
}
