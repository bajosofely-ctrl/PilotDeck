# Windows Cloud Client

This Windows x64 client uses the account and model service at
`https://124.222.153.173:8443`. The service origin is embedded in the package.
Customers do not need to start a backend on their own computers.

## Build

Run from `apps/desktop` with the existing workspace dependencies installed.
Use Node 22 and the repository's pinned pnpm 10.32.1, not a different global pnpm.
The following uses the existing local Node distribution and Corepack cache:

```powershell
$env:PILOTDECK_DISTRIBUTION = 'managed'
$env:PILOTDECK_MANAGED_URL = 'https://124.222.153.173:8443'
$env:PILOTDECK_DESKTOP_NODE_ARCH = 'x64'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/'
$env:ELECTRON_BUILDER_NSIS_DIR = (Resolve-Path ../../.cache/installer-tools/nsis).Path
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR = (Resolve-Path ../../.cache/installer-tools/nsis-resources).Path
$env:PILOTDECK_DESKTOP_NODE_ARCHIVE = (Resolve-Path ../../.cache/runtime/node-v22.23.1-win-x64.zip).Path
$env:npm_execpath = Join-Path $env:LOCALAPPDATA 'node/corepack/v1/pnpm/10.32.1/bin/pnpm.cjs'
$clientBuildNodeDir = (Resolve-Path ../../.cache/runtime/node-v22.23.1-win-x64).Path
$env:Path = "$clientBuildNodeDir;" + $env:Path
node scripts/build-runtime.mjs
if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed' }
node node_modules/typescript/bin/tsc -p tsconfig.json
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
node node_modules/electron-builder/cli.js --win nsis --x64 --publish never `
  --config.appId=cn.pilotdeck.desktop.managed `
  --config.extraMetadata.name=pilotdeck-managed `
  --config.directories.output=dist-electron/managed `
  --config.electronDist=node_modules/electron/dist `
  --config.nsis.perMachine=false --config.nsis.allowElevation=false
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
```

The local NSIS tool directories were populated from mirror archives checked
against the hashes pinned in electron-builder:

- `nsis-3.0.4.1.7z`:
  `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`
- `nsis-resources-3.4.1.7z`:
  `593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`

This avoids a stalled GitHub tool download and reuses project-local tools.
If those directories are absent on another build machine, provision the same
verified tools or omit the two directory overrides to let the builder download.

Output:

```text
apps/desktop/dist-electron/managed/PilotDeck-0.1.0-win-x64-setup.exe
```

This is a per-user installer named `PilotDeck`, with application ID
`cn.pilotdeck.desktop.managed`. It is separate from `PilotDeck Local Test`.
Removing an old installer file does not uninstall an existing application or
delete its account data.

## Customer Accounts

Sign in with an active customer account. Administrator accounts are for the
management backend and cannot sign in to the customer application.

The server now provides a QQ/Foxmail SMTP settings page at
`https://124.222.153.173:8443/#mail`. Enter the sender email and SMTP authorization
code there, enable and save, then send a test email to verify receipt. This
server configuration does not require rebuilding or reinstalling this client.
Until configured and verified, administrators can create customer accounts in
the management backend; registration and password-reset email delivery are
not ready for customers.

The package contains the service URL and application code, not the backend's
encryption key, administrator password, account database or local user sessions.
It bundles Node and Git; browser automation installs its browser on first use.
The installer currently has no code-signing certificate.

## Verification (2026-10-31)

- Installer size: 343,908,643 bytes (328 MiB).
- SHA-256:
  `a0a58d2e0ec169661ff6f050225d5a83bdf1ec5aa3fd302108659312d74501e8`.
- All 45 managed desktop unit tests passed.
- Core, UI, staged runtime checks and Electron compilation succeeded.
- Packaged application opened its login screen and reached the live cloud health
  endpoint over HTTPS with certificate validation enabled.
- Bundled service origin took precedence over a local-test environment override.
- Invalid credentials were rejected through the actual cloud login endpoint;
  no customer runtime opened and no paid inference was requested.
- 1,355 application text files were checked for the operator's encryption key
  and bootstrap password. None was found. Platform server/database and known
  local account/session files were absent from the application payload.
- Installer archive integrity passed. Extracted `PilotDeck.exe`, `app.asar`
  and `managed-service.json` hashes matched the checked unpacked application.
  The archive scanner's trailing-data notice is expected for an embedded NSIS
  payload; it reported no corrupted data.
- The old local-test installer, its blockmap and its `latest.yml` were deleted.
- The new installer was generated and its unpacked application tested; the
  installer was not run to replace the operator's existing installed application.
- Successful customer login and paid model inference against the live backend,
  and real verification email delivery, were not exercised by this build check.
