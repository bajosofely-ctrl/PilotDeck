# PilotDeck Backend Deployment

Deployment date: 2026-10-31 (Asia/Shanghai).

## Status

The backend and admin UI are running on `124.222.153.173`, in the independent
Docker Compose project `pilotdeck-platform`.

Intended public URL: `https://124.222.153.173:8443/`.

**Public HTTPS ingress was verified on 2026-10-31 after the operator opened the
cloud firewall.** The admin page returned HTTP 200 and `/health` returned
`{"status":"ok","service":"pilotdeck-platform"}`. The packaged cloud client also
reached this health endpoint with normal certificate validation.

The initial external connection attempts timed out while the internal endpoint
was healthy. No traffic for 8443 reached eth0 during those attempts. Public
access started working after the operator's firewall change. Keep the inbound
TCP 8443 allow rule and preserve all unrelated service rules.

## Isolation

- Existing listeners on 80, 443, 8080, 8081 and other ports are preserved.
- Host Nginx configuration and certificate renewal configuration are unchanged.
- Only the new application publishes TCP 8443. Backend port 3100 is accessible
  only over loopback in the two new containers' shared network namespace.
- App limit: 0.75 CPU, 512 MiB RAM, 128 processes.
- Proxy limit: 0.25 CPU, 64 MiB RAM, 32 processes.
- Both have bounded container logs and restart-unless-stopped policies.
- Latest observed combined memory use was approximately 30 MiB.
- Separate paths, image, containers, network, database and secret file are used.
  Resource limits reduce interference; this remains a shared physical server.

## Server Paths

```text
/opt/pilotdeck-platform/releases/20261031-3/
/opt/pilotdeck-platform/releases/20261031-3/deploy/isolated/
/opt/pilotdeck-platform/secrets/platform.env
/opt/pilotdeck-platform/data/platform.sqlite
/opt/pilotdeck-platform/backups/platform-20261031-post-deploy.sqlite
/opt/pilotdeck-platform/backups/platform-20261031-before-mail.sqlite
/opt/pilotdeck-platform/backups/platform-20261031-before-single-session.sqlite
```

The secret directory is root-only, the environment file is mode 600, and the
database and backup are mode 600. Preserve the encryption key with secure
backups: the database contains encrypted channel credentials and saved SMTP
settings.

Active image: `pilotdeck-platform:20261031-3`. Previous releases and images
`pilotdeck-platform:20261031-1` and `pilotdeck-platform:20261031-2` are retained.
The mail and administrator-session updates reused the live database and
existing encryption key; they did not import the local database again.

The initial local database was migrated using the SQLite online backup API.
Existing account password hashes, channel credentials, pricing and ledger data
were retained. No plaintext administrator password was copied to the server.
Use the existing administrator account. Local and cloud databases are now
independent; subsequent local changes are not synchronized.

## Operations

SSH as `ubuntu` with the existing configured key. These commands target only
PilotDeck. Run Compose commands from the exact directory below.

```sh
cd /opt/pilotdeck-platform/releases/20261031-3/deploy/isolated
sudo docker compose --env-file deployment.env ps
sudo docker compose --env-file deployment.env logs --tail=100
```

To stop or start only this deployment:

```sh
sudo docker compose --env-file deployment.env stop
sudo docker compose --env-file deployment.env start
```

To verify trusted TLS locally on the server:

```sh
curl --fail --resolve 124.222.153.173:8443:127.0.0.1 \
  https://124.222.153.173:8443/health
```

To create another consistent backup, choose a new destination filename:

```sh
sudo docker exec pilotdeck-platform-platform-1 node backup.mjs \
  /data/platform.sqlite /backups/platform-YYYYMMDD-HHMMSS.sqlite
sudo chmod 600 /opt/pilotdeck-platform/backups/platform-YYYYMMDD-HHMMSS.sqlite
```

The backup command refuses to overwrite an existing file and verifies database
integrity and foreign keys. An initial verified backup exists. Automatic backup
scheduling and off-server backup storage have not been configured.

Avoid broad container shutdown, image pruning, host firewall resets or changes
to shared Nginx when operating this deployment.

## TLS

The dedicated proxy mounts the existing Let's Encrypt IP certificate read-only
from `/etc/letsencrypt/live/qyxc-ip` and its matching archive directory.
Its certificate includes IP address `124.222.153.173`.

At deployment it was valid from 2026-10-28 through 2026-11-03 UTC. The existing
`qyxc-cert-renew.timer` was active and its last renewal service result successful.
The new proxy watches certificate content every 300 seconds and reloads itself
when it changes. No renewal jobs were modified. This deployment depends on that
certificate path and existing renewal process remaining available.

## Verification

The administrator-session release passed 94 backend tests and 30 admin browser
tests. Public HTTPS verification confirmed that a second administrator login
immediately invalidates the first token and leaves exactly one device session.
The verification session was logged out afterward. Customer sessions remained
at two, database integrity returned `ok`, and both deployed containers are healthy.

Administrators now have one effective session regardless of customer defaults.
Startup retains only the newest unexpired legacy administrator session. New
successful logins atomically replace it; failed authentication does not revoke it.
The updated admin page checks every 15 seconds and on focus/visibility return.
Old credentials are rejected immediately by the server; sleeping, offline or
throttled browsers may display the page until their next check. Pages opened
before the update need one refresh to load this behavior.

Earlier mail-deployment verification:

- Backend production image built and its native SQLite dependency loaded.
- Admin production assets built; 90 backend tests and 27 admin browser tests
  passed for the mail settings release. SMTP tests used simulated transports;
  no actual email was sent.
- Both deployed containers report healthy.
- Trusted HTTPS, admin HTML and its two assets passed through a temporary SSH tunnel.
- Unauthenticated admin access returned 401.
- Existing administrator login succeeded; users, channels and models were readable.
- Verification login was logged out; its token subsequently returned 401.
- Temporary verification tunnel was closed.
- The mail release was additionally verified directly over public trusted HTTPS:
  current assets include the mail page; unauthenticated mail access returns 401;
  administrator access returns the unconfigured QQ mail settings without a
  credential. The verification session was logged out and invalidated.
- No active billing calls were present immediately before the update.
- Live and backup databases passed integrity and foreign-key checks.
- Live and backup counts: users 2, channels 1, models 1, apps 10,
  billing_lots 1, billing_ledger 4, billing_codes 1.
- No paid upstream inference was performed.
- Existing HTTP endpoints retained their baseline responses:
  loopback 80 = 200, public 443 = 200, 8080 = 200, 8081 = 302.
  Public IP HTTP on 80 redirects to HTTPS (301).
- `qyxc-film` remained started at `2026-10-27T09:06:15.947282269Z`,
  restart count 0.
- `zhuoyue-workspace-1` remained started at `2026-10-22T11:55:02.081493171Z`,
  restart count 0.

## Remaining Client Setup

The QQ/Foxmail SMTP settings page is deployed at
`https://124.222.153.173:8443/#mail`. The operator must enter the sender email,
sender name and SMTP authorization code, enable delivery and save. Then enter
an explicit test recipient and use the test email button to verify delivery.
The authorization code is encrypted in the database and never returned by the
admin API. Leave the code blank on later edits to preserve it for the same sender.

The server's TLS connection to `smtp.qq.com:465` was verified, but credentials
have not been configured and real email delivery has not been tested. Email
verification and password-reset delivery require this setup before customer
use. Administrators can still create customer accounts through the admin UI.
This server update does not require rebuilding the cloud client.

The Windows cloud client uses `https://124.222.153.173:8443`.
See [Windows Cloud Client](windows-managed-client.md) for its build and account
requirements. Existing installations of `PilotDeck Local Test` remain separate
and still target `127.0.0.1:3100`.
