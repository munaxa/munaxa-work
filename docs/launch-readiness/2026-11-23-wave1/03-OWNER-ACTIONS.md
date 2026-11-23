# 03. Owner actions

Each item is an approval or a decision by the owner. None of them asks the owner to type a command:
where a step runs something, it runs as an approved workflow, an approved one-off task or the
owner's existing CloudShell procedure from the pin package, exactly as written there. Claude
verifies each step afterwards with read-only access only.

The order matters: GitHub settings first (they protect everything after them), then the MW-001
decision point, then the AWS steps from the MW-002 pin package.

## A. GitHub settings (any time, before the first image tag)

1. **Approve an `image/*` tag ruleset on `munaxa/munaxa-work`.** Only the owner may create or move
   tags matching `image/*`. This closes the MW-009 Medium: without it, a tag on an old commit whose
   CI was green at the time would pass the gate.
2. **Approve a CODEOWNERS entry for the gate files**, with the owner as code owner and "require
   review from code owners" on `main`:
   - `.github/workflows/*`, `.github/scripts/*` (MW-009 gate);
   - `scripts/check-migration-safety.mjs`, `scripts/check-migration-drift.mjs`,
     `scripts/db-reset-guard.mjs`, `prisma/drift-baseline.json` (MW-008 gates);
   - `scripts/bootstrap-tenant*.mjs` (MW-005 guard).
3. **Approve deleting the branch `claude/project-thread-vglde2-mw008-proof`.** It holds the
   deliberately broken MW-008 proof (CI run 45260369090) and was never meant to merge.
4. **Optional: approve turning on auto-merge** for the repository. Wave 1 merged by hand because
   it is off; the required checks stay as they are.

## B. MW-001 and the publish rule

5. **MW-009 rule, standing:** approve no image publish until a `main` CI run is fully green,
   **including Images**. The gate enforces this for the `CI` run as a whole; with MW-001 open the
   gate refuses every commit, which is the intended behaviour.
6. **Approve work#35 when Alpine publishes OpenSSL 3.5.10-r0** and its CI, Images included, is
   green on `main`. This is the WAIT decision already made; nothing else changes.
7. **1 December 2026 decision point, only if 3.5.10 has not shipped.** The image-dependent steps
   (W-3 and W-5 to W-7 below) stay stopped, and the owner is asked for a decision then. This
   report proposes no option.

## C. The Work Testing pin (MW-002 package, munaxa-platform#167)

The steps are W-1 to W-7 of
`munaxa-platform/docs/aws-migration/agent-reports/2026-11-23-work-testing-pin-package/02-OWNER-STEPS-AND-VERIFICATION.md`.

8. **W-1, done:** the scan basis is the permanent Grype gate only (the WAIT decision).
9. **W-2, done:** MW-009 is merged (`7da2a88`), so `publish-images-ecr.yml` refuses a commit
   without a green `CI` push run on `main`.
10. **W-3, after step 6:** approve creating the tag `image/<40-hex sha>` on a `main` commit whose
    `CI` run is fully green, then approve the `image-release` environment for that run. The three
    digests come from that run's Push step summaries; no withdrawn `b490b25` digest is ever used.
11. **W-4:** in the owner's CloudShell procedure from the package, confirm the script checksum the
    package names, fill the two Work secret bundles, and paste back only the two version ids.
    `CONTROL_PLANE_TOKEN` stays the marked placeholder until Control has issued Work's credential.
12. **W-5 and W-5a:** review and approve merging the pin PR that Claude prepares from the package
    with the real digests and version ids.
13. **W-6:** approve the `aws-terraform.yml` plan run for `nonprod` with the session down. It must
    match the 29 declared changes exactly.
14. **W-7:** approve the apply run and the `aws-nonprod` gate after Claude has checked the plan.
    Services stay off.

## D. First Testing session for Work

15. **Approve the `work-migrate` E-1 family** (un-pend it in the guard manifest once it is pinned),
    then approve `bootstrap-tenant-dry-run` and, after reading its output, `bootstrap-tenant`, with
    the organisation id confirmed in Identity.
16. **Approve seeding the Testing personas** in Identity: the one-off task runs
    `seed-work-roles.mjs --testing-personas --environment testing` with the Testing Identity base
    URL and the Testing database URL by host name, then Identity is restarted as the script prints.
    The Testing operator account is referred to only as `IDENTITY_OPERATOR_EMAIL`.
17. **Approve a Testing session** with Work services on. Claude then runs the MW-006 smoke test
    (readiness through rule 49) and the MW-004 loader against the Testing hosts, and records the
    logs.
