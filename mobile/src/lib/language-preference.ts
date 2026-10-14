export type Locale = 'th' | 'en';
export type LanguagePreference = 'system' | Locale;

export function parseLanguagePreference(value: unknown): LanguagePreference {
  return value === 'th' || value === 'en' ? value : 'system';
}

export function resolveLocale(preference: LanguagePreference, deviceLanguage: string | null | undefined): Locale {
  return preference === 'system' ? (deviceLanguage === 'th' || !deviceLanguage ? 'th' : 'en') : preference;
}

type Snapshot = Readonly<{
  preference: LanguagePreference;
  saving: boolean;
  saveFailed: boolean;
}>;

/** One device preference, independent of sign-in and all account/auth storage. */
export function createLanguagePreferenceStore(storage: {
  read: () => Promise<unknown>;
  write: (preference: LanguagePreference) => Promise<void>;
}) {
  let snapshot: Snapshot = { preference: 'system', saving: false, saveFailed: false };
  let revision = 0;
  let restore: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    restore() {
      if (!restore) {
        restore = Promise.resolve().then(storage.read).then(value => {
          // Even a choice made before the restore effect starts takes precedence.
          if (revision === 0) publish({ ...snapshot, preference: parseLanguagePreference(value) });
        }).catch(() => { /* Device language remains usable if local storage is unavailable. */ });
      }
      return restore;
    },
    select(value: LanguagePreference) {
      if (value !== 'system' && value !== 'th' && value !== 'en') return Promise.resolve();
      const selectedRevision = ++revision;
      publish({ preference: value, saving: true, saveFailed: false });
      // Serialize rapid choices so a late older write cannot win on the next launch.
      writes = writes.then(() => storage.write(value)).then(() => {
        if (revision === selectedRevision) publish({ preference: value, saving: false, saveFailed: false });
      }).catch(() => {
        if (revision === selectedRevision) publish({ preference: value, saving: false, saveFailed: true });
      });
      return writes;
    },
  };
}
