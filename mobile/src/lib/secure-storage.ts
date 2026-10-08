import * as SecureStore from 'expo-secure-store';

/**
 * Supabase auth storage backed by the device keychain/keystore.
 *
 * A Supabase session (access + refresh token + user) is larger than the ~2 KB
 * a single SecureStore item can reliably hold, so the value is split across
 * numbered chunks with a small count entry. Tokens therefore never sit in
 * plain app storage.
 */
const CHUNK_SIZE = 1800;

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
  const count = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    const count = await readCount(key);
    if (count === 0) return null;

    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, index));
      // A missing chunk means the stored value is corrupt; treat as signed out.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    const previousCount = await readCount(key);
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));

    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, index),
        value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
      );
    }
    await SecureStore.setItemAsync(countKey(key), String(count));

    // Drop chunks left over from a previously longer value.
    for (let index = count; index < previousCount; index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    }
  },

  async removeItem(rawKey: string): Promise<void> {
    const key = safeKey(rawKey);
    const count = await readCount(key);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
