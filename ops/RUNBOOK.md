# LaunchCheck operations

## Release and rollback

Deploy an immutable reviewed commit, retain the previous image digests, and back up before changing schema or configuration. Run the full CI suite first. On the real host check `/readyz` internally, login via HTTPS, create one authorized canary audit, open/revoke its shared report and delete it. Verify desktop/mobile and PDF output.

This release changes authentication and introduces authenticated replica-set storage. It uses new `*-v2` data volumes and does not silently adopt old volumes or unscoped reports. Preserve old volumes for rollback. To retain legacy reports, perform a separately reviewed offline migration that assigns every report to a verified agency, sets retention deadlines, revokes old public links and marks abandoned jobs terminal. Do not attach an old unscoped database to a public deployment. Existing tenantless records are hidden. No automated legacy migration is supplied.

Rollback before accepting new data: stop api/worker, select previous code/images and its original compose/volumes, restore the matching backup if needed. After accepting new data, do not run the pre-account release on the new database: it lacks agency authorization. Keep access in maintenance while restoring a compatible release and reconcile new work first.

## Health and incidents

- Liveness healthy but readiness failing: inspect the four readiness checks, service state and structured logs. Mongo requires a primary; Rabbit must be reachable; worker heartbeat must be <45 seconds old, artifact directory writable and >=1 GB free; fetcher must respond internally.
- No worker: queued reports remain durable. Restart it; expired leases are republished. Do not manually reset active counters while jobs run.
- Stalled queue: inspect worker/browser resource usage and network availability. Queue recovery republishes old pending jobs every 30 seconds; duplicate deliveries are fenced and delayed rather than starting parallel scans.
- Disk pressure: stop accepting scans, expand disk or allow retention cleanup. Do not delete live artifact directories manually. Check janitor error logs and retry on a repaired disk.
- Database/broker loss: stop writers, restore the matching data/artifact backup, verify counters and queued jobs before reopening. Rabbit can be empty after recovery: the database outbox recreates pending jobs.
- Suspicious account: disable it using the account CLI; reset password to revoke every session. If a session hash leak includes no raw cookie, it cannot directly authenticate, but investigate the database access. Rotate compromised service secrets and recreate affected services. Mongo/Rabbit existing passwords require updating the live service users first; simply regenerating files does not change persisted credentials.
- Share leak: revoke/rotate its link. Disable the agency to hide all its public links if needed. Already downloaded copies cannot be revoked.

Prometheus records readiness, worker availability, pending/stale queue and failures over 15 minutes. Rules detect unavailable services, absent workers, stalled queues and repeated failures. Add host disk/memory monitoring and remote uptime checks in your infrastructure. Configure an Alertmanager receiver and force a controlled worker outage to verify actual delivery before launch. Default configuration is local-only.

## Backups and restore

Host requirements: Python 3.11+, Docker Compose, and `age`/`age-keygen`. Use an encryption recipient whose private key is held **off the application host**. Keep a separate encrypted copy of `.secrets/` in your secret manager; data archives do not contain it. Production Compose users must export `COMPOSE_FILE=docker-compose.yml:compose.production.yml:compose.monitoring.yml` for these commands so every operation uses the same project/configuration.

```sh
python3 ops/recovery.py backup --recipient age1YOUR_PUBLIC_RECIPIENT --output backups/2026-10-27.tar.age
python3 ops/recovery.py restore --identity /secure/offline-key --input backups/2026-10-27.tar.age
# Apply only to a stopped, isolated restore target after verifying the archive.
docker compose stop api worker
python3 ops/recovery.py restore --identity /secure/offline-key --input backups/2026-10-27.tar.age --apply --maintenance-confirmed
```

Backup pauses the running API/worker to make the database and screenshots consistent, then restarts only the writers that were running. This is a maintenance-window backup, not zero downtime. It dumps only `launchcheck`, archives artifacts, checksums both, encrypts the bundle and removes temporary plaintext. Use encrypted host disks because temporary plaintext exists during processing. The archive restores account/session records: after a security incident invalidate sessions before reopening.

Restore defaults to verification only. Applying drops/replaces collections present in the `launchcheck` archive and extracts artifacts; it does not erase unrelated databases, absent collections or leftover artifact files. Use a **fresh isolated Compose project** for a complete replacement/drill. Restore never starts writers. Reconcile deletion/retention requests recorded after the backup before opening access, revoke affected shares and remove obsolete artifacts. Never restore old personal data into public access without this reconciliation.

Schedule backups with your infrastructure scheduler, copy ciphertext off-host, alert on failures, and set retention explicitly (suggested pilot policy: daily, seven copies; confirm customer agreements). Test recovery monthly and after storage/schema changes. CI exercises decryption, checksums and an apply cycle, but cannot prove your off-host storage, key custody, recovery time or customer-specific retention policy.
