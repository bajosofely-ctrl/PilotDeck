# Windows Local Test Installer

Superseded on 2026-10-31 by the [Windows Cloud Client](windows-managed-client.md).
The generated local-test installer and its update metadata were deleted at the
operator's request. Existing local-test installations and user data were kept.
The instructions below remain available for deliberately rebuilding a local test.

This build is for testing on the operator's Windows x64 computer. Its account
service is fixed to `http://127.0.0.1:3100`. It is not a public customer release.

## Build

From the repository root, with the workspace dependencies installed:

```powershell
pnpm --dir apps/desktop run dist:win:local-test
```

The build compiles the core, web UI and Electron main process, stages production
dependencies, and creates a per-user NSIS installer. It bundles Node 22 and
Portable Git. Browser automation downloads its browser on first use.

Output:

```text
apps/desktop/dist-electron/local-test/PilotDeck Local Test-0.1.0-win-x64-setup.exe
```

The application is named `PilotDeck Local Test`, uses a separate installation ID
(`cn.pilotdeck.desktop.localtest`), and has its own Electron user-data directory.
It does not include the platform server, operator credentials, account database
or existing customer sessions.

## Run

Start the existing local platform before signing in:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ui/platform/start-local.ps1
```

Confirm the reported address is `http://127.0.0.1:3100`. Then open the installed
`PilotDeck Local Test` application and use a customer account. Operator/admin
accounts cannot sign in to the customer application.

Registration uses the platform's existing email verification configuration.
Packaging does not configure an email sender. If email delivery is not set up,
the operator can create a customer account in the admin UI.

This test build has no code-signing certificate. Windows may display an unknown
publisher prompt. A local installer does not replace the account/model backend:
new logins and model calls require that service.

## Packaged Acceptance Test

`ui/platform/customer-desktop.test.js` supports
`CUSTOMER_DESKTOP_EXECUTABLE` pointing to the installed executable. With
`CUSTOMER_DESKTOP_TEST=1`, it starts an isolated fixture platform on port 3100,
uses a temporary account database and simulated model responses, and exercises
registration, login, redemption, chat, learning and account isolation.

Stop the real local platform before running this test and restart it afterwards.
The test fails if port 3100 is already occupied. It does not consume real credits
or call an upstream model. Screenshots go to `.pilotdeck/packaging-verification/`.

## Production

Production managed builds still require an HTTPS origin through
`PILOTDECK_DISTRIBUTION=managed` and `PILOTDECK_MANAGED_URL`. Only the explicit
`managed-local-test` distribution accepts HTTP loopback addresses; it rejects
remote service addresses. Build the production artifact separately after the
public platform is deployed.

## Verification (2026-10-31)

- Installer built and installed successfully for the current Windows user.
- Installer size: 343,908,620 bytes (328 MiB).
- SHA-256: `125b0c176b0aa2df1313ed21a36a4b5f212e73c64c3c089a62cef88569fba492`.
- Installed executable, application archive, runtime/UI entries and service
  configuration match the unpacked build.
- Packaged content check found no live platform configuration, database,
  administrator credentials or customer device/session state.
- 45 managed desktop unit tests passed.
- Full acceptance test passed against the installed executable using an
  isolated backend, simulated email delivery and simulated model responses.
  Real email delivery and paid upstream inference were not tested.
- The existing local platform was restarted on port 3100 after the test.

The acceptance test waits for the send button to become enabled before sending;
pressing Enter immediately after entering the chat can precede model/preference
initialization.
