# Technical notes

## Candidate

- Name: noble p sabu
- GitHub username: `nobz2op`
- Final commit SHA: Not available; this work remains uncommitted.
- Screen-recording link: [Download the Website Demonstration Video (ZIP)](https://drive.google.com/file/d/19Pz2wL1LfprQVJPSc_H_f5ULB_RxGhAV/view?usp=drivesdk). The video is provided in a ZIP archive because the original file was too large to share directly; download and extract the archive to view it.

## Local setup

The examples below assume Windows PowerShell and the local Compose ports in `docker-compose.yml`.

1. Copy `.env.example` to `.env`; replace the database password placeholder with a local assessment-only password.
2. Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL` to the Compose PostgreSQL database, set `TEST_DATABASE_URL` to a separate database named `fielddesk_test`, and set `JWT_SECRET` to a randomly generated value of at least 64 characters. Keep these local files private.
3. Create the dedicated test database once, if it does not exist:

   ```powershell
   docker compose exec postgres createdb -U fielddesk_app fielddesk_test
   ```

   If it already exists, do not recreate it.
4. Start infrastructure and the independently running worker:

   ```powershell
   docker compose up -d postgres redis worker
   ```

5. Install backend dependencies, apply migrations, seed the two demo organisations, and start the API:

   ```powershell
   Set-Location backend
   npm install
   npm run migrate:up
   npm run seed
   npm run dev
   ```

6. In another terminal, start the frontend:

   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```

   The API defaults to `http://localhost:5000`, and Vite defaults to `http://localhost:5173`.

The Compose worker connects to the Compose PostgreSQL and Redis services. Its mock provider mode is set using root `.env` variable `MOCK_NOTIFICATION_MODE`: `success`, `temporary_failure`, `permanent_failure`, or `temporary_once`. Local attachment quota is configurable with `ATTACHMENT_ORG_QUOTA_BYTES` in `backend/.env`; default is 100 MiB.

## Sample accounts

The idempotent seed creates three roles in each organisation. The seed's assessment-only password is `FieldDeskDemo!2026`.

| Organisation | Organisation ID | Role | Email |
|---|---|---|---|
| Northstar Maintenance | `11111111-1111-4111-8111-111111111111` | OWNER | `northstar.owner@example.com` |
| Northstar Maintenance | `11111111-1111-4111-8111-111111111111` | DISPATCHER | `northstar.dispatcher@example.com` |
| Northstar Maintenance | `11111111-1111-4111-8111-111111111111` | TECHNICIAN | `northstar.technician@example.com` |
| BlueSky Services | `22222222-2222-4222-8222-222222222222` | OWNER | `bluesky.owner@example.com` |
| BlueSky Services | `22222222-2222-4222-8222-222222222222` | DISPATCHER | `bluesky.dispatcher@example.com` |
| BlueSky Services | `22222222-2222-4222-8222-222222222222` | TECHNICIAN | `bluesky.technician@example.com` |

These are demo credentials only; change them before any non-local use.

## Verification results

| Check | Command | Result |
|---|---|---|
| Backend tests | `Set-Location backend; npm.cmd test -- --reporter=dot` | Passed: 6 files, 40 tests, no skips. The package test script runs serially to avoid contention between test files sharing PostgreSQL. `TEST_DATABASE_URL` was checked against the database name `fielddesk_test` before running. |
| Frontend tests | `Set-Location frontend; npm.cmd test -- --reporter=dot` | Passed: 1 file, 8 tests. |
| Worker integration tests | `Set-Location worker; npm.cmd test -- --reporter=dot` | Passed: 1 file, 3 tests covering success, permanent failure, and retry followed by success, using PostgreSQL. |
| Lint | `Set-Location frontend; npm.cmd run lint` | Passed. |
| Backend type-check | `Set-Location backend; node node_modules/typescript/bin/tsc --noEmit` | Passed. |
| Backend build | `Set-Location backend; npm.cmd run build` | Passed. |
| Frontend build | `Set-Location frontend; npm.cmd run build` | Passed. |
| Worker build | `Set-Location worker; npm.cmd run build` | Passed. |
| Compose config | `$env:POSTGRES_PASSWORD = 'validation-only-placeholder'; docker compose config --services` | Passed; PostgreSQL, Redis and worker services resolved. The placeholder was set only for Compose validation and is not a credential. |
| Worker image | `docker compose build worker` | Passed after the latest worker changes. |
| Migration state | Verify `TEST_DATABASE_URL` database name equals `fielddesk_test`, then run `npm.cmd run migrate:up` from `backend` | Passed; no pending migrations on the dedicated test database. |
| Diff whitespace | `git diff --check` | Passed; Git reported only an existing LF/CRLF working-copy warning. |

## Architecture

- `backend/` contains the Express API, JWT authentication, Zod request validation, PostgreSQL models, migrations, reporting, attachments and the authenticated SSE endpoint.
- `frontend/` is a React/Vite JavaScript application. It has login, dashboard/work-order listing and filters, work-order creation/detail/edit, technician assignment and scheduling, owner-only removal, and technician progress updates/history. It reconnects to the authenticated event stream and reloads persisted list data after relevant events.
- `worker/` is an independent BullMQ worker. It simulates notification delivery, retries temporary failures, and records delivery outcomes in PostgreSQL.
- `docker-compose.yml` starts PostgreSQL, Redis and the worker. Run the API and frontend separately using their package scripts.

## Database design

Migrations create organisations, users, work orders, activity history, progress events, attachments and notification delivery records. Composite foreign keys on organisation plus record ID constrain tenant relationships for assigned technicians, creators, activities, progress events, attachments and notification outcomes. List, assignment, activity and delivery lookups have indexes.

Migration `1792800000000_prevent_technician_schedule_overlap.js` enables `btree_gist` and adds a PostgreSQL exclusion constraint over technician IDs and half-open scheduled time ranges. The database constraint, rather than an API process lock, protects concurrent assignments across API instances. Subsequent migrations add progress events, attachment storage, valid activity action values, notification delivery history, system audit labels, and audit-preserving work-order soft deletion.

## Authentication, roles and organisation isolation

Login checks organisation ID, normalized email, active state and a bcrypt password hash, then returns a signed one-hour JWT with issuer, audience, subject, organisation and role claims. Protected API routes derive organisation and user identity from that verified token. Owner/dispatcher and technician permissions are enforced on the server; technician work-order queries additionally scope to assigned user ID. The frontend stores the token in session storage and sends it as an Authorization bearer header. It is a usability boundary only; API checks are authoritative.

The SSE endpoint uses the same bearer-token middleware. The frontend uses `fetch` streaming so the token remains in an Authorization header rather than a query string.

## Transactions, idempotency and concurrency

Work-order creation and activity writes, assignment and activity writes, progress-event insertion/update/activity writes, attachment metadata/quota/activity writes, and work-order soft deletion/audit writes use PostgreSQL transactions. Progress event IDs are unique per work order; the row is locked before validating assignment, applying the event and writing the audit activity, so simultaneous retries cannot apply a duplicate update. Scheduling conflicts are enforced by the exclusion constraint and surfaced as HTTP 409. Work-order deletion sets `deleted_at`, writes a `DELETED` activity identifying the owner, retains related audit/attachment/event rows, and hides the order from normal lists, detail reads and CSV reports.

## Background jobs

Assignments add a BullMQ job with a stable work-order/technician job ID and exponential retry configuration. The worker supports success, temporary failure, permanent failure, and a temporary-once-then-success mock mode. Each attempt appends outcome/timestamp history to `notification_deliveries`; the row includes organisation, work order, technician, attempt count, latest status/error, completion time, and `SYSTEM`/`NOTIFICATION_OUTCOME` audit labels. A permanent provider failure uses BullMQ's unrecoverable error; temporary failures use normal retry behavior. Queue retention is bounded.

Delivery is at-least-once at the queue boundary. A production provider should accept an idempotency key; this mock provider cannot promise exactly-once external delivery after process/network failure.

## Real-time updates

The API exposes authenticated Server-Sent Events at `/api/realtime/events`. Mutations publish small PostgreSQL `NOTIFY` messages containing organisation, work-order ID, event type and timestamp. Each API process listens through a database connection and only emits events matching the authenticated organisation. The frontend retries with backoff and reloads authoritative list data after relevant events. PostgreSQL notifications are transient, not a durable event log; after a disconnect, reconnecting clients recover current state by re-fetching the API. During a database notification outage, the API logs the publication failure and the dashboard retries/reloads rather than treating the committed mutation as failed.

## File security and storage limits

Uploads are authenticated and authorised against the tenant-scoped work order (technicians must be assigned). Backend size and MIME allowlists are enforced, and supported file signatures are checked. Random UUID storage identifiers are used instead of client filenames; filenames are sanitized for download metadata. Per-organisation quota checks serialize on the organisation row. Storage is local under `uploads/`; production should use private object storage with tenant-scoped keys, lifecycle/retention controls and short-lived authorised download links.

## Security considerations

Request validation uses Zod; SQL values are parameterized and dynamic SQL columns use allowlists. Authentication, role, organisation and technician assignment are verified server-side. CSV fields are quoted and formula-like prefixes escaped. Upload metadata is not trusted for file contents or storage path. API request logging redacts Authorization, cookie and API-key headers. Local `.env` files are ignored and examples contain placeholders.

## Production deployment and operations

For production, run API and worker as separate horizontally scalable services, use managed PostgreSQL/Redis and private object storage, rotate secrets, enforce TLS and least-privilege database credentials, and configure connection limits. Add metrics/alerts for API health, queue depth/failures, delivery states, database capacity and realtime disconnects. Back up PostgreSQL with tested point-in-time recovery and separately define object-store retention/backup. The current Compose file is a local assessment topology, not a production deployment.

## Assumptions and trade-offs

- PostgreSQL notifications provide cross-instance transient event fan-out without introducing another broker; the durable state remains in PostgreSQL.
- Notification delivery history is a separate immutable-through-normal-API audit table, while a single row tracks attempts for a stable BullMQ job ID.
- Local filesystem storage is suitable only for a single local instance; it is not shared storage for horizontally scaled API instances.
- The frontend remains JavaScript/JSX despite the assessment's TypeScript preference.

## Known limitations or incomplete requirements

- Candidate name, final commit SHA and screen recording must be supplied by the candidate; no commit or recording is created by this work.
- The frontend now provides work-order detail/edit views, technician assignment and scheduling, owner-only audited removal, and technician progress updates with activity history. Attachment upload UI and user/organisation administration remain incomplete.
- No automated browser-level end-to-end test is included; component tests cover login, listing, loading/error states and technician controls.
- Docker Compose runs PostgreSQL, Redis and worker, but API and frontend are started separately.
- Worker tests cover persisted success/failure outcomes and retries, but do not exercise duplicate delivery across a worker crash or prove exactly-once delivery to an external provider. The worker container image was built but not started for a runtime check in this continuation.
- Progress/activity and notification delivery records are written, but there is no general audit-management API or user-role change workflow.
- Activity coverage does not implement every requested audit action, notably user-role changes and a complete before/after audit trail for all work-order edits.
- SSE notifications are transient; there is no replay cursor or durable event outbox. The client restores the latest list from the API after reconnecting.
