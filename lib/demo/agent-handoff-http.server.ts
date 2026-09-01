import "server-only";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isTrustedHandoffRequest(request: Request): boolean {
  if (request.headers.get("x-thurstone-request") !== "byoa-handoff") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return process.env.NODE_ENV !== "production";
  try {
    const supplied = new URL(origin);
    const target = new URL(request.url);
    if (supplied.origin === target.origin) return true;
    return (
      process.env.NODE_ENV !== "production" &&
      LOOPBACK_HOSTS.has(supplied.hostname) &&
      LOOPBACK_HOSTS.has(target.hostname) &&
      supplied.port === target.port
    );
  } catch {
    return false;
  }
}

export function trustedHandoffClientOrigin(request: Request): string | null {
  const value = request.headers.get("x-thurstone-origin");
  if (!value) return null;
  try {
    const supplied = new URL(value);
    const target = new URL(request.url);
    if (supplied.origin === target.origin) return supplied.origin;
    if (
      process.env.NODE_ENV !== "production" &&
      LOOPBACK_HOSTS.has(supplied.hostname) &&
      LOOPBACK_HOSTS.has(target.hostname) &&
      supplied.port === target.port
    ) {
      return supplied.origin;
    }
    return null;
  } catch {
    return null;
  }
}
