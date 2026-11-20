/**
 * Redacts a known credential string from arbitrary text.
 */
export function redactSecret(text: string, secret?: string): string {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmed) return text;
  let result = text;
  if (secret && secret !== trimmed) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result.split(trimmed).join('[REDACTED]');
}

/**
 * Redacts `api_key` query parameters from TMDB URLs or strings containing them.
 */
export function redactTmdbUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    if (url.searchParams.has('api_key')) {
      url.searchParams.set('api_key', '[REDACTED]');
    }
    return url.toString();
  } catch {
    return urlStr.replace(/api_key=[^&\s"']+/gi, 'api_key=[REDACTED]');
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Extracts a safe, credential-redacted message from an unknown thrown value.
 */
export function redactErrorMessage(err: unknown, secret?: string): string {
  return redactSecret(redactTmdbUrl(extractErrorMessage(err)), secret);
}

/**
 * Rethrows an error after stripping any embedded credential or TMDB `api_key` parameter
 * from its message, preserving the original error object when no secret is present.
 */
export function rethrowRedacted(err: unknown, secret?: string): never {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  const raw = extractErrorMessage(err);

  const hasSecret = Boolean(trimmed && raw.includes(trimmed));
  const hasApiKeyParam = /api_key=/i.test(raw);

  if (!hasSecret && !hasApiKeyParam) {
    throw err;
  }

  const sanitized = new Error(redactErrorMessage(err, secret));
  if (err instanceof Error) {
    sanitized.name = err.name;
  }
  throw sanitized;
}
