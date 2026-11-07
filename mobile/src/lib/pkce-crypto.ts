import * as ExpoCrypto from 'expo-crypto';

/** Hermes needs native randomness and SHA-256 for Supabase's S256 PKCE flow. */
export function installNativePkceCrypto(target: { crypto?: object } = globalThis) {
  const crypto = target.crypto ?? {};
  if (typeof (crypto as { getRandomValues?: unknown }).getRandomValues !== 'function') {
    Object.defineProperty(crypto, 'getRandomValues', { value: ExpoCrypto.getRandomValues, configurable: true });
  }
  const subtle = (crypto as { subtle?: object }).subtle ?? {};
  if (typeof (subtle as { digest?: unknown }).digest !== 'function') {
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: (algorithm: AlgorithmIdentifier, bytes: BufferSource) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        const nativeAlgorithm = Object.values(ExpoCrypto.CryptoDigestAlgorithm).find((item) => item === name.toUpperCase());
        if (!nativeAlgorithm) return Promise.reject(new Error('Unsupported digest algorithm'));
        return ExpoCrypto.digest(nativeAlgorithm, bytes);
      },
    });
  }
  if (!(crypto as { subtle?: object }).subtle) Object.defineProperty(crypto, 'subtle', { value: subtle, configurable: true });
  if (!target.crypto) Object.defineProperty(target, 'crypto', { value: crypto, configurable: true });
}
