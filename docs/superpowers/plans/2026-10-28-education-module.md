# Independent Education Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated education application accessible from PilotDeck.

**Architecture:** Vendor the static education application under `ui/education/site`.
Run it in an independent child process and browser origin. A standalone React
portal outside workbench providers embeds it without sharing business data.

**Tech Stack:** Existing Node 22.23.1, Express 4, React 18, Vite, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-education-module-design.md`

## Global Constraints

- Preserve education data and algorithms, upstream attribution and licenses.
- Default education port 3010; no automatic port fallback.
- No new runtime dependencies or login.
- No education calls to PilotDeck business APIs, model credentials or databases.
- Keep existing user changes; work in the current deployment checkout.

### Task 1: Import and Adapt Education Content

**Files:** `ui/education/site/**`, `ui/education/UPSTREAM.md`,
`ui/education/upstream-tests/**`.

**Interfaces:** The static root contains `index.html`, `explore/`, `diagnose/`,
`children/`, `assets/`, `data/`, `sw.js`, `manifest.webmanifest` and `LICENSE`.

- [x] Copy the pinned checkout's runtime files and relevant tests, without `.git`.
- [x] Remove promotion/donation/resource-search markup; retain source notices.
- [x] Set `window.CNM_STATS.endpoint` and `cloudflareToken` to empty strings.
- [x] Derive share URL from `new URL('../', location.href)`; bump the SW cache
  namespace for this deployment.
- [x] Run the upstream engine/profile tests using Node; record actual commands.

### Task 2: Standalone Host View and Navigation

**Files:** `ui/src/components/education/EducationPortal.tsx`, portal CSS/tests,
`ui/src/App.tsx`, `ui/src/components/app-shell/SidebarV2.tsx`, sidebar locale
files and affected sidebar tests.

**Interfaces:** `GET /education/runtime.json` returns HTTP 200 with
`{status:"ready",url:"http://localhost:3010/"}`, or 503 with
`{status:"starting"|"error",message:string}`. It is deployment metadata only.

- [x] Write behavioral tests for hub-to-module selection, a ready iframe, failed-service retry, and sidebar
  entry. Assert the frame has no top-navigation sandbox permission.
- [x] Run tests and observe failure before implementation.
- [x] Add a full-document sidebar link to `/education`. The hub lists one real
  module linking to `/education/knowledge`. Route both paths before mounting
  workbench context providers; the hub does not start an iframe.
- [x] Implement fetch with abort/timeout, readiness/error states, reload, return
  and separate-window actions. Use lucide icons and existing style conventions.
- [x] Run the portal and sidebar tests.

### Task 3: Isolated Service and Lifecycle

**Files:** `ui/education/server.js`, `ui/education/runtime.js`,
`ui/education/*.test.js`, `ui/server/index.js`, Dockerfile and desktop runtime
packaging script.

**Interfaces:** `createEducationApp({siteRoot, frameAncestors})` returns an
Express app. `createEducationRuntime({env})` returns
`{start({parentPort}),stop(),getStatus(hostname)}`.

- [x] Write real HTTP tests that serve a temporary site and enforce isolation:
  ```js
  expect((await fetch(origin + '/api/config')).status).toBe(404);
  expect((await fetch(origin + '/')).headers.get('content-security-policy'))
    .toContain("connect-src 'self'");
  ```
- [x] Verify failing tests, then implement static serving and no business routes.
- [x] Write process lifecycle tests for ready status, collision failure and
  cleanup; pass only an allowlist of environment variables to the child.
- [x] Register `/education/runtime.json` before static fallbacks; start the child
  after the UI server binds; stop it during graceful shutdown and parent exit.
- [x] Include `ui/education` in Docker/desktop packaging; document port publishing.
- [x] Run affected backend tests and check independent startup without model setup.

### Task 4: Deploy and Verify

- [x] Build via portable Node 22 and `pnpm --dir ui run build`.
- [x] Restart using `.pilotdeck/stop.ps1` and `.pilotdeck/start.ps1`.
- [x] Verify HTTP readiness, sidebar-to-education navigation and return.
- [x] Run browser journeys on desktop and mobile, including graph, diagnosis
  results, profile save/reload and storage-origin separation.
- [x] Verify no remote analytics or PilotDeck business requests from education.
- [x] Review the final diff and document operational commands and limitations.

## Completion Evidence

Completed on 2026-10-28. Production is available at
`http://localhost:3001/education`, with the education service on port 3010.
See `ui/education/README.md` for reproducible verification and known limits.
Final checks: 45 UI tests, 7 HTTP/process tests, 108 content/engine checks;
one file-symlink check skipped due to Windows permissions. Production build,
live development proxy, desktop/mobile browser journeys and refused-frame
recovery passed. Review findings for the development proxy, directory index
containment and iframe-failure detection were addressed.
