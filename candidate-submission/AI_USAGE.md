# AI usage disclosure

## Usage summary

| Tool and model, if known | Files, features or sections affected | Purpose of use | Nature of the output | How I reviewed or tested it |
|---|---|---|---|---|
| AI assistant using Copilot SDK in VS Code; model not exposed in this session | Backend route/model/migration/tests, worker source/tests/configuration, frontend dashboard/services/tests, Compose and example configuration, README and candidate submission notes | Continue and verify the existing FieldDesk assessment; implement authenticated real-time updates, persist notification outcomes, add frontend workflow tests, and document actual behavior and remaining gaps | Generated and modified implementation code, tests, migration/configuration changes, and documentation. Existing uncommitted work was inspected and preserved rather than recreated. | Backend type-check and production build, PostgreSQL-backed backend/worker tests, frontend component tests, frontend lint/build, Docker Compose configuration validation, and worker image build. Exact results are recorded in `TECHNICAL_NOTES.md`; the worker container was not started for a runtime check in this continuation. |

## Details

1. The assistant was asked to continue the existing repository, implement authenticated tenant-isolated real-time updates, persist notification outcomes, add frontend workflow tests, complete the submission documents truthfully, and run relevant tests/builds without committing or pushing.
2. This assistance in the current continuation materially affected:
   - Backend SSE route, PostgreSQL notification publication, work-order/progress/attachment event wiring, and graceful stream shutdown.
   - Notification delivery migrations, worker PostgreSQL persistence, retry/failure processing and tests.
   - Frontend reconnection handling, technician role-based controls and component tests.
   - Compose configuration and the technical notes/AI disclosure.
3. Changes were made in response to repository inspection and test/build failures. In particular, the notification processor SQL and realtime stream test were corrected after their first verification attempts failed.
4. Verification was run against the dedicated `fielddesk_test` database after checking its database name. Backend and worker integration tests use PostgreSQL; frontend tests use Vitest and Testing Library. Builds, lint and Docker checks were run and their results recorded in `TECHNICAL_NOTES.md`.
5. The first worker SQL implementation had a PostgreSQL parameter-type inference error, and the first SSE test waited incorrectly for its initial connection frame. Both were fixed and the tests rerun. No tests were intentionally skipped, removed or weakened to obtain a passing result.

This disclosure describes AI assistance in the work performed in this VS Code session. The candidate must add any other AI tools or model details used in earlier development if applicable; the assistant cannot verify tools used outside the visible session.

## Candidate confirmation

These are personal attestations and are intentionally left unchecked for the candidate to complete after reviewing the submission:

- [ ] I have disclosed all AI-assisted work in this submission.
- [ ] I personally reviewed every submitted file.
- [ ] I can explain and modify every part of the implementation.
- [ ] I independently ran the documented tests and checks.
- [ ] I did not submit confidential or proprietary third-party material.

Candidate name:

Date:
