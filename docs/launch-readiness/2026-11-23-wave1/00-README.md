# Munaxa Work launch readiness: Wave 1 execution report

**Date:** 23 November 2026 · **Audit this report follows:**
[`docs/launch-readiness/2026-11-23/`](../2026-11-23/) (unchanged by this report) · **Baselines at
the start of Wave 1 (20:25 UTC):** `munaxa-work` `main` `8a975f6`, `munaxa-identity` `main`
`0b94951`, `munaxa-platform` `main` `d2e6fcf` · **Final `munaxa-work` `main`:** `3addcb7` (MW-004, the last Wave 1 merge; a later MW-004b merge would move it)

Wave 1 implemented the nine "must fix before Internal Testing" items of the audit (MW-001 to MW-009)
as far as the repositories allow, and six items it discovered on the way (MW-070 to MW-075). Every
change went through a pull request, an independent verifier review and CI before the lead merged
it. Nothing in AWS was changed: no AWS call, no Terraform apply, no image publish, no secret, IAM,
DNS, GitHub environment or ECS change.

## Files

| File                                                             | What it holds                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [00-README.md](00-README.md)                                     | This index, the scope and the owner's instructions                                             |
| [01-EXECUTION-REPORT.md](01-EXECUTION-REPORT.md)                 | Per MW-ID: pull requests, branch, reviewed head, merge, CI, tests, verifier rounds, follow-ups |
| [02-UPDATED-BACKLOG-STATUS.md](02-UPDATED-BACKLOG-STATUS.md)     | Status of MW-001 to MW-009 and MW-070 to MW-075 against their acceptance criteria              |
| [03-OWNER-ACTIONS.md](03-OWNER-ACTIONS.md)                       | The ordered owner approvals still needed                                                       |
| [04-INTERNAL-TESTING-VERDICT.md](04-INTERNAL-TESTING-VERDICT.md) | The updated Internal Testing verdict                                                           |
| [05-LIMITS-AND-DISCLOSURES.md](05-LIMITS-AND-DISCLOSURES.md)     | What this wave could not verify, and where it stepped outside its rules                        |

## Scope

| ID     | Title                                                                    | Origin           |
| ------ | ------------------------------------------------------------------------ | ---------------- |
| MW-001 | Publishable Work images (OpenSSL 3.5.9-r1 HIGH findings)                 | Audit            |
| MW-002 | Work inputs in the Testing stack (pin package)                           | Audit            |
| MW-003 | Testing persona roles in Identity                                        | Audit            |
| MW-004 | OpenAPI artifact, synthetic data loader, API collection                  | Audit            |
| MW-005 | Guarded tenant bootstrap and E-1 coverage for `work-migrate`             | Audit            |
| MW-006 | Work smoke test                                                          | Audit            |
| MW-007 | Admin session refresh and tenant picker                                  | Audit            |
| MW-008 | SQL migrations authoritative; CI gates generated migrations and drift    | Audit            |
| MW-009 | Image publishing requires green CI                                       | Audit            |
| MW-070 | Organization unit, position and export lists answered 500                | Found by MW-004  |
| MW-071 | Malformed path ids and repeated attendance policy codes answered 500     | Found by MW-004  |
| MW-072 | Payroll organization source resolved a legal entity id as a unit id      | Found by MW-004  |
| MW-073 | Flaky career concurrency test                                            | Found in CI      |
| MW-074 | Performance organization source read a field the answer does not have    | Found by review  |
| MW-075 | Work API readiness not reachable from outside in Testing                 | Found by MW-006  |

## The owner's instructions for this wave

**MW-001, OpenSSL (decision recorded 23 Nov 2026, as relayed by the lead):**

> The owner has decided: WAIT for Alpine OpenSSL 3.5.10 (work#35). Do NOT widen D-SSL, do not change
> its expiry, do not weaken the Grype gates. If 3.5.10 is not out by 1 Dec 2026, only the
> image-dependent steps stop and the owner is asked for a decision then.

The other standing rules, from the Wave 1 contract:

- No AWS calls of any kind, no Terraform apply, no image publish, no secret, GitHub environment, IAM,
  DNS or ECS change.
- Do not touch the D-SSL exception, its expiry, the Grype or scan gates, or the withdrawn `b490b25`
  images. Those digests are never pinned.
- No real personal data, credentials or tokens in output or files. The Testing operator's e-mail is
  written only as the placeholder `IDENTITY_OPERATOR_EMAIL`.
- No `prisma migrate dev`, `db push` or `migrate reset` against anything shared, and no merged
  migration is ever edited.
- Agents never merge. The lead merges after an independent verification of the reviewed head.

## Status of this report

Every merge SHA and CI run is filled in. One item is still in progress: MW-004b, which makes CI fail
on OpenAPI drift, is referred to as `<<PR-MW004b>>` until its pull request exists. If MW-004b merges
after this report, `main` moves past `3addcb7`.
