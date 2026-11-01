/** What a request will do, shown by --dry-run before anything is sent. */
export interface PlannedRequest {
  method: string;
  url: string;
  body: unknown;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const basicAuth = (user: string, secret: string): string => 'Basic ' + Buffer.from(user + ':' + secret).toString('base64');

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_WAIT_SECONDS = 5;

/** Pulls the readable message out of TestRail ({error}) and Jira ({errorMessages, errors}) error bodies. */
function messageFrom(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const b = body as { error?: unknown; errorMessages?: unknown; errors?: unknown };
  if (typeof b.error === 'string') return b.error;
  const parts: string[] = [];
  if (Array.isArray(b.errorMessages)) parts.push(...b.errorMessages.map(String));
  if (typeof b.errors === 'object' && b.errors !== null) {
    parts.push(...Object.entries(b.errors).map(([field, message]) => field + ': ' + String(message)));
  }
  return parts.length ? parts.join('; ') : fallback;
}

/**
 * Sends one JSON request. A 429 is retried after the Retry-After wait (at most five seconds);
 * any other failure becomes an ApiError. The Authorization header is never part of an error message.
 */
export async function requestJson(
  request: PlannedRequest,
  headers: Record<string, string>,
  options: { retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<unknown> {
  const { retries = 2, sleep = defaultSleep } = options;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(request.body),
      });
    } catch (error) {
      throw new Error('Could not reach ' + request.url + ': ' + (error instanceof Error ? error.message : String(error)));
    }
    if (response.status === 429 && attempt < retries) {
      const wait = Math.min(Number(response.headers.get('retry-after')) || 1, MAX_WAIT_SECONDS);
      await sleep(wait * 1000);
      continue;
    }
    const text = await response.text();
    let parsed: unknown = null;
    let isJson = true;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      isJson = false;
    }
    if (!response.ok) throw new ApiError(response.status, 'HTTP ' + response.status + ': ' + messageFrom(parsed, response.statusText));
    // A wrong address, a login page or a redirect can answer 200 with something that is not the API.
    if (!isJson || parsed === null) {
      throw new ApiError(response.status, 'HTTP ' + response.status + ': the answer was not JSON, so it did not come from the API (check --base-url)');
    }
    return parsed;
  }
}

/** The request as it would be sent, with the secret replaced, for --dry-run output. */
export const redact = (request: PlannedRequest): string =>
  request.method + ' ' + request.url + '\nAuthorization: Basic ***\n' + JSON.stringify(request.body, null, 2);
