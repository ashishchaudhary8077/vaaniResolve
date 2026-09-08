# Security

VaaniResolve is a hackathon/demo build. These controls are implemented and verified:

## Secrets
- All keys live only in server-side environment variables (`.env`), which is **git-ignored**.
- `.env.example` shipped with placeholders only.
- No API keys are embedded in source, tests, or docs.
- `scripts/scan-secrets.mjs` scans the repo for common key formats; run `npm run scan:secrets` before commit.

## Data
- **Synthetic customer data only** (`packages/tools/src/data.ts`: Asha, Riya, Karan — fictional). No real PII.
- System prompt instructs the agent to refuse to disclose other users' data.

## Tool safety
- Tool calls are **whitelisted** by name; arguments are validated against declared schemas (`validateArgs`) before execution.
- **No arbitrary tool execution** — the LLM/fallback agent may only invoke the enumerated commerce tools.
- Destructive mutations (`cancel`, `return`, `replacement`) require a **confirmation** round-trip; a changed mind clears the pending action so it never executes.
- Mock mutations carry no side effects beyond the in-memory dataset (reset per process).

## Network / server
- Server secrets are never serialized to the browser. The `hello`/`status` payloads expose only configuration labels (provider, model, speaker, endpoint) — no credentials.
- Playback client is passive: it only renders audio/text the server sends.

## Build hygiene
- `.gitignore` covers `.env`, `node_modules`, `dist`, coverage, logs, IDE files.
- `package.json` scripts never resolve `process.env` values into bundled assets.

## Threat model notes (known gaps, hackathon scope)
- No authentication/authorization on WS API (single-user demo).
- No rate limiting or origin allow-listing on `/ws`/REST.
- Client STT transcripts are sent to the server over a local WS; for a production deploy add TLS and an auth handshake.
- Mock commerce APIs are in-memory; a real backend requires idempotency keys on destructive ops.

## Audit procedure
1. `git grep -nE '(sk-[A-Za-z0-9]{20,}|r?[A-Za-z0-9]{8,}[_-][A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._-]{10,})'` should only match `.env.example` placeholders and docs referring to env vars.
2. Run `npm run scan:secrets`.
3. Confirm `.env` is absent from `git status`.