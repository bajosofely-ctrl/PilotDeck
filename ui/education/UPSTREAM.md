# Education Content Provenance

Imported on 2026-10-28 from `xiaoyang111222/cn-math-taxonomy`, pinned at
`e0f931badaed994fa8e10cfc7a30cdbdffc2dfd5`.
Source: <https://github.com/xiaoyang111222/cn-math-taxonomy/tree/e0f931badaed994fa8e10cfc7a30cdbdffc2dfd5>.
The local review checkout was `.cache/cn-math-taxonomy-review`.

## License And Attribution

`site/LICENSE` is an unchanged copy of the upstream
Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) license.
The pinned README's license section expressly describes the graph data,
question bank, diagnosis code and documentation as CC BY-NC 4.0.
The upstream `package.json` instead contains `"license": "ISC"`. That metadata
conflicts with the actual license and README; it was not copied or used to
relabel the imported work. The small local `site/package.json` only establishes
CommonJS semantics for the upstream engine's Node tests under PilotDeck's
ES-module package. This import does not establish commercial-use permission.
The README directs commercial-license requests to the upstream author via
`@hassanyehiaa` on X or an upstream issue.

The unchanged `site/assets/vendor/VENDOR.md` and four `LICENSE-*.txt` files
retain the vendors' notices. Cytoscape 3.30.4, dagre 0.8.5,
cytoscape-dagre 2.5.0 and qrcode-generator 2.0.4 retain their MIT licenses,
including the notices in their distributed JavaScript. They are not relabeled
CC BY-NC. Upstream identifies graphlib and lodash as bundled with dagre.

Every page retains the upstream repository and issue links, and displays the
source name, local-adaptation notice, actual license link and AI-data notice.

## Data Provenance And Limitations

The five runtime JSON files and two actual textbook mapping files are copied
unchanged. They include mathematics, Chinese, English and physics. No questions,
answers, curriculum content, prerequisite edges or diagnosis algorithms were
rewritten. Source URLs, retrieval dates, revision notes, `verbatim` flags and
unverified references remain in the JSON.

The upstream README describes the dataset as an AI-generated draft without
teacher review. Topic granularity, answers, mastery criteria and especially
hard/soft prerequisite relationships need teacher review. Automated checks do
not constitute independent curriculum or answer validation. English listening
and speaking are not covered.

The source materials described upstream include Ministry of Education
curriculum standards, People's Education Press mathematics/English/physics
textbooks and the unified primary Chinese curriculum. Some standards and
textbook mappings use third-party transcriptions or inferred tables of
contents. Many primary/high-school/English entries are marked unverified.
The standards JSON explicitly notes that some references labeled with a 2025
revision still use older text without a full revision comparison. Those
limitations are preserved, not presented as fresh verification by PilotDeck.
The data format credits Marble's `withmarbleapp/os-taxonomy`; the upstream
README also describes consulting the `luw2007/os-taxonomy-beijing` README.

## Import And Adaptations

Runtime files were copied with native PowerShell `Copy-Item`, selecting:
`index.html`, `explore/`, `diagnose/` runtime JS/CSS/HTML, `children/`,
`assets/` runtime JS/CSS/icons/vendor files, five runtime JSON files,
the actual `data/mappings/` files, `sw.js`, `manifest.webmanifest` and `LICENSE`.
No embedded Git repository, generation/deployment scripts, screenshots, sponsor
image, placeholder mapping, bulk review batches or general upstream docs were
included.

Local changes:

- Removed IQ-test banners/cards from all five HTML pages, resource-search
  navigation, and the dynamically generated diagnosis-result promotion.
  No donation UI is present; the unused sponsor image was not imported.
- Set both statistics configuration destinations (`endpoint`,
  `cloudflareToken`) to empty strings. The existing local hooks remain usable,
  but no remote statistics requests or scripts are enabled.
- Derive the share-card QR destination from `new URL('../', location.href)`,
  with only `from=share` appended. Student data and diagnosis parameters are
  not added to the URL. PWA illustrations no longer display the upstream host.
- Use the stable `pilotdeck-education-v1` service-worker cache namespace.
  Only declared static assets are intercepted; unknown routes, API probes,
  other origins and non-GET requests bypass it. Failed/redirected responses
  are not cached. Direct index URLs retain their own offline documents.
  Updates complete within the fetch event lifetime, timers are cleared, and
  cache cleanup only touches older caches in this namespace.
- Include the previously omitted maskable icon in the offline shell, and
  describe all four subjects in the manifest.

The static app expects its own origin, normally `http://localhost:3010/`.
The host module-card thumbnail is a new screenshot of this adapted local graph,
captured at 1280 x 900; it does not retain the upstream screenshot's promotion.
Storage keys remain upstream-compatible on that origin. There is no host API,
PilotDeck data or parent-frame messaging integration in this content.
Sharing a localhost URL points to the scanning device's own localhost; using
the local-network hostname for access produces a QR URL with that same host.
The parent task supplies the static server, isolation policy and host hub.

## Verification

From `D:\PilotDeck`:

```powershell
& '.cache/runtime/node-v22.23.1-win-x64/node.exe' 'ui/education/upstream-tests/test_engine.cjs'
& '.cache/runtime/node-v22.23.1-win-x64/node.exe' --test 'ui/education/upstream-tests/test_adaptation.cjs'
& '.cache/runtime/node-v22.23.1-win-x64/node.exe' --test 'ui/education/upstream-tests/test_pages.cjs'
```

`test_engine.cjs` is the original `tests/test_engine.js`, renamed for CommonJS
and adjusted only for its relocated engine/data paths and command comment.
It exercises the actual imported engine and full data with Node built-ins.
The pinned source contains no separate direct Node profile test suite.

`test_adaptation.cjs` adds behavioral checks for profile/history persistence,
statistics network silence, the real QR encoder's local payload, service-worker
installation, offline documents, route bypass and failed refreshes.
`test_pages.cjs` uses the workspace's existing jsdom development dependency
to execute real page scripts: all four subjects, answer-to-result flows,
history saving, JSON downloads, print lifecycle and rendered links. It adds
no runtime dependency to the static app. Canvas layout, actual browser
printing, service-worker browser integration and host navigation remain for
the parent task's browser acceptance journey.

Results on 2026-10-28 with Node 22.23.1: upstream engine 92 passed / 0 failed;
adaptation 7 passed / 0 failed; rendered pages 9 passed / 0 failed.
SHA-256 comparison also confirmed the imported engine, profile logic, five
runtime datasets, license and all vendor files are byte-for-byte unchanged.
