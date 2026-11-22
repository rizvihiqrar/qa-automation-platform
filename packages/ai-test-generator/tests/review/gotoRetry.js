// The review tests run against the public saucedemo.com. A dropped connection
// (net::ERR_CONNECTION_RESET and similar) happened once in CI and, with
// failOnFlakyTests on, a passing retry still failed the job. Only network-level
// errors are retried here; a wrong page or a slow page is never retried, so a
// real defect is not hidden.
const NETWORK_ERROR = /(net::ERR_(CONNECTION_(RESET|CLOSED|REFUSED|ABORTED|TIMED_OUT)|TIMED_OUT|EMPTY_RESPONSE|NETWORK_CHANGED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|SSL_PROTOCOL_ERROR))|NS_ERROR_(NET_RESET|NET_TIMEOUT|NET_INTERRUPT|CONNECTION_REFUSED|UNKNOWN_HOST)/;

export const isNetworkError = (err) => NETWORK_ERROR.test(String(err?.message ?? err));

export async function gotoWithRetry(page, url, { attempts = 3, waitMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.goto(url);
    } catch (err) {
      if (attempt >= attempts || !isNetworkError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
