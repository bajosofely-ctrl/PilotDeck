# Channel and Model Center Implementation Plan

**Goal:** Deliver the approved two-tab center: independent channel connections and models, with discovery/import and manual model creation.

**Architecture:** Channels own connection name, protocol, URL, encrypted credential and enabled state. Models refer to a channel and own display/upstream names, capabilities, Token prices and limits. Channel availability and model availability both gate customer access.

**Tech Stack:** Existing Express, better-sqlite3, React, Lucide, Vite and Playwright.

**Spec:** The user's approved screenshots and two-function design in this conversation.

## Constraints

- Preserve existing model IDs, prices, enabled flags, application assignments and billing history.
- Migrate existing connections transactionally and idempotently. Never expose credentials to clients or in logs.
- Changing channel URL or protocol with a saved key requires a new explicit key.
- New models start disabled; prices must be explicitly supplied, including zero when intended.
- Keep input/output Token pricing. Do not introduce image-generation or points billing.
- Admin-only channel APIs; customers only receive permitted, enabled models through the existing catalog.
- Channel disable must prevent inference as well as remove catalog entries.
- Retain unrelated dirty work. No commits, monetary changes, paid live probes or upstream calls for verification.

## Tasks

- [x] Backend and regression tests: add channel migration and CRUD/discovery/import APIs; resolve channel connections for inference, model tests and catalog. Support atomic model/application changes and duplicate-safe imports.
- [x] Admin UI: channel/model tabs, searchable lists, channel form, model form referencing channel, application assignment, batch discovery with explicit prices, errors and manual fallback.
- [x] Verification: backend regressions, mocked browser flows, production build, desktop/mobile visual inspection.
- [x] Local rollout: verify service ownership, create SQLite backup, restart platform with existing launcher, check migration and existing model without changing money or making paid calls.

## API Contract

- `GET /admin/channels` -> `{channels:[{id,name,provider,protocol,baseUrl,hasApiKey,enabled,modelCount}]}`
- `POST /admin/channels`, `PATCH /admin/channels/:id` accept `{id?,name,provider?,protocol,baseUrl,apiKey?,enabled}`; omitted API key preserves it at the same endpoint.
- `DELETE /admin/channels/:id` rejects channels with associated models.
- `POST /admin/channels/:id/discover` -> `{models:[{id,name}],truncated}`; never creates records.
- `POST /admin/channels/:id/test` tests model-list connectivity without a generation call; reports `{ok,modelCount}` or a sanitized error.
- `POST /admin/channels/:id/import` accepts `{models:[{id,name,upstreamModel,enabled,inputPriceMicros,outputPriceMicros,maxInputTokens,maxOutputTokens,capabilities,appIds}]}` and imports atomically. Existing channel/upstream pairs are skipped, not overwritten. Return `{models,skipped}`.
- Existing model create/patch accepts `channelId` instead of connection fields; `appIds` optionally updates just this model's app assignments transactionally. Omitting assignments preserves them.
- Admin model responses add `channelId`, `channelName`, `channelEnabled`, `appIds`; models retain their own `enabled`.

## Validation Cases

Migration repeatability and preserved encrypted keys/IDs/prices/apps; new model uses updated channel connection; disabled channel blocked in catalog and inference; unauthorized channel/discovery/import requests; credential reuse endpoint guard; atomic import rollback and duplicate handling; app removal clears invalid default; manual model without credential fields; batch selection/prices and existing-model protection; stable IDs after failed saves; network errors and mobile layouts.

## Review Resolutions

- Preserve provider-specific behavior through protocol presets for official OpenAI and keyless Ollama; no extra required field in the model form.
- Use one `MAX_APP_MODELS = 5000` bound for app settings and model/import assignments; import batches remain limited to 100.
- Compare Google model names after removing the optional `models/` prefix, both in import marking and server duplicate checks. Preserve previously stored model names and IDs.
- Reject a channel protocol change if it would introduce aliases for existing models.
- Initial backend suite passed 80 cases; initial browser suite passed 23 cases. Added two backend and two browser regression cases for review findings.
- Real-backend browser integration passed with an isolated database and loopback provider. Actual saved database migration dry run preserved all model fields, ciphertext, app assignments and ledger; repeat migration and integrity checks passed.

## Final Verification and Rollout

- Final backend suite: 82 passed, including the real-backend browser integration with `PLATFORM_BROWSER_TEST=1`.
- Final browser run: 23 passed; the two new cases initially failed because of test locator ambiguity. Corrected them to use combobox/cell roles; targeted rerun passed both. All 25 scenarios covered.
- Production Vite build passed; desktop channel list, model list, import, and mobile form screenshots inspected.
- Final verified snapshot: `.pilotdeck/platform/backups/before-channel-center-final-20261029.sqlite`.
- Restarted the identified local platform process using `ui/platform/start-local.ps1`; service remains at `http://127.0.0.1:3100`.
- Confirmed the new channels endpoint is registered and requires authentication, service health is OK, and SQLite integrity/foreign-key checks pass.
- Compared live migrated model values and encrypted connection against the final snapshot: unchanged. Apps, users, billing ledger/lots/calls and stable session identity fields also match. Session last-seen timestamps legitimately advance from active clients.
- Rollout incident: frontend assets were built into the served directory before the backend restart, causing a temporary `API not found` on channels. Resolved by restarting the backend. User should fully refresh the page, not just retry one cached resource. Future upgrades must stage frontend assets until backend readiness.
- No real upstream probe, customer credit, price change, or production remote deployment was performed.
