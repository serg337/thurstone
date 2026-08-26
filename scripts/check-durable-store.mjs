import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error(JSON.stringify({ ok: false, provider: "upstash-redis", error: "missing_store" }));
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort("Durable-store preflight timed out."), 10_000);

try {
  const redis = new Redis({
    url,
    token,
    signal: controller.signal,
    enableTelemetry: false,
    readYourWrites: true
  });
  const ping = await redis.ping();
  const script = await redis.eval(
    "return {ARGV[1], redis.call('PING')}",
    [],
    ["toolproof-store-check@0.1.0"]
  );

  if (ping !== "PONG" || !Array.isArray(script) || script[0] !== "toolproof-store-check@0.1.0") {
    throw new Error("unexpected_store_receipt");
  }

  console.log(
    JSON.stringify({ ok: true, provider: "upstash-redis", ping: true, atomicScript: true })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      provider: "upstash-redis",
      error: error instanceof Error ? error.name : "unknown_error"
    })
  );
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
