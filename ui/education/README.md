# Education Module

Navigation: PilotDeck sidebar -> Education (`/education`) -> select the
"中小学知识图谱与学习诊断" module button -> embedded learning site
(`/education/knowledge`). The selection page does not mount an iframe or poll
the education service. Both views retain the PilotDeck sidebar. The module's
back button and the sidebar Education button return to module selection.
Subjects and learning tools are selected inside the iframe.

The selection page also includes **AI 通识与实验** (`/education/ai-literacy`)
and **AI 学习教练** (`/education/study-coach`). See
[`ADDITIONAL-MODULES.md`](./ADDITIONAL-MODULES.md) for source revisions, licenses,
ports, independent model setup and verification limits.

**AI 训练实验室** (`/education/training-lab`) adds browser-based model
training. See [TRAINING-LAB.md](./TRAINING-LAB.md) for its source, port,
storage, build instructions and tested workflows.

**AI 使用小课堂** (`/education/ai-classroom`) is a local Chinese adaptation
of idsulik/apeit, with seven practical prompting lessons and optional live
exercises. See [AI-CLASSROOM.md](./AI-CLASSROOM.md) for provenance, upstream
license status, independent model settings and verification.

The host page and runtime metadata endpoint follow PilotDeck authentication.
Local authentication is disabled by default in PilotDeck; education follows
that setting. To require account login, set `PILOTDECK_DISABLE_LOCAL_AUTH=0`
for both the UI build and server startup. Opening education and using courses
or knowledge diagnosis requires no AI model setup. Study Coach has its own
model settings for AI replies.
No PilotDeck token is sent into the frame. The loopback-only static education
service remains independently accessible locally; the login guard covers the
PilotDeck entry, not direct access to the standalone education port.

`site/` contains an adapted, pinned snapshot of cn-math-taxonomy. See
`UPSTREAM.md` and `site/LICENSE` for attribution, provenance and local changes.
The education data retains the upstream quality notices.

## Running

The normal PilotDeck UI server automatically starts this module, even before
any AI provider is configured. It runs in a separate Node process at
`http://localhost:3010`. The knowledge module has no model configuration or
account system. Additional modules start when selected.

The port can be set through `PILOTDECK_EDUCATION_PORT` before starting PilotDeck.
It must differ from the PilotDeck UI port. A collision produces a visible error,
without stopping PilotDeck or choosing a different port. Release the occupied
port and use Retry.

Learning profiles, answers and progress live in this education origin's browser
storage. Use the same hostname, port and browser profile to access existing
records. Changing the port or clearing browser data does not migrate records.
The module does not read or write PilotDeck conversations, memory or settings.

This integration targets the local Web deployment. The Docker and desktop build
include the education files, but remote/container exposure is not configured:
the education listener binds to loopback and the host portal accepts only local
education origins. Remote use requires a separately designed origin/proxy setup.

For standalone local use, run `node ui/education/server.js` with Node 22.
`GET /_health` on the education origin checks the static service. The host's
`GET /education/runtime.json` reports readiness and its local URL only.
An optional `module=ai-literacy`, `module=study-coach` or
`module=training-lab` or `module=ai-classroom` selects the other runtimes.
The module polls `?check=1` every five seconds for passive status. A stopped
child produces a retryable error. Opening a module or explicitly retrying starts
it again; passive checks do not restart it.

## Files

- `server.js`: static site, content security policy and IPC/disconnect lifecycle.
- `runtime.js`: credential-free child environment, stable port, readiness and stop.
- `site/`: educational content and original browser-side diagnosis engine.
- `upstream-tests/`: upstream behavior checks adapted only for their file paths.

The host intentionally has no educational database API or iframe messaging.
Browser network policy restricts educational resource requests to its own
origin. External promotion and outbound telemetry are removed.

## Verification

The module-selection flow was verified on 2026-10-28:

- 64 education, route, sidebar and main-area tests passed; 7 existing
  `ProtectedRoute` tests passed separately.
- 7 HTTP/process tests passed; the Windows file-symlink test remains skipped.
- Production build passed and the managed local deployment was restarted.
- Chrome desktop/mobile journeys passed for module selection, iframe entry,
  return through the module header or sidebar, retained sidebar, refresh/back,
  four subjects (839 math, 493 Chinese, 724 English,
  269 physics), graph canvas, diagnosis, export, printing, isolated storage,
  and retry after a failed iframe connection.
- Logged-out route blocking and independence from AI model configuration were
  checked with the real `ProtectedRoute` in component tests. The live browser
  journey used the existing local authentication bypass setting.

From the repository root with Node 22 and pnpm 10.32.1:

```sh
pnpm --dir ui exec vitest run education/server.test.js education/runtime.test.js
node ui/node_modules/vitest/vitest.mjs run --config ui/src/components/education/vitest.config.ts ui/src/components/education/EducationPortal.test.tsx ui/src/components/education/EducationApp.test.tsx ui/src/components/app-shell/SidebarV2.test.tsx ui/src/components/app-shell/MainAreaV2.test.tsx
node ui/node_modules/vitest/vitest.mjs run --config ui/src/components/education/vitest.config.ts ui/education/coach.test.js ui/education/lessons.test.js
node ui/education/upstream-tests/test_engine.cjs
node --test ui/education/upstream-tests/test_adaptation.cjs ui/education/upstream-tests/test_pages.cjs
pnpm --dir ui run build
node ui/education/browser-smoke.mjs
node ui/education/modules-browser-smoke.mjs
```

The browser smoke test uses installed Chrome and a disposable browser context.
Start PilotDeck first. Override `EDUCATION_TEST_HOST` if the UI uses a port other
than 3001. For a login-enabled deployment, set `EDUCATION_TEST_STORAGE_STATE`
to a Playwright storage state file from an authenticated test session.
Screenshots and a sample exported diagnosis are written to
`logs/education-smoke/`; no test profiles are stored in the user's browser.

Baseline checks before the workbench iframe revision, on Windows with Node
22.23.1 on 2026-10-28:

- 45 portal, route-isolation and sidebar tests passed.
- 7 HTTP/process tests passed. The file-symlink regression test was skipped
  because this Windows account cannot create file symlinks.
- 108 upstream-engine, adaptation and rendered-page checks passed.
- Production build and live Vite readiness proxy passed.
- Chrome desktop (1440 x 1000) and mobile (390 x 844) journeys passed: navigation,
  four subject datasets, rendered graph canvas, diagnosis submission/results,
  JSON export, print-handler invocation, profile persistence, separate storage
  and no host business API or external statistics requests.
- A refused iframe connection transitions to a retryable error even without
  an iframe error event; retry restores the real module in Chrome.

Browser checks invoke the print handler without opening the operating system's
print dialog. Full UI typecheck is not clean: it reports existing React 18/19
type conflicts across the application. The targeted tests and production build
above are the feature's verified checks.
