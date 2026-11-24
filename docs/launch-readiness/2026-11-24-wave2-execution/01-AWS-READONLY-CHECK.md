# Addendum: read-only AWS check (24 Nov 2026, 10:49 to 10:51 UTC)

At 10:48 UTC the owner said "Use root" in the thread, so these checks ran on the root connector.
They used only `List*`, `Describe*` and `Get*` calls. Nothing was changed, and no secret value
was read: for secrets, only the version-id metadata was listed. This replaces "NOT VERIFIED" in
section 9 of the main report.

## Caller

`arn:aws:iam::229251310592:root`, account 229251310592, region eu-central-1.

## Work (VERIFIED)

| Item | Live state |
| --- | --- |
| Work task definition families (`munaxa-nonprod-work*`, any status) | **None**. This matches `main`: `images.work_*` is unset and the E-1 work-migrate family is `pending`. |
| Work ECS services and running tasks | **None** |
| ECR `munaxa-work/api`, `admin`, `migrate` | One image each, all from the **withdrawn `b490b25`** build pushed 8 Nov (digests `39a89a6f…`, `c06bb7ef…`, `ca8c02d9…`). Never pin these. No image from a 3.5.10 build exists. |
| Secrets `munaxa-nonprod/work-api`, `munaxa-nonprod/work-migrate` | Both exist, with **0 versions**. W-4 has not run. |

## Shared Testing stack (VERIFIED at 10:49 UTC)

| Item | Live state |
| --- | --- |
| ECS cluster | `munaxa-nonprod` |
| Running tasks | 3 tasks, all started 10:16 UTC as part of the other thread's approved Control session (Y-6): `munaxa-nonprod-identity:4`, `munaxa-nonprod-control-api:2`, `munaxa-nonprod-control-portal:1` |
| Services | `identity`, `control-api`, `control-portal` at 1/1; `docs-api`, `docs-web`, `docs-scanner` at 0/0 |
| RDS `munaxa-nonprod-pg` | `available` (db.t4g.micro), as expected while the session runs |
| ALB | `munaxa-nonprod` exists, as expected while the session runs |
| Session cleanup | One-time schedules `…-p-20261124t1310` at 13:10 UTC and `…-s-20261124t1340` at 13:40 UTC (both ENABLED); daily cleanup `cron(5 21 * * ? *)` UTC is ENABLED |
| Last 5 daily cleanups | 19 to 23 Nov, 21:05 UTC, all SUCCEEDED |
| Backstop schedules | 11 at 21:00 UTC, all ENABLED, including `backstop-work-api` and `backstop-work-admin` |

This thread did not touch the live session. Its shutdown belongs to the Control/Docs thread, and
the cleanup schedules above are its fallback.

## Drift and observations

- **No Work drift.** AWS matches `main`: no Work task definition, service or secret version.
- **Six old `munaxa-docs-eu-prod-*` task-definition families are still ACTIVE** (`api`,
  `ops-dbadmin`, `ops-provision`, `ops-tunnel`, `scanner`, `web`).
  - The 4 Nov retirement emptied every root but kept these registrations. A task definition
    costs nothing and runs nothing on its own.
  - Deregistering them would be an AWS change. That is **OWNER ACTION, optional**. It is not
    needed for Work.
- **MW-002 ordering (main report section 8) is confirmed live.** Identity runs `identity:4`.
  platform#176's re-pin is the next Identity apply, and it must happen before the Work pin PR.
