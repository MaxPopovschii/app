# LaunchCheck

Invite-only website QA for web agencies. Audit public pages on desktop and mobile, inspect screenshot evidence, compare a previous audit, triage findings, and share a read-only report or print it as PDF. The interface is Italian.

Accounts belong to one agency. Owners and members can create and manage its reports; viewers can read them. There is no public signup, billing, email delivery, scheduled scanning or MFA in this release. Provision paying pilot customers manually.

## Start locally

Requirements: Node 22, Docker Engine **28+** and Compose **2.24.4+**, at least 2 GB for the worker plus database/API capacity, and more than 1 GB free artifact disk. Isolated Docker bridges are required; do not remove their gateway settings to support an older engine.

```sh
cp .env.example .env
node ops/generate-secrets.mjs
docker compose up --build -d --wait
# Provision the first owner; password is read from stdin, never an argument.
read -rs PASSWORD
printf '%s' "$PASSWORD" | docker compose exec -T api node api/dist/provision.js --agency 'Studio Forma' --email owner@example.com --name 'Owner' --password-stdin
unset PASSWORD
```

Open http://localhost:8080. Use that exact origin: login and mutations validate Origin. Passwords require 15–128 characters. `/healthz` is liveness; `/readyz` checks MongoDB, RabbitMQ, worker heartbeat/disk and fetcher availability. New reports are rejected while dependencies are unhealthy. Existing reports remain readable when possible.

Secret files are generated once in `.secrets/`, mode 600, excluded from Git and image build context. A one-shot initializer copies only each service's required secrets into its private volume. Preserve these files in a secret manager separately from data backups. Never use production secrets in CI. Environment secret fallbacks are refused in production.

## Production

Set `DOMAIN` and `ACME_EMAIL` in `.env`, point DNS at the host, allow inbound 80/443, then:

```sh
docker compose -f docker-compose.yml -f compose.production.yml -f compose.monitoring.yml up --build -d --wait
```

Caddy obtains TLS certificates, removes the API host port, and proxies one trusted hop. Cookies become Secure and use the `__Host-` prefix. Public HTTP origins are refused in production. Keep Docker and the host patched, restrict SSH, and use a dedicated VM. Configure an operator-owned Alertmanager receiver in `ops/alertmanager.yml`; its default receiver sends **no external notifications**. Prometheus/Alertmanager bind only to loopback. Reach them over SSH forwarding. Internal `/metrics` requires its bearer secret and is hidden by Caddy.

Before accepting customers: follow [the operations runbook](ops/RUNBOOK.md), test TLS and account access on the actual domain, configure/verify alert delivery, schedule encrypted off-host backups and perform a restore drill. Repository CI cannot verify your DNS, certificate issuance, off-host retention or notification destination.

## Isolation and limits

- Random 256-bit opaque session cookies are HTTP-only, SameSite Strict; only hashes are stored. Sessions expire after 8 hours or 30 minutes idle. Unsafe requests require exact Origin and a session-bound CSRF token. Password changes revoke all account sessions. Persistent login limits survive API restarts; passwords use bounded-concurrency scrypt (N=131072,r=8,p=1).
- All private report/baseline/asset operations scope by the authenticated agency; client-supplied agency names cannot switch ownership. Legacy shared keys are no longer accepted. Public links are hashed, expiring, revocable and read-only.
- MongoDB replica-set transactions reserve a report, global capacity, agency concurrency and UTC daily usage together. Defaults: 12 active globally; 3 active and 20 submissions/day per agency. Completion releases capacity exactly once. Configure agency policy in the database through trusted operations; global capacity uses `GLOBAL_CONCURRENCY_LIMIT`.
- Reports default to 30-day retention, links 7 days. Expired reports immediately stop being served. A worker janitor removes database records and artifacts at the next 60-second cycle. Deletion hides a finished report immediately and retries failed file cleanup before dropping its tombstone. Backups have an independent deletion schedule.
- API/worker/fetcher run as non-root with read-only roots, dropped capabilities, no new privileges and resource limits. MongoDB uses authenticated replica-set membership and a separate application user; databases/broker publish no host ports.
- Worker networks have **no direct external route or host bridge gateway**. Browser requests are routed through an authenticated separate fetcher. Only the fetcher has Internet egress. It permits GET/HEAD, validates URL/DNS/redirect targets and pins the chosen public IP; TLS verification stays enabled. The browser also disables service workers, WebSockets/WebRTC and uses a dead proxy for unintercepted traffic.
- Confirmed RabbitMQ delivery, a durable database outbox recovery loop, fenced worker leases and delayed duplicate retries recover from crashes. Request logs record route patterns, request IDs, status and duration, never share/session tokens or target URLs. Security events expire after 90 days.

## Operator-managed accounts

```sh
# Add a member or viewer to an existing agency (ID printed by initial provisioning).
printf '%s' "$PASSWORD" | docker compose exec -T api node api/dist/provision.js --agency-id AGENCY_UUID --agency 'Studio Forma' --email teammate@example.com --name 'Teammate' --role viewer --password-stdin
# Disable an account / reset a forgotten password. Password reset revokes all sessions.
docker compose exec -T api node api/dist/accounts.js disable teammate@example.com
printf '%s' "$PASSWORD" | docker compose exec -T api node api/dist/accounts.js reset-password teammate@example.com --password-stdin
```

Deliver initial credentials through your existing secure channel. A disabled agency loses authenticated access and public sharing. Owner/member permissions are intentionally identical for report operations; account management is operator-only. No self-service organization administration is implied.

## Product boundaries

Up to 10 discovered same-origin URLs, desktop 1440×900 and mobile 390×844, with HTTP errors, up to 40 internal links, missing images, JavaScript exceptions, overflow and visual changes. Screenshots show the initial viewport. CSS animations are disabled; dynamic content can still cause visual differences. Failed/unvisited pages never count as baseline issues resolved. Resource/time budgets produce a partial report rather than implying full coverage.

Public pages only; no authenticated journeys, form submission, checkout or contact-delivery checks. Review findings manually with the customer. This is not a security/accessibility certification or a guarantee of conversion improvements. Screenshots can include publicly visible personal information: agree retention with customers and control who receives share links.

## Development and validation

```sh
npm ci
npm run build
npx playwright install --with-deps chromium
npm test
# Real authenticated replica-set, queue and fetcher integration:
docker compose -f docker-compose.yml -f compose.test.yml run --build --rm test
```

Browser tests require an environment able to launch Chromium. CI runs real Playwright UI/evidence/PDF tests, authenticated Docker startup, quota races, idempotent release, retention retries, queue delivery, direct-egress rejection, encrypted backup/restore, Caddy/rule validation and dependency auditing. Service integration is explicitly skipped outside `INTEGRATION_TESTS=1`. Fixtures do not scan third-party websites.

Structure: `shared/` persistence/auth/network primitives; `api/` sessions and agency-scoped HTTP API; `worker/` browser audits; `fetcher/` controlled egress; `web/` Vue UI; `ops/` deployment/recovery/monitoring; `tests/` regression tests.
