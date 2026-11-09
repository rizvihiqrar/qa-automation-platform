// One line per problem, with the time and, for a request, which one. Found by the
// incident game day (docs/rca/06): 355 identical lines with no time in them could
// not be lined up with the pager, so the responder could not say when it started.
export function logError(message: string, request?: { method: string; path: string }): void {
  const where = request ? `${request.method} ${request.path} ` : '';
  console.error(`${new Date().toISOString()} ${where}${message}`);
}
