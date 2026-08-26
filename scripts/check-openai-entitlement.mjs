const model = "gpt-5.6-terra";
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error(JSON.stringify({ ok: false, model, error: "missing_api_key" }));
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort("OpenAI model retrieval timed out."), 10_000);

try {
  const response = await fetch(`https://api.openai.com/v1/models/${model}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    },
    signal: controller.signal
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        model,
        httpStatus: response.status,
        errorCode: payload?.error?.code ?? null,
        errorType: payload?.error?.type ?? null
      })
    );
    process.exit(1);
  }

  if (payload?.id !== model || payload?.object !== "model") {
    console.error(
      JSON.stringify({ ok: false, model, error: "unexpected_model_receipt", received: payload?.id })
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      id: payload.id,
      object: payload.object,
      ownedBy: payload.owned_by ?? null,
      shutdownDate: payload.shutdown_date ?? null,
      requestIdPresent: response.headers.has("x-request-id"),
      rateLimit: {
        requests: response.headers.get("x-ratelimit-limit-requests"),
        tokens: response.headers.get("x-ratelimit-limit-tokens"),
        projectTokens: response.headers.get("x-ratelimit-limit-project-tokens")
      }
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      model,
      error: error instanceof Error ? error.name : "unknown_error"
    })
  );
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
