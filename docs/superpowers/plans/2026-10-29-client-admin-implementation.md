# Client and admin implementation

> Implementation follows the approved requirements in ../specs/2026-10-29-client-admin-requirements.md.

**Goal:** Add a separately deployable operator service and connect customer clients without moving local execution to the server.

**Architecture:** Independent Express/SQLite service under `ui/platform/server`, standalone React admin under `ui/platform/admin`, opt-in local client integration. Existing local mode remains available during development. The service never mounts local file/terminal/gateway routes.

**Stack:** Existing Node 22, Express, better-sqlite3, bcrypt, React, Vite and lucide dependencies. Integer 10^-12 RMB ledger units with micro-RMB API prices and top-ups, transactional accounting, opaque hashed sessions, encrypted provider secrets.

## Contracts

- API prefix `/api/platform`. JSON errors `{error: string, code?: string}`.
- Sessions use `Authorization: Bearer <opaque-token>`. Login response `{token,user}`.
- Customer user `{id,email,role,status,deviceLimit,concurrencyLimit,apps}`. Admin is a separate role, cannot self-register.
- Auth: POST `/auth/login` `{email,password,deviceId,deviceName}`, POST `/auth/code` `{email,purpose}`, POST `/auth/register` `{email,password,code,deviceId,deviceName}`, POST `/auth/reset-password`, GET `/me`, POST `/auth/logout`, POST `/auth/change-password`, GET `/devices`, DELETE `/devices/:id`.
- Admin: GET/POST `/admin/users`, PATCH `/admin/users/:id`, POST `/admin/users/:id/reset-password`, GET/DELETE `/admin/users/:id/devices[/:deviceId]`; GET/PUT `/admin/settings`; GET/POST `/admin/models`, PATCH `/admin/models/:id`; GET/PUT `/admin/apps`; GET/POST `/admin/releases`.
- Wallet: GET `/wallet`, GET `/ledger`, POST `/redeem` `{code}`; GET/POST `/admin/codes`, POST `/admin/codes/:id/revoke`; GET `/admin/ledger`, POST `/admin/users/:id/adjustments` `{amountMicros,reason,requestId}`.
- Model catalog: GET `/models?appId=chat` without upstream secrets.
- Relay: POST `/relay/:appId/:modelId/*` with provider-native body. Requires `Idempotency-Key`, preserves streaming response protocol. Actual usage only. Missing usage is pending review.
- Settings include `registrationEnabled`, `deviceLimit`, `concurrencyLimit`, `defaultApps`, `giftEnabled`, `giftAmountMicros`, `giftExpiryDays`.
- Model fields: `id,name,provider,protocol,baseUrl,upstreamModel,apiKey,enabled,inputPriceMicros,outputPriceMicros,maxInputTokens,maxOutputTokens,capabilities`. Prices are micro-RMB per million tokens. Protocols: openai/openai-responses/anthropic/google.
- Apps: `{id,name,enabled,defaultModelId,modelIds}`. IDs include chat, automation, skills, learning.
- Backend exports `createPlatformApp(options)` -> `{app,db,close}`. `options` supports dbPath, encryptionKey, bootstrapAdmin, sendCode, fetchImpl for real integration tests.
- Shared backend context: `{db,requireUser,requireAdmin,getSettings,seal,unseal,fetchImpl}`. `mountBilling(app, context)` registers billing/relay routes. `grantSignupGift(db,userId,settings)` called within registration transaction. Export helpers from billing.js.

## Tasks

1. Accounts/service bootstrap and operator configuration. Test role boundaries, password/session revocation, email code expiry/reuse, device limits, encrypted keys.
2. Wallet/relay. Test concurrent redemption and reservation, exact price snapshots, gifts, no overdraft, missing usage, idempotency and provider-native protocols.
3. Admin UI. Real API-driven tables/forms with Chinese labels; no demo data or exposed provider secrets.
4. Client integration. Managed sign-in before workbench, account-local storage and runtime lifecycle, server-only model credentials, learning integration, account/wallet/devices.
5. Delivery and verification. Local service startup, builds, browser checks, deployment configuration and backup/restore tests. Document any unimplemented requirements explicitly.

## Global Constraints

- Preserve existing dirty files and learning changes.
- No production credentials, prices, gifts or users fabricated.
- No paid external calls during verification.
- A working admin page alone does not constitute completion of client isolation, billing coverage, updates, or production deployment.
- Commercial licenses, domain/TLS, mail credentials, model credentials, server access and signing remain release prerequisites.
