# AI 训练实验室

Vendored GenAI Teachable Machine, Copyright 2023 Nicolas Pope, MIT.

- Repository: https://github.com/knicos/genai-tm
- Source commit: `4a9b696f03cd5fd6f346424a56fb51ba9cfe86cf`
- Archive: https://codeload.github.com/knicos/genai-tm/tar.gz/4a9b696f03cd5fd6f346424a56fb51ba9cfe86cf
- Archive SHA-256: `762eea09c91ba39f80edc9566476362e37c275426ba1027ee3daeff091a5303b`
- Source: `ui/education/training-lab-source/`
- Production static root: `ui/education/training-lab/`
- Original README and LICENSE are retained in source; LICENSE and dependency notices ship in the static build.
- Models are fetched from the endpoints actually used by pinned `@genai-fi/classifier@1.3.6`, with their SHA-256 checksums in `training-lab-assets.json`. MediaPipe assets come from the npm lockfile-pinned `@mediapipe/hands@0.4.1675469240`.
- The source archive plus `training-lab-upstream.patch` reproduces all 265 vendored source files. Model weights are about 18 MB before MediaPipe; the complete static build is approximately 46.5 MiB.

## Rebuild

Use Node 22.23.1. From the repository root:

```powershell
$env:PATH = 'D:\PilotDeck\.cache\runtime\node-v22.23.1-win-x64;' + $env:PATH
npm.cmd ci --prefix ui/education/training-lab-source --ignore-scripts --no-audit --no-fund
node ui/education/build-training-lab.mjs
node ui/education/training-lab-browser-smoke.mjs
node ui/education/import-training-lab.mjs --verify
```

Builds use the checked-in package lock and asset checksums. `curl` is used for downloads; `git` and `tar` are used by the import script. The asset cache is under `.cache/training-lab-assets`; a cold build downloads and verifies resources. Downloads use bounded concurrent ranges because the upstream hosts can be slow. The explicit maintainer flag `--record-assets --assets-only` records updated checksums and must not be used for routine builds.

`import-training-lab.mjs` downloads and verifies the pinned archive, applies the checked-in patch and refuses to overwrite a nonempty source directory. Pass a new empty destination directory to import a separate copy, or `--verify` to compare the current vendored source against archive plus patch without changing it. It does not use the stalled Git clone.

The focused regression suite can be run from `training-lab-source` with `node node_modules/vitest/vitest.mjs run src/workflow/Trainer/Trainer.test.tsx`. All eight tests pass, including checkpoint failure not unlocking the next workflow step.

## Local Adaptation

The original TensorFlow.js classifier and training algorithms remain in place. No predictions, training progress or trained models are simulated. The application retains image, pose, hand and speech workflows, with Chinese core labels and English fallback for untranslated advanced material and ImageNet concept names. Training is disabled until the checkpoint is ready; a failed training attempt cannot report success or unlock the next step. Progress uses the configured epoch count.

Hash routing allows refreshes on a plain static server with no SPA fallback. Runtime assets resolve from `/` on a dedicated origin. This build is not intended to be mounted at a subdirectory on the parent origin.

Local-only policy is enforced after URL settings: remote datasets, PeerJS collaboration, API-backed sharing/deployment, USB and embedded external media are disabled. File uploads, camera/microphone, local ZIP save/open and response behaviors remain available. Remote feature/feedback requests are disabled. System fonts replace CDN fonts. ImageNet concept metadata is bundled, but remote thumbnail examples are omitted. Training data lives in browser memory; export a ZIP before closing/reloading.

The upstream privacy text describes the upstream hosted service, so its footer is removed. Original documentation remains in source for attribution, not as the privacy policy of PilotDeck.

## Host Integration

The parent owns route `/education/training-lab`, title `AI 训练实验室`, and the child service port `3013`. Serve `training-lab/` as `/` on the independent child origin. Entry is `/` (redirects within the hash to `/#/home`).

