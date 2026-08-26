# Security policy

## Challenge safety boundary

ToolProof is a deterministic simulated checkout/review sandbox. It has no real purchase, payment, account, inventory, email, messaging, or external mutation path. A checkout request will eventually create only a local simulated pending-human-approval state; no WebMCP approval tool exists.

## WebMCP boundary

- Tools are top-level and same-origin only; no `exposedTo` cross-origin grant is used.
- `Permissions-Policy: tools=(self)` and origin isolation are preserved.
- Tool metadata is static, reviewed, concise, and treated as untrusted agent context.
- Inputs are bounded and validated in handlers; schemas are not authorization.
- Read-only annotations must match actual behavior.
- Cancellation, duplicate operations, partial mutations, and unexpected failures must remain trace-visible.
- Unsupported clients receive an honest explanation and never a polyfilled native result.

## Model-backed lane

The hosted Probe lane remains disabled until it has all of the following: a server-held provider secret, a Sergio-approved hard provider cap, signed short-lived single-use run tokens, durable replay/rate/concurrency/spend controls, allowlisted cases/manifests/model settings, origin and CSRF checks, strict body/output limits, safe redaction, and a terminal evidence receipt.

It will accept no arbitrary public prompt, model, manifest, URL, code, or external action. Only synthetic challenge text and minimal fixture state may reach the disclosed provider.

## Reporting a vulnerability

Until the public repository exists, report a security issue privately to the repository owner. After release, use GitHub private vulnerability reporting if enabled. Do not include live credentials, personal data, or unsafe proof-of-concept payloads in a public issue.

An exposed credential may be revoked immediately to prevent harm. Any incident affecting judged artifacts must be recorded and disclosed; it must not be hidden through a silent release mutation.
