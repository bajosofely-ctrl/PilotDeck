# Channel / Model Backend Report

Date: 2026-10-29

Status: ready for parent integration. Final backend suite: **80 passed, 0 failed, 0 skipped**.

## Scope

Implemented the backend portion of `2026-10-29-channel-model-center.md`, including the follow-up requirements of at most 100 rows per import and disabled-by-default new channels.

Changed files:

| File | Change |
| --- | --- |
| `ui/platform/server/schema.js` | Transactional channel migration, foreign key and unique pair index |
| `ui/platform/server/modelStore.js` | Shared authoritative channel/model reads and safe admin model projection |
| `ui/platform/server/channels.js` | Channel CRUD, discovery, connectivity test, import, and model/app saves |
| `ui/platform/server/config.js` | Mount channel routes; legacy discovery and model probes resolve current channels |
| `ui/platform/server/billing.js` | Channel-aware authorization and customer catalog |
| `ui/platform/server/channels.test.js` | 13 focused channel/migration/API regression tests |
| `ui/platform/server/account.test.js` | Assert actual channel ciphertext and use guarded channel edit in probe fixture |
| `ui/platform/server/billing.test.js` | Normalize fixture connection data into channels; retain existing billing assertions |
| `ui/platform/package.json` | Include channel regressions in the existing test command |
| This report | Contracts, migration details, verification, and integration notes |

No frontend changes, build, commit, subagent, private environment inspection, real upstream request, live database change, or service restart was performed. Tests use explicit fixture credentials and injected responses or ephemeral loopback mock servers. The existing unrelated working-tree changes were preserved.

## API Details

All paths below have the `/api/platform` prefix. All channel and model management routes require administrator authentication.

### Channels

- `GET /admin/channels` returns `{channels}`. Each row contains exactly `id`, `name`, `provider`, `protocol`, `baseUrl`, `hasApiKey`, `enabled`, and `modelCount`.
- `POST /admin/channels` returns HTTP 201 `{channel}`. An omitted `id` gets a generated UUID. An omitted `enabled` defaults to **false**, even when a key is provided.
- `PATCH /admin/channels/:id` returns `{channel}` and preserves omitted fields. IDs are immutable; do not send `id` on PATCH.
- `provider` is optional. On create, omission uses `custom`; on PATCH it preserves the existing provider. The protocol controls native transport. This avoids mistaking an arbitrary OpenAI-compatible endpoint for the official OpenAI vendor and forcing vendor-specific output-token parameters. Explicit provider names, including `openai` and `ollama`, remain supported.
- API Key omitted, empty, or whitespace-only preserves an existing key. On a new channel these mean no key. There is no implicit clear-key operation.
- A saved key cannot be reused after changing normalized `baseUrl` or `protocol`: a nonempty explicit `apiKey` is required, or the route returns HTTP 400 `CHANNEL_KEY_REQUIRED`. A provider/name/enable-state-only change may preserve the key.
- Keys are encrypted using the existing platform encryption implementation. Neither plaintext nor ciphertext is returned.
- Enabling a channel without a key is rejected unless its provider is `ollama`. A disabled draft may have no key.
- `DELETE /admin/channels/:id` returns `{ok:true}`; linked models, including disabled models, cause HTTP 409 `CHANNEL_IN_USE`. Move those models to another channel first.
- `POST /admin/channels/:id/discover` returns `{models:[{id,name}],truncated}`.
- `POST /admin/channels/:id/test` returns `{ok:true,modelCount}` on success. Failure uses the normal sanitized error response/status.
- Both discovery and channel testing make only model-list **GET** requests. Neither performs generation, creates models, nor creates billing records. Disabled channels can be tested/discovered so operators can configure them before activation.
- These actions share the existing bounded discovery implementation: native auth, no redirects, response-size/page/model limits, timeout, and sanitized upstream failures. Channel discovery/test share an administrator rate limit of 10 requests per minute.

### Models and Applications

- Existing `POST /admin/models` and `PATCH /admin/models/:id` accept `channelId`, model-owned fields, and optional `appIds`.
- New models default to disabled; an explicitly supplied valid `enabled:true` is honored. Both prices must be explicitly provided on create/import, including intentional zero. PATCH preserves omitted prices, limits, enabled state, and capabilities.
- Explicit null/invalid `channelId` is rejected. Changing the channel never copies credentials to the model.
- Admin model responses contain `channelId`, `channelName`, `channelEnabled`, and `appIds`. Compatibility fields `provider`, `protocol`, `baseUrl`, and `hasApiKey` resolve from the current channel. There is no `apiKey` or `secret` field.
- With `appIds`, save updates only this model's membership across all existing applications. Removal clears a default pointing to this model; other defaults remain unchanged. Addition does **not** automatically select a default.
- Omitted `appIds` preserves all memberships/defaults; `[]` removes all assignments. Unknown/duplicate application IDs are rejected before writing.
- Model save, membership changes, default removal, and audit insertion share an immediate SQLite transaction.
- Manual creation or reassignment to a duplicate `(channel_id, upstream_model)` returns HTTP 409 instead of overwriting another model.
- Legacy **create** payloads with connection fields remain supported only when `channelId` is omitted. They create a private channel and a linked model atomically. The legacy adapter activates its channel when a key is present or the provider is keyless Ollama, preserving the old workflow of creating a disabled model and later enabling it.
- Model PATCH no longer accepts connection fields. Use channel PATCH for connection edits; mixing `channelId` with connection fields on create is also rejected.
- Legacy `/admin/models/discover` resolves saved credentials through the channel and retains the URL/protocol credential-reuse guard.