Keep the existing iframe sandbox flags. Delegate `camera; microphone; autoplay` to the child origin. Camera and microphone need a secure context: Chrome treats localhost as trustworthy; remote deployments need HTTPS. Any parent `Permissions-Policy` must also permit the child origin. Do not disable WebGL.

Chrome-tested CSP (the smoke test runs the application inside a different-origin iframe with this policy):

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob: data:;
connect-src 'self' blob:;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors <explicit parent origins>
```

No CDN, PeerJS, WebSocket, API, external model origin, cross-origin isolation or database is required for local workflows. MediaPipe uses WebAssembly; sound uses Web Audio/getUserMedia. Workers, if created by MediaPipe, must remain same-origin or blob. Blob media is required for uploaded/recorded audio, and downloads must remain allowed for ZIP exports. The current test does not observe worker requests, but `worker-src 'self' blob:` allows the vendored runtime's possible worker paths.

`unsafe-eval` is not required: image training, pose extraction, and MediaPipe hand extraction passed with only `wasm-unsafe-eval`. Inline script permission is also unnecessary for this build. Serve `.wasm` as `application/wasm` (Express static does this). The existing education server's default CSP needs the WASM allowance and explicit blob/data media allowance. Configure this per module. Preserve strict explicit `frame-ancestors` and add the child origin to any parent's `frame-src`/Permissions-Policy allowlists.

## Verification

The production build and eight focused unit tests pass. `training-lab-browser-smoke.mjs` starts temporary parent/child static origins, launches Chrome through `ui/node_modules/@playwright/test`, applies the exact sandbox/permissions/CSP above, and blocks every non-loopback network request. It closes both servers and the browser on completion.

Verified:

- Chinese model selection and locally loaded checkpoints.
- Actual default 50-epoch image training on 16 generated PNG fixtures (eight per class); red squares and blue circles produce different learned predictions, each over 50%.
- Model statistics view, ZIP export containing topology and binary weights, full reload, local ZIP import and subsequent prediction.
- Webcam canvas renders nonblank frames and adds samples inside the sandbox.
- Pose and hand image feature extraction on the bundled photographs, including local MediaPipe JS/WASM/TFLite loading.
- Speech checkpoint loads and microphone recording adds audio/spectrogram samples.
- Home and workspace fit 320px and 390px document widths; the original workspace retains internal scrolling.
- Zero external requests, HTTP failures, page/console errors, or CSP violations across the test.

Evidence: `logs/training-lab/report.json`, screenshots in that directory, and `training-lab-smoke.zip`. The report records the Chrome version and time. Camera/microphone use Chrome's synthetic device flags only in the test runner; the shipped application always uses real browser media devices. Fixture accuracy verifies that training works, not real-world model quality.

Limitations: full training/prediction quality for pose, hand and speech is not covered by this smoke test; these modes are verified through model loading, feature extraction or audio capture. Physical-device permissions and non-Chrome browsers need separate testing. Advanced settings/help and ImageNet labels are partially English. External teaching-material/source links still require the internet when explicitly opened. Local projects must be exported before closing; no automatic persistent project store is added. Collaboration, server-backed sharing, remote datasets, USB and external-media behaviors are intentionally unavailable.

Upstream build warnings about large chunks and browser-externalized `util`/`buffer` remain; no corresponding browser runtime errors occurred in the verified workflows.

## Files

The module consists of:

- `ui/education/training-lab/`
- `ui/education/training-lab-source/`
- `ui/education/training-lab-assets.json`
- `ui/education/training-lab-upstream.patch`
- `ui/education/import-training-lab.mjs`
- `ui/education/build-training-lab.mjs`
- `ui/education/training-lab-browser-smoke.mjs`
- `ui/education/TRAINING-LAB.md`

The host integration in EducationPortal, runtime.js, server.js and
ui/server/index.js supplies the module route, port, CSP and iframe permissions.
See README.md for education module deployment. Cache and test evidence are
local ignored artifacts.
