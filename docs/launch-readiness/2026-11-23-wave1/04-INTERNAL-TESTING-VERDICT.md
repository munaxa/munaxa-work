# 04. Internal Testing verdict

## Verdict: NOT READY for AWS Testing

Munaxa Work cannot join a Testing session yet, for two reasons that no repository change can
remove:

1. **No publishable Work image (MW-001).** Every Work image carries `libssl3`/`libcrypto3`
   `3.5.9-r1` with HIGH findings, so the permanent Grype gate fails. The owner decided to wait for
   Alpine OpenSSL 3.5.10, which had not shipped on 23 Nov 2026. With MW-009 merged, the publish
   workflows also refuse any commit whose `main` CI run is not fully green, so no image can be
   published by accident.
2. **The owner's AWS steps are pending (MW-002).** `nonprod.tfvars` holds no Work image or secret
   version, the two Work secret bundles have no version, and no Work task definition, database or
   role exists. The pin package is ready, but every step from W-3 on needs an image first.

Green CI in this wave is evidence about the repositories only. It says nothing about AWS: no plan
has run against the real account for Work, nothing was applied, and no Work task has ever started
in Testing.

## What is now ready in the repositories

| Area                         | Ready                                                                                                                                                | Evidence                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Testing personas             | Eight Testing-only Identity roles cover all 285 Work grants, fit the cookie and separate payroll and career decisions                                 | MW-003, identity#27, work#40                |
| Test data                    | A synthetic, idempotent data loader, an offline OpenAPI document and an API collection                                                               | MW-004, work#44                             |
| First tenant                 | A guarded bootstrap that refuses a wrong issuer or organisation before any write, with a dry run, and an E-1 family for `work-migrate`                | MW-005, work#41, platform#166               |
| Smoke test                   | Eight probes, no token in output; readiness reachable through ALB rule 49                                                                            | MW-006, work#39; MW-075, platform#168       |
| Admin session                | Refresh through Identity and a tenant picker, tested for 60 simulated minutes in a real browser                                                      | MW-007, work#42                             |
| Database safety              | Prisma-generated migrations, edits to merged migrations and drift growth fail CI; `db:reset` is local only                                           | MW-008, work#38, work#43                    |
| Release safety               | No image is built or pushed unless the commit's `main` CI run is green                                                                               | MW-009, work#37                             |
| Defects found while preparing | Organization lists, malformed ids, the attendance policy conflict, the payroll and performance organization sources, and a flaky test are fixed      | MW-070 to MW-074                            |
| AWS inputs                   | The exact pin, its 29 declared changes and a mocked plan                                                                                             | MW-002, platform#167                        |

## What changes the verdict

The verdict becomes **READY for a first Testing session** when all of these hold:

1. work#35 is merged and a `main` CI run is fully green, Images included (MW-001).
2. Steps W-3 to W-7 of the pin package are approved and verified read-only: three Work task
   definitions with pinned digests and versions, the db-admin revision, no service running.
3. The first tenant is bootstrapped through the E-1 guard and the personas are seeded.
4. A Testing session runs the MW-006 smoke test with exit 0 and the MW-004 loader with a recorded
   log.

The Jordan Pilot and Production verdicts of the audit are unchanged: this wave did not touch the
items behind them.
