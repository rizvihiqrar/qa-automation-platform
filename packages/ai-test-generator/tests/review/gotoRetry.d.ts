export function isNetworkError(err: unknown): boolean;
export function gotoWithRetry(
  page: { goto(url: string): Promise<unknown> },
  url: string,
  options?: { attempts?: number; waitMs?: number },
): Promise<unknown>;
