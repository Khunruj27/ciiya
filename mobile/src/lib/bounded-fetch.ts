export const SUPABASE_REQUEST_TIMEOUT_MS = 30_000;

function abortError(timedOut: boolean): Error {
  // auth-js logs transport errors. Never attach a URL, request or credentials.
  const error = new Error(timedOut ? 'Network request timed out' : 'Network request cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * A deadline for Supabase's small Auth/PostgREST JSON responses, including
 * their body. A timeout race also settles transports that ignore abort.
 *
 * Drain a clone's sibling before returning: the SDK receives a normal, unread
 * Response with its original metadata and UTF-8/binary/clone semantics, but
 * cannot hang later while downloading JSON. Request bodies are passed through
 * untouched. Photo transfers use their separate native file transport; do not
 * use this buffering adapter for large media downloads.
 */
export function createBoundedFetch(
  send: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS
): typeof fetch {
  return async (input, init) => {
    const callerSignal = init?.signal === undefined
      ? (typeof input === 'object' && 'signal' in input ? input.signal : undefined)
      : init.signal;
    if (callerSignal?.aborted) throw abortError(false);

    const controller = new AbortController();
    let failure: Error | null = null;
    let rejectDeadline: (error: Error) => void = () => {};
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    // Also handle a synchronous custom fetch throw after triggering cancellation.
    void deadline.catch(() => {});
    const stop = (timedOut: boolean) => {
      if (failure) return;
      failure = abortError(timedOut);
      rejectDeadline(failure);
      controller.abort();
    };
    const timer = setTimeout(() => stop(true), timeoutMs);
    const cancel = () => stop(false);
    callerSignal?.addEventListener('abort', cancel, { once: true });
    const bounded = <T>(work: Promise<T>) => Promise.race([work, deadline]);

    try {
      const response = await bounded(send(input, { ...init, signal: controller.signal }));
      if (failure) throw failure;
      const ready = response.clone();
      await bounded(response.text());
      return ready;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', cancel);
    }
  };
}