### Atomic Import

`POST /admin/channels/:id/import` accepts `{models:[...]}` with **1 to 100 rows**. Each row supports:

```text
id, name, upstreamModel, enabled,
inputPriceMicros, outputPriceMicros,
maxInputTokens, maxOutputTokens, capabilities, appIds
```

The selected channel comes from the path; rows must not contain `channelId` or connection fields.

HTTP 201 response:

```json
{
  "models": ["newly created public model objects"],
  "skipped": [
    {
      "id": "requested-model-id",
      "upstreamModel": "existing-upstream-name",
      "existingModelId": "retained-model-id",
      "reason": "already_exists"
    }
  ]
}
```

`models` and `skipped` are arrays, not counts. A batch consisting entirely of existing pairs returns an empty `models` array.

Every row is validated before writes, including rows eligible to be skipped. Existing channel/upstream pairs and repeated pairs within the batch are skipped without changing their prices, limits, enabled state, application assignments, or IDs. For a new pair, a colliding global model ID or a repeated ID used for another new pair rejects the entire batch with HTTP 409. A skipped pair takes precedence over its proposed ID because it performs no write.

Insertion, app assignments, and the import audit share one immediate transaction. Runtime database failures also roll back rows already inserted earlier in the batch.

## Migration and Runtime

- `initSchema` invokes `initChannels`.
- Migration creates the channel table, adds `models.channel_id REFERENCES channels(id)`, moves each old connection to its own generated channel, clears old connection copies, and creates constraints in one immediate transaction.
- Every old model receives a distinct channel, even when URLs, provider names, and upstream names match. Existing encrypted credentials are copied byte-for-byte; no key comparison, merging, decryption, or re-encryption is needed.
- Migrated channels start enabled so previously enabled models remain available. Existing model enabled states are preserved, so disabled legacy models remain disabled. This migration/legacy compatibility policy is separate from the new channel API's default-disabled policy.
- Model IDs, names, upstream names, capabilities, prices, limits, app assignments/defaults, account data, and billing data are preserved.
- Rerunning migration does not recreate channels or reassign existing models. Failed migration rolls back DDL, ciphertext movement, and model updates together.
- The old model connection columns remain as inert schema placeholders to avoid rebuilding a referenced model table. Their values are cleared (`provider`, `base_url`, `secret` empty; protocol uses its required placeholder). No production runtime path reads those fields for connections.
- `getModel` and `listModels` explicitly join channels and select only the authoritative channel connection fields.
- Channel and model enable states both gate the customer catalog and relay. A disabled channel fails with HTTP 403 before decryption/reservation/upstream submission.
- Customer catalog `defaultModelId` is null when the configured default is not in the available filtered catalog. The stored app default is retained, so re-enabling restores availability without silently choosing another model.
- The existing generation-based model probe remains available and now uses the current channel with a disabled-channel guard. The new channel test uses discovery only.
- Billing calculations, holds, idempotency, snapshots, settlement, refund, and review logic are unchanged.

## Verification

Exact final command, run from **`D:\PilotDeck\ui\platform`** in PowerShell:

```powershell
& D:/PilotDeck/.cache/runtime/node-v22.23.1-win-x64/node.exe --test server/account.test.js server/billing.test.js server/modelDiscovery.test.js server/channels.test.js backup.test.js integration.test.js
```

Final result:

```text
tests 80
suites 0
pass 80
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 41604.0854
```

Coverage includes:

- Transactional/idempotent migration with two same-endpoint models carrying different encrypted credentials.
- Injected migration failure proving schema, inserted channels, and modified models all roll back.
- Native `better-sqlite3` platform tables populated through real isolated API calls, including account funding and a mocked completed inference. The fixture reconstructs the pre-channel model layout and runs normal schema/billing initialization twice.
- That native migration asserts all non-model table snapshots match exactly, credentials remain byte-identical and decrypt correctly afterward, defaults/permissions/model values remain intact, wallet is unchanged, and foreign-key/integrity checks pass.
- Administrator-only operations; no credential exposure; changed-endpoint guard; missing-key and in-use deletion behavior.
- Default-disabled channels, explicit enable, keyless Ollama, and generic-provider output-token compatibility.
- Import boundary of 100 accepted/101 rejected; all-row validation; duplicate skipping; ID conflict rollback; no price or application overwrites.
- Actual mid-write failures for model/app updates and batch inserts, proving model data, application defaults, memberships, and audits roll back together.
- Deliberately poisoned obsolete model connection fields cannot affect admin reads, legacy discovery, model probes, or customer inference.
- Channel disable hides the model and denies relay/model probe without a new upstream request or billing call; re-enable restores the retained default.
- Existing account, billing, protocol/SSE, backup, and chat/learning/automation integration assertions pass.

## Handoff Boundaries

- Frontend build/browser tests remain parent-owned and were not run here.
- No migration was applied to the live database, and port 3100 was not restarted or otherwise altered. Parent reported a verified backup and retains rollout ownership.
- Test databases and upstream responses are isolated fixtures. Production provider availability and credentials were deliberately not tested.
- Changing application availability through model saves never automatically chooses defaults; the operator still sets defaults through existing app management.
