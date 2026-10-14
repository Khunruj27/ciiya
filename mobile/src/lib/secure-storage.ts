import * as SecureStore from 'expo-secure-store';

/**
 * Supabase auth storage backed by the device keychain/keystore.
 *
 * A Supabase session (access + refresh token + user) is larger than the ~2 KB
 * a single SecureStore item can reliably hold, so the value is split across
 * numbered chunks with a small manifest. Write to the inactive slot, then
 * commit its manifest last: a failed write cannot mix old/new session chunks.
 * Tokens never sit in plain app storage.
 */
const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 128;
type Manifest = { version: 1; active: 0 | 1; counts: [number, number] };
const pending = new Map<string, Promise<unknown>>();

function chunkKey(key: string, index: number) {
  return `${key}.${index}`;
}

function countKey(key: string) {
  return `${key}.count`;
}

// SecureStore keys allow only alphanumerics, ".", "-" and "_".
function safeKey(key: string) {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function readCount(key: string) {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw ? Number(raw) : 0;
  return Number.isInteger(count) && count > 0 && count <= MAX_CHUNKS ? count : 0;
}

function manifestKey(key: string) { return `${key}.manifest`; }
function slotKey(key: string, slot: number, index: number) { return `${key}.slot${slot}.${index}`; }

async function readManifest(key: string): Promise<Manifest | null | 'invalid'> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version === 1 && (parsed.active === 0 || parsed.active === 1) &&
      Array.isArray(parsed.counts) && parsed.counts.length === 2 &&
      parsed.counts.every((count) => Number.isInteger(count) && count >= 0 && count <= MAX_CHUNKS) &&
      parsed.counts[parsed.active] > 0) return parsed;
  } catch { /* A corrupt manifest must never restore legacy/stale credentials. */ }
  return 'invalid';
}

/** UTF-8 bytes, not UTF-16 characters: Thai names can use three bytes each. */
function splitValue(value: string): string[] {
  const parts: string[] = [];
  let part = '';
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > CHUNK_SIZE) { parts.push(part); part = ''; bytes = 0; }
    part += char;
    bytes += size;
    if (parts.length >= MAX_CHUNKS) throw new Error('Session storage limit exceeded');
  }
  parts.push(part);
  return parts;
}

/** Serialize reads/writes/removal for a key, including refresh vs. sign-out. */
function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const result = previous.then(work, work);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
  return result;
}

async function bestEffortDelete(key: string) {
  try { await SecureStore.deleteItemAsync(key); } catch { /* Clean up on a later operation. */ }
}

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    return serialized(key, async () => {
      const manifest = await readManifest(key);
      if (manifest === 'invalid') return null;
      const count = manifest ? manifest.counts[manifest.active] : await readCount(key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const part = await SecureStore.getItemAsync(manifest
          ? slotKey(key, manifest.active, index) : chunkKey(key, index));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    });
  },

  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    return serialized(key, async () => {
      const parts = splitValue(value);
      const storedManifest = await readManifest(key);
      // A corrupt pointer is signed out, but a newly verified login must be
      // able to replace it. Keep it fail-closed until the fresh commit succeeds.
      const previous = storedManifest === 'invalid' ? null : storedManifest;
      const legacyCount = previous ? 0 : await readCount(key);
      const slot = previous?.active === 0 ? 1 : 0;
      const counts: [number, number] = previous ? [...previous.counts] : [0, 0];
      for (let index = 0; index < parts.length; index += 1) {
        await SecureStore.setItemAsync(slotKey(key, slot, index), parts[index]);
      }
      const staleCount = counts[slot];
      counts[slot] = parts.length;
      await SecureStore.setItemAsync(manifestKey(key), JSON.stringify({ version: 1, active: slot, counts }));
      // Cleanup cannot turn a committed write into a false auth failure.
      await bestEffortDelete(countKey(key));
      for (let index = 0; index < legacyCount; index += 1) await bestEffortDelete(chunkKey(key, index));
      for (let index = parts.length; index < staleCount; index += 1) await bestEffortDelete(slotKey(key, slot, index));
      if (previous) {
        for (let index = 0; index < previous.counts[previous.active]; index += 1) {
          await bestEffortDelete(slotKey(key, previous.active, index));
        }
      }
    });
  },

  async removeItem(rawKey: string): Promise<void> {
    const key = safeKey(rawKey);
    return serialized(key, async () => {
      const legacyCount = await readCount(key);
      // Revoke pointers before cleaning chunks. A cleanup failure must not
      // resurrect an earlier session on the next launch.
      await SecureStore.deleteItemAsync(countKey(key));
      await SecureStore.deleteItemAsync(manifestKey(key));
      for (let index = 0; index < legacyCount; index += 1) await bestEffortDelete(chunkKey(key, index));
      // Uncommitted writes may have left extra chunks; bounds also cap corrupt manifests.
      for (let index = 0; index < MAX_CHUNKS; index += 16) {
        await Promise.all([0, 1].flatMap((slot) =>
          Array.from({ length: 16 }, (_, offset) => bestEffortDelete(slotKey(key, slot, index + offset)))
        ));
      }
    });
  },
};
