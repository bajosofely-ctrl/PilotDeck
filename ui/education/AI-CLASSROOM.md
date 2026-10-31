# AI Usage Classroom

Local integration of `https://github.com/idsulik/apeit`, pinned at
`5341f8ed0454d8a9a52d845db05bdeeed0252d90` on 2026-10-29.

## Source and adaptation

`ai-classroom-source/` is the unmodified Git archive of that commit, including
the original README and all seven lessons and exercises. No other recommended
repository was imported. The upstream README credits Anthropic's tutorial
as the source of its educational content.

No LICENSE file or explicit reuse license was found in this revision. No
license is inferred or assigned by this integration. This is a local working
copy; public redistribution requires resolving permission for the upstream
web code and its educational content.

`ai-classroom/` contains the local runnable adaptation. It retains apeit's
sidebar/lesson layout and original stylesheet. `local-app.js` reimplements
its navigation, local progress and exercise flow with the fixes needed by
the host. `lessons.js` is a Chinese teaching adaptation of the seven existing
topics, with school-focused examples, reference prompts, comparison exercises
and independent checking questions. It is not a verbatim translation or an
unchanged upstream release.

Missing upstream navigation destinations are omitted. Exercise wiring is
consistent; answers render as text rather than HTML. No remote fonts, syntax
highlighting scripts, trackers or runtime dependencies are needed for reading.
No trained model weights or package installation are needed for this module.
The six local SVG controls are rendered from the host's installed lucide-react;
its MIT notice is retained in `ai-classroom/icons/LICENSE`.

## Runtime

- Host button: AI 使用小课堂.
- Host route: `/education/ai-classroom`.
- Independent child origin: `http://localhost:3015/`.
- Override: `PILOTDECK_AI_CLASSROOM_PORT`.
- The parent route and metadata endpoint use the existing PilotDeck auth guard.
  The loopback child listener itself is independently accessible locally, as
  with the other education modules. This does not change PilotDeck's existing
  local-auth bypass setting.
- The child starts on selection. Parent credentials/configuration are not
  inherited or passed into the iframe.
- Packaging uses the existing education directory copy; there is no separate
  build step for the classroom.

## Exercises and storage

Reading and drafting work without an API key. Actual model requests require
independent configuration in the module. Supported fixed destinations are
Anthropic Messages, DeepSeek chat completions and Alibaba Cloud Bailian
compatible chat completions. The student/teacher chooses an available model
ID; Anthropic has no hardcoded model default.

`POST /api/classroom/complete` requires JSON and the exact child Origin/Host,
rejects unsupported providers, limits content/concurrency and uses a timeout.
Requests cannot target arbitrary URLs or follow redirects. Only explicit
exercise actions send prompts to the selected provider; charges may apply.
Prompts are sent unchanged so that students can compare their effects.

API keys exist only in the open page's memory and each outgoing request.
They are not stored in localStorage, URLs, logs, source or shared host settings.
The local child server receives them to make the provider request; this is
not a direct browser-to-provider connection. Refresh/close clears configuration.

The origin-specific `pilotdeck-ai-classroom-v1` localStorage record holds
lesson selection, manually marked completion and prompt drafts. AI replies
remain in page memory and can be exported to Markdown. Reopening/changing
lessons discards their replies. No host conversations or memories are shared.

## Checks

```powershell
node ui/node_modules/vitest/vitest.mjs run --config ui/src/components/education/vitest.config.ts ui/education/classroom.test.js ui/education/runtime.test.js ui/education/server.test.js ui/src/components/education/EducationPortal.test.tsx ui/src/components/education/EducationApp.test.tsx
node ui/education/classroom-browser-smoke.mjs
```

The browser smoke uses a new disposable Chrome context against the running
PilotDeck service (default 3001), fixture model responses, and checks navigation,
draft/progress persistence, model configuration, request failures, export,
text-only response rendering, no external browsing requests and narrow layouts.
It does not charge a real provider or validate actual model quality. Teaching
content has not been independently reviewed by a teacher.

Verified locally on 2026-10-29: 62 targeted tests passed (one existing Windows
symlink test skipped), the PilotDeck production build passed, and the browser
smoke passed at desktop, 390px and 320px widths. Screenshots and an exported
fixture exercise are in `logs/ai-classroom/`. The complete static module,
including local icons and their notice, is approximately 46.3 KiB.
