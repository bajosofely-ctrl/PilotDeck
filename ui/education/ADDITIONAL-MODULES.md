# Additional Education Modules

Imported on 2026-10-28. Both modules follow the existing protected PilotDeck
education entry and run in separate loopback processes/origins. They do not
read PilotDeck model credentials, conversation history, memory or settings.
As with the original knowledge module, the local standalone ports themselves
are not PilotDeck login endpoints.

## AI Literacy

- Source: https://github.com/JaniceWei99/AI-Lessons
- Pinned revision: `2cd0e0fbead893e5ca8c3698847f2e5bd373d176`.
- License: unchanged upstream MIT notice in `ai-lessons/LICENSE`.
- Route: `/education/ai-literacy`; default origin: `http://localhost:3011`.
- Override port with `PILOTDECK_AI_LESSONS_PORT`.
- 52 lessons: Standard 5, Standard 15, Lab 10, App Inventor 10, Web AI 12.
- Runtime HTML, JS and CSS imported with Git blob SHA-1 verification using
  `import-ai-lessons.mjs`. The importer overwrites upstream runtime files;
  reapply local adaptations after importing.
- Local adaptations: system fonts instead of bundled fonts; homepage source
  and license attribution; per-edition progress keys; canonical lesson IDs for
  quiz completion, including missing completion labels in upstream directories;
  a code-selection fallback if clipboard access is denied; fixed-nav scroll offset.
- Pages and quizzes work without model configuration. Coding lessons contain
  instructions and examples; this is not a hosted Python or App Inventor runtime.
- Content and answer correctness have not been independently reviewed by a
  teacher. Browser verification establishes integration behavior, not pedagogy.

## Study Coach

- Source: https://github.com/X-RayLuan/Openclaw-Study-Coach
- Pinned revision: `59c4793b01e8d50cd26a4c3b3b9d8f5eda44c444`.
- License: unchanged upstream MIT notice in `study-coach/LICENSE`.
- Nine unchanged `.claude/skills/*/SKILL.md` files are retained as downloadable
  `study-coach/skills/*.md` documents.
- Route: `/education/study-coach`; default origin: `http://localhost:3012`.
- Override port with `PILOTDECK_STUDY_COACH_PORT`.
- Local interface offers math, reading, writing, English and mistake review;
  grades 1-12; separate conversations by mode/grade; Markdown export and skill
  downloads. Some specialized source skills primarily target elementary
  students; grade selection does not establish full curriculum coverage.
- Model setup is independent: DeepSeek or Alibaba Cloud Bailian's compatible
  chat API. The key is held in page memory, supplied with each request, and
  never written to browser storage, disk, logs, or an iframe URL. Reopening
  the module clears the key. Endpoint/model/key must be configured before chat.
- Conversation text is stored only in this module's localStorage, and is sent
  to the selected model provider on submission. New conversation clears the
  current mode/grade conversation; users can export first.
- The local server accepts JSON requests only from its own origin, limits
  sizes/concurrency/duration, and permits only explicit HTTPS provider hosts.
  Redirects are rejected. It never inherits PilotDeck credentials or Node hooks.
- Skills are used as educational reference in the model's system prompt.
  Filesystem writes, tools, profile updates, points and scheduled reminders
  described upstream are not executed. No autonomous agent is installed.

## Verification

Run the original education tests plus `coach.test.js`, `lessons.test.js` and
`modules-browser-smoke.mjs`. The additional browser journey checks all 52 lesson
URLs, quizzes/progress for all five editions, language switch, retained state,
independent origins, skill downloads, coach settings, export and 320/390px views.
Coach response tests use fixtures. No real external model response is verified
until a user configures their independent provider and key.

Verified on 2026-10-28: 98 targeted UI/process/HTTP/coach/progress tests passed,
with one existing Windows symlink test skipped. Production build passed.
Original knowledge-module and new-module Chrome journeys passed on desktop,
390px and 320px viewports. Screenshots are in `logs/education-additions/`.
