# Managed learning integration

Only `study-coach` and `ai-classroom` use the managed learning service.
Knowledge, AI literacy and the training lab retain their local behavior.
This adaptation does not change the parent server, desktop or root package.

## Runtime boundary

When the parent has `PILOTDECK_MANAGED_URL`, `runtime.js` supplies these two
additional variables to chargeable children:

- `PILOTDECK_MANAGED_BRIDGE=http://127.0.0.1:<parentPort>`
- `PILOTDECK_MANAGED_LOCAL_KEY=<per-runtime key>`

The parent's cloud URL, token, user ID and unrelated credentials are not
inherited. Missing local keys or invalid parent ports fail startup rather than
enabling BYOK. Other modules receive neither bridge variable.
The child accepts only an HTTP numeric loopback bridge with an explicit port.

The parent must install the following endpoints before starting a managed
learning child. Both require `Authorization: Bearer <per-runtime key>`:

- `GET /api/managed/learning/models` returns
  `{items:[{id,name,protocol,inputPriceMicros,outputPriceMicros}],defaultModelId}`.
- `POST /api/managed/learning/complete` accepts
  `{modelId?,messages:[{role,content}],maxTokens:1600}` and returns `{answer}`.

Model authorization and accounting remain the parent's responsibility on every
completion, including requests with no model ID (the parent selects a default).
Prices use micro-RMB per million tokens, displayed as RMB per million tokens.

## Child and browser contracts

`GET /api/managed/config` returns `{managed:false}` in local mode, or
`{managed:true,models:[...],defaultModelId}` in managed mode. Only the five
documented model metadata fields are forwarded. Empty catalogs use a null
default. Failed catalogs return a non-2xx response with `managed:true` and a
sanitized error. Responses are not cached.

Managed coach requests use `{modelId?,mode,grade,messages}` at `/api/coach/chat`.
Managed classroom requests use `{modelId?,prompt}` at `/api/classroom/complete`.
Both preserve existing learning input limits, four-request concurrency limits,
60-second timeouts, client disconnect cancellation, and same-origin JSON POST
checks. The coach includes its selected skills and grade instructions; the
classroom adds its teaching system instructions. Unexpected provider, endpoint,
key, model, instruction and token-limit fields cannot alter the bridge request.
No upstream error body is reflected, and there is no BYOK fallback.

Local mode retains the existing provider settings and request formats.
Both pages fetch configuration before enabling model settings. Managed pages
remove the BYOK fields, show permitted models and prices, and allow catalog
refresh. Failed or empty catalogs cannot enable a paid request.

All browser requests remain on the child's own origin. No CSP expansion,
camera/microphone permission, cloud CORS access or browser-visible local key is
needed. Existing iframe sandbox permissions (scripts, same-origin and forms)
and explicit parent `frame-ancestors` continue to work. The remaining existing
sandbox permissions can stay as configured by the host.

## Verification

From the repository root with Node 22:

```powershell
& '.cache/runtime/node-v22.23.1-win-x64/node.exe' ui/node_modules/vitest/vitest.mjs run --config ui/src/components/education/vitest.config.ts ui/education/managed.test.js ui/education/managed-ui.test.js ui/education/runtime.test.js ui/education/server.test.js ui/education/coach.test.js ui/education/classroom.test.js
```

`managed.test.js` covers credential isolation, config redaction, fail-closed
startup, input/CSRF checks, metadata validation, bridge failures and malicious
BYOK payloads. `runtime.test.js` starts real child processes and an authenticated
test parent. `managed-ui.test.js` uses installed Chrome through the UI's
Playwright dependency to exercise managed selection inside a sandboxed iframe,
prices, local BYOK calls, config failure and recovery at a mobile viewport.
Provider completions are deterministic test fixtures; these tests do not spend
account credit or certify a live cloud model.
