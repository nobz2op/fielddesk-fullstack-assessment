# FieldDesk Full-Stack Engineering Assessment

This practical assessment is conducted by **Gatlier** to evaluate full-stack engineering ability, with particular emphasis on backend correctness, security, database design, testing and production awareness.

FieldDesk is a fictional field-service application created solely for this assessment. Candidates are expected to build a working application, explain their technical decisions and take ownership of everything they submit.

## Start here

1. Read the complete [assessment brief](docs/ASSESSMENT.md).
2. Review the [evaluation criteria](docs/EVALUATION.md).
3. Follow the [submission instructions](docs/SUBMISSION.md).
4. Complete the [technical notes](candidate-submission/TECHNICAL_NOTES.md) and [AI usage disclosure](candidate-submission/AI_USAGE.md).
5. Raise questions or blockers through a GitHub Issue in this repository.

## Required stack

- React or Next.js with TypeScript
- Node.js with TypeScript
- PostgreSQL
- Redis with a suitable job queue
- Docker Compose

Libraries and architectural patterns are the candidate's choice. Significant decisions and trade-offs should be documented.

## What to submit

- A working frontend, API and background worker
- Database migrations and seed data
- Automated tests
- Docker-based local setup
- Clear technical documentation
- Completed submission templates
- A pull request from the candidate's fork
- A 10–15 minute screen recording
- The final commit SHA

AI-assisted development tools are permitted. Every use must be disclosed clearly, including the tools used, the files or sections affected, the purpose of the assistance and how the output was verified. The candidate remains responsible for the correctness, security and maintainability of all submitted work.

There is no prescribed visual design. A clear, usable interface is sufficient; engineering quality is the main consideration.

## Website Demonstration Video

The complete website demonstration video is available through Google Drive as a ZIP archive. The original video file was too large to share directly, so it has been packaged into a ZIP file for submission.

[**Download the Website Demonstration Video (ZIP)**](https://drive.google.com/file/d/19Pz2wL1LfprQVJPSc_H_f5ULB_RxGhAV/view?usp=drivesdk)

Please download the ZIP archive and extract it to view the website demonstration.

## Communication

Use GitHub Issues for all assessment questions, assumptions and technical blockers. This keeps clarifications visible and ensures every candidate receives consistent information.

Please do not include confidential information, credentials or code from a current or previous employer.

## Runtime configuration notes

- The worker reads `MOCK_NOTIFICATION_MODE`: `success`, `temporary_failure`, `permanent_failure`, or `temporary_once` (the default, which succeeds on its retry). The root `.env.example` contains the Compose worker default.
- The backend reads optional `ATTACHMENT_ORG_QUOTA_BYTES`; when unset, each organisation has a 100 MiB attachment quota. Set this in the backend's local environment file.
- Backend integration tests require `TEST_DATABASE_URL` to point to a dedicated database named `fielddesk_test`. Tests deliberately refuse to fall back to `DATABASE_URL`.
- Compose starts PostgreSQL, Redis, and the worker. Start the backend and frontend using their package scripts.
- Authenticated Server-Sent Events are available at `/api/realtime/events`; the dashboard reconnects with backoff and refreshes persisted list data after events.
- Notification attempt history and final outcomes are stored in PostgreSQL `notification_deliveries`, scoped to organisation, work order and technician.

## Verification commands

Run from PowerShell in the relevant project directory:

```powershell
Set-Location backend
npm test
node node_modules/typescript/bin/tsc --noEmit

Set-Location ..\frontend
npm test
npm run lint
npm run build

Set-Location ..\worker
npm test
npm run build
```

Backend and worker integration tests require the dedicated `fielddesk_test` database configured as `TEST_DATABASE_URL`. The backend tests verify the connected database name before fixtures or cleanup.

---

**Conducted by Gatlier**
