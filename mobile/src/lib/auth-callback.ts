/** Do not accept authentication carried by an unrelated deep link. */
export function isAuthCallback(url: string, redirectTo: string): boolean {
  try {
    const actual = new URL(url);
    const expected = new URL(redirectTo);
    return actual.protocol === expected.protocol && actual.host === expected.host &&
      actual.pathname === expected.pathname && !actual.username && !actual.password;
  } catch {
    return false;
  }
}

export function readCallbackCode(url: string, redirectTo: string): string | null {
  if (!isAuthCallback(url, redirectTo)) return null;
  // Bound parsing of an externally supplied URL. Never include it in errors/logs.
  if (url.length > 32_768) throw new Error('Invalid authentication callback');
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  for (const [key, value] of new URLSearchParams(parsed.hash.slice(1))) params.append(key, value);
  if (params.has('error') || params.has('error_code')) throw new Error('Authentication was not completed');
  // Never accept bearer tokens from an interceptable private URI scheme.
  if (params.has('access_token') || params.has('refresh_token')) throw new Error('Unsupported authentication callback');
  const codes = params.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 2048) {
    throw new Error('Authentication callback did not include a code');
  }
  return codes[0];
}

/** Browser completion and the callback route may receive the same link together. */
export function createCallbackCompleter(exchangeCode: (code: string) => Promise<void>) {
  let lastUrl: string | null = null;
  let lastCompletion: Promise<boolean> | null = null;
  return (url: string, redirectTo: string): Promise<boolean> => {
    if (!isAuthCallback(url, redirectTo)) return Promise.resolve(false);
    if (url === lastUrl && lastCompletion) return lastCompletion;
    let code: string | null;
    try {
      code = readCallbackCode(url, redirectTo);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!code) return Promise.resolve(false);
    lastUrl = url;
    lastCompletion = exchangeCode(code).then(() => true).catch((error: unknown) => {
      // A transient failure may be retried. Successful callbacks are not replayed.
      if (lastUrl === url) { lastUrl = null; lastCompletion = null; }
      throw error;
    });
    return lastCompletion;
  };
}
