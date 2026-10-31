# Independent Education Module

The user approved this design on 2026-10-28.

## Experience

The user's final clarification is a two-level entry inside the PilotDeck
workbench. Education / 教育 in the primary sidebar navigates internally to
`/education`, which shows the "中小学知识图谱与学习诊断" module button.
Selecting it opens `/education/knowledge` and mounts the learning site's iframe.
The workbench sidebar remains available on both pages. The child site supplies
subject and learning-tool selection. The module's back button and the sidebar
Education button return to module selection and unmount the iframe.
Reload and a collapsed-sidebar toggle remain available.

Preserve all four subjects, the knowledge graph, adaptive diagnosis, child
profiles, saved results, export, printing and offline caching from
`xiaoyang111222/cn-math-taxonomy`, pinned at
`e0f931badaed994fa8e10cfc7a30cdbdffc2dfd5`.

## Boundaries

The imported site lives in `ui/education/site`. It runs in a separate Node
process on a stable, separate local origin, default `http://localhost:3010`.
Its localStorage and service worker belong to that origin. It has no PilotDeck
API, model, memory, session or database integration. No child content is
exchanged with the host; only process readiness is communicated internally.

The host view mounts inside the authenticated workbench. It requests
`/education/runtime.json` with PilotDeck authentication to discover readiness
and the education URL. The frame receives no host credentials or business data.
The embedded frame uses an explicit sandbox. The child service has a CSP
limiting network requests to its own origin.

The education entry follows the host's login setting (local bypass by default).
After login, AI model configuration or Gateway failure does not block education.
The standalone static service on loopback remains accessible without an account;
host authentication guards the workbench entry and metadata, not that local port.

The port is configurable with `PILOTDECK_EDUCATION_PORT` (1-65535, default 3010).
Do not silently change it on collision: changing origins changes the location
of students' saved records. A failed education startup leaves PilotDeck usable
and displays a retryable education error. The local deployment is the acceptance
target; Docker needs a separate published education port for remote access.

## Content

Keep upstream attribution, license files and dataset quality notices. Remove
external promotion, donation and unrelated resource-search entry points.
Disable outbound statistics and replace upstream-site share URLs with the
local education origin. Preserve the vendored graph and QR libraries.
Do not rewrite lesson content, question answers or diagnosis algorithms.

## Lifecycle

The UI server owns the education child process. It starts independently of
model onboarding and stops when the parent shuts down or its IPC channel
disconnects. The child receives only runtime/OS environment variables it needs,
not model credentials or PilotDeck configuration. Packaging includes the
education directory; existing start/stop scripts continue to work.

## Verification

Exercise real static HTTP requests, path containment, CSP, missing routes and
port collisions. Test readiness and cleanup. Run upstream diagnosis tests.
Build the production UI and run affected UI tests.

In a browser verify: entry and return navigation; all four subjects; rendered
graph; diagnosis answers and results; profile persistence after reload;
exports/printing availability; desktop/mobile layout; distinct storage origins;
no education calls to PilotDeck business APIs or remote analytics.
