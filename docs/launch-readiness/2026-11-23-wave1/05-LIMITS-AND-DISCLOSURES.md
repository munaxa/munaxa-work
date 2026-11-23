# 05. Limits and disclosures

## What could not be verified

- **No local install.** `pnpm install` in `munaxa-work` and `munaxa-identity` fails in the agents'
  sessions: GitHub Packages refuses the `@munaxa/*` packages with 401, and no token was configured.
  So lint, typecheck and the vitest suites could not run locally. **CI is the evidence** for them.
  Agents ran locally only what needs no install: the standards, architecture, localization and
  dependency checks, `node:test` files, Terraform tests with a mocked provider, and scratch
  PostgreSQL 16 databases. Where a pull request reports local vitest, ESLint or `tsc` runs, they ran
  in a scratch copy with dependencies linked in by hand and are supporting evidence only.
- **MW-009 was not tested on a real tag.** Creating an `image/*` tag would start a real publish,
  which this wave may not do. The gate is proven by 20 offline tests and by running its decision
  against the real CI history of two commits (one refused, one accepted).
- **No Testing session.** Nothing in this report was run against AWS. Acceptance criteria that name
  a Testing run log are open (see [02-UPDATED-BACKLOG-STATUS.md](02-UPDATED-BACKLOG-STATUS.md)).
- **MW-007 built app.** The signed-out redirect in a real `next build` and `next start` was checked
  by hand; CI tests the real middleware and a browser flow, not the built app.
- **Organisation existence (MW-005).** Identity has no credential-free endpoint to confirm an
  organisation exists, so the bootstrap guard cannot check it; the operator does, in Identity.

## The Images job

The `Images (api, migrate, admin)` job **fails on every `munaxa-work` pull request and on `main`**
because of MW-001 (OpenSSL `3.5.9-r1`). It is not a required check, so pull requests merged with it
red. The other four jobs (Standards · Architecture · Localization, Product isolation, Mobile,
Lint · Typecheck · Test · Build) were green on every merged head recorded in
[01-EXECUTION-REPORT.md](01-EXECUTION-REPORT.md). The Images failures read in this wave, for example
run 45264138891, show only the known OpenSSL findings. Identity's Images job passed on identity#27.

## Steps outside the agreed rules

- **Agent C read GitHub Actions jobs once with `gh api`.** The contract allowed `gh api` only for
  `GET search/...` and asked for the GitHub MCP tools otherwise. The call was a read of a job's
  details, made no change, and is disclosed here as outside the allowed form.
- The lead's tracker records no other deviation. No AWS call, apply, publish, secret,
  IAM, DNS, GitHub environment or ECS change was made, and the D-SSL exception, its expiry, the Grype
  gates and the withdrawn `b490b25` images were not touched.

## Data and secrets

- All test data is synthetic: names from the spelling alphabet, `example.test` addresses, no
  identifiers of real people.
- No credential, token or secret value appears in any pull request, file or log of this wave. The
  Testing operator's e-mail appears only as `IDENTITY_OPERATOR_EMAIL`. Example digests and secret
  version ids in tests are public placeholders.
