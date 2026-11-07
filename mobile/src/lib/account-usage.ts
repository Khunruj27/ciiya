import { DataError, type StorageUsage } from '@/lib/data/types';

export function summarizeStorageUsage(usage: StorageUsage) {
  if (!usage || typeof usage.plan !== 'string' || !usage.plan.trim() || usage.plan.length > 64 ||
    !Number.isFinite(usage.usedBytes) || usage.usedBytes < 0 || usage.usedBytes > Number.MAX_SAFE_INTEGER ||
    !Number.isFinite(usage.limitBytes) || usage.limitBytes < 0 || usage.limitBytes > Number.MAX_SAFE_INTEGER) {
    throw new DataError('server');
  }
  const knownLimit = usage.limitBytes > 0;
  const fraction = knownLimit ? Math.min(usage.usedBytes / usage.limitBytes, 1) : null;
  return {
    plan: usage.plan.trim().toLowerCase(),
    usedBytes: usage.usedBytes,
    limitBytes: knownLimit ? usage.limitBytes : null,
    remainingBytes: knownLimit ? Math.max(usage.limitBytes - usage.usedBytes, 0) : null,
    fraction,
    level: fraction === null ? 'unknown' : usage.usedBytes >= usage.limitBytes ? 'full'
      : fraction >= 0.9 ? 'near-full' : 'normal',
  } as const;
}

type Snapshot = {
  data: StorageUsage | null;
  error: DataError | null;
  loading: boolean;
  refreshing: boolean;
  authorized: boolean;
  /** Identity transitions, including A → null → A before React renders. */
  authEpoch: number;
};
type Job = { generation: number; cancel: () => void; promise?: Promise<void> };

/** Owner-scoped read state. No quota changes, billing actions or background polling. */
export class AccountUsageQuery {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private focused = false;
  private mounted = false;
  private generation = 0;
  private observedOwner: string;
  private pending: Job | null = null;

  constructor(private accountId: string, private read: (owner: string) => Promise<StorageUsage>) {
    this.observedOwner = accountId;
    this.snapshot = { data: null, error: null, loading: Boolean(accountId), refreshing: false,
      authorized: Boolean(accountId), authEpoch: 0 };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private invalidate() {
    this.generation += 1;
    this.pending?.cancel();
    this.pending = null;
  }
  mount() { this.mounted = true; }
  dispose = () => {
    this.mounted = false;
    this.focused = false;
    this.invalidate();
  };
  setFocused(focused: boolean) {
    if (focused === this.focused) return;
    this.focused = focused;
    if (!focused) {
      this.invalidate();
      this.update({ refreshing: false, loading: !this.snapshot.data && this.snapshot.authorized });
    }
  }
  observeOwner(owner: string) {
    const authorized = Boolean(this.accountId && owner === this.accountId);
    if (owner === this.observedOwner && authorized === this.snapshot.authorized) return;
    this.observedOwner = owner;
    this.invalidate();
    // SDK callbacks only invalidate/notify. The hook starts reads after commit,
    // outside the synchronous SDK auth callback/lock.
    this.update({ data: null, error: null, loading: authorized, refreshing: false,
      authorized, authEpoch: this.snapshot.authEpoch + 1 });
  }
  refresh = (): Promise<void> => {
    if (!this.mounted || !this.focused || !this.snapshot.authorized) return Promise.resolve();
    if (this.pending) return this.pending.promise ?? Promise.resolve();
    let cancel: () => void = () => {};
    const cancelled = new Promise<null>(resolve => { cancel = () => resolve(null); });
    const job: Job = { generation: this.generation, cancel };
    this.pending = job;
    this.update({ loading: !this.snapshot.data, refreshing: Boolean(this.snapshot.data) });
    const current = () => this.mounted && this.focused && this.snapshot.authorized &&
      this.pending === job && this.generation === job.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new DataError('network')), 30_000);
    });
    job.promise = (async () => {
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => current() ? this.read(this.accountId) : null), timeout, cancelled,
        ]);
        if (!current() || !result) return;
        summarizeStorageUsage(result);
        this.update({ data: { plan: result.plan, usedBytes: result.usedBytes, limitBytes: result.limitBytes },
          error: null, loading: false, refreshing: false });
      } catch (error) {
        if (!current()) return;
        const kind = error instanceof DataError ? error.kind : 'server';
        this.update({ data: kind === 'unauthenticated' ? null : this.snapshot.data,
          error: new DataError(kind), loading: false, refreshing: false });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (this.pending === job) this.pending = null;
      }
    })();
    return job.promise;
  };
}
