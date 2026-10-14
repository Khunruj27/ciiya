type Ports = {
  capture: () => (() => boolean) | null;
  signOut: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onError: () => void;
};

/** One local-device sign-out, only after an explicit, still-current confirmation. */
export function createAccountActions(ports: Ports) {
  let active = true;
  let pending = false;
  let generation = 0;
  return {
    requestSignOut() {
      if (!active || pending) return null;
      const current = ports.capture();
      if (!current?.()) return null;
      pending = true;
      const captured = generation;
      let settled = false;
      return {
        cancel() {
          if (settled) return;
          settled = true;
          if (captured === generation) pending = false;
        },
        async confirm() {
          if (settled) return;
          settled = true;
          if (!active || captured !== generation || !current()) {
            if (captured === generation) pending = false;
            return;
          }
          ports.onBusy(true);
          try { await ports.signOut(); }
          catch { if (active && captured === generation && current()) ports.onError(); }
          finally {
            if (captured === generation) pending = false;
            if (active && captured === generation && current()) ports.onBusy(false);
          }
        },
      };
    },
    activate() { active = true; },
    dispose() { active = false; pending = false; generation += 1; },
  };
}
