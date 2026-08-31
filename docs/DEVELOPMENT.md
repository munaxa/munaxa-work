# Development guide

## Prerequisites

Node 22, pnpm 10, Docker. Installing needs a GitHub token with `read:packages` on the `munaxa`
org — the shared design system is published to GitHub Packages, not npm:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" <token>
```

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up            # postgres, redis, mailpit
pnpm verify           # standards · architecture · format · lint · typecheck · test · build
```

## Running the applications

| Application | Command | Port |
| ----------- | ------- | ---- |
| API | `pnpm --filter @work/api dev` | 3000 |
| Admin | `pnpm --filter @work/admin dev` | 3001 |
| Employee portal | `pnpm --filter @work/employee-portal dev` | 3002 |
| Manager portal | `pnpm --filter @work/manager-portal dev` | 3003 |
| Mobile | `cd apps/mobile && flutter run` | — |

The mobile application is not a pnpm workspace member and is not built by turbo: it has its own
toolchain and its own CI job.

## The API

| Endpoint | Purpose |
| -------- | ------- |
| `GET /health/live` | Liveness. The process is running |
| `GET /health/ready` | Readiness. It can serve traffic |
| `GET /health` | Health, version, build and dependency status |
| `GET /api/docs` | OpenAPI |

Health probes are deliberately unprefixed and unversioned: an orchestrator's probe URL must not
change when the API version does. Everything else lives under `/api/v1`.

## Workspace layout

```text
apps/api                     # the product API — transport only
apps/admin                   # HR administration
apps/employee-portal         # employee self-service
apps/manager-portal          # manager self-service
apps/mobile                  # Flutter application (own toolchain)
packages/kernel              # Shared Kernel (Phase 1)
packages/modules/<module>    # business modules, layered inside (ADR-0023)
packages/persistence         # connections, Unit of Work, tenant scoping — the only package that knows a driver exists
packages/config              # the only place the environment is read
packages/contracts           # cross-module public contracts
packages/sdk                 # typed API client
packages/testing             # shared test infrastructure
packages/country-packs       # statutory content (Phase 11.1)
prisma/                      # schema and migrations
tooling/                     # the engineering standards, as lint and compiler configuration
```

## The rules, and where they are enforced

| Rule | Enforced by |
| ---- | ----------- |
| Complexity, file budgets, naming, layer direction, module independence | `tooling/eslint/standards.mjs` |
| Compiler strictness | `tooling/typescript/standards.json` |
| File naming, suppression markers | `scripts/check-standards.mjs` |
| Tenant, audit, soft delete, versioning, `snake_case` in the schema | `scripts/check-architecture.mjs` |

A rule is changed by an ADR in [`adr/`](adr/), never by a suppression. There is no inline
escape hatch: `noInlineConfig` makes a committed `eslint-disable` inert, and the standards gate
reports it.

## Tenant isolation

Three mechanisms, layered (ADR-0030), because a cross-tenant disclosure cannot be walked back:

1. Every business table carries `tenant_id`, enforced by `scripts/check-architecture.mjs`.
2. PostgreSQL row-level security refuses the query — applied by the foundation migration.
3. The application sets `app.tenant_id` per transaction and repositories filter by tenant.

The application role must not be a superuser and must not hold `BYPASSRLS`. A superuser bypasses
every policy in the file while every test still passes, so `app_isolation_diagnostics()` reports
it and startup refuses to serve.

`packages/testing/src/tenant-isolation.integration.test.ts` proves the property against a real
database: reads, inserts, updates and deletes across tenants, and the no-tenant case failing
closed. It skips without a database locally and **refuses to skip in CI**.

```bash
pnpm db:up
pnpm db:migrate     # applies the policies; without it, startup refuses
TEST_DATABASE_URL=postgresql://work:work@localhost:5432/work pnpm test
```

The application **will not start** against a database where isolation is not enforced. Two
configurations are refused: a connection whose role can bypass row-level security (a superuser,
or one holding `BYPASSRLS`), and a database where the migration has not been applied. Both are
single mistakes that would otherwise leave every policy silently inert while the application
looks healthy.

Migrations run as a privileged role; the application connects as an unprivileged one that owns
no tables.

## Writing through the Unit of Work

Every write goes through it, and it guarantees three things so no module has to remember them:

```ts
await runInContext({ tenantId, correlationId, actor }, async () =>
  unitOfWork.execute(async (transaction) => {
    const request = LeaveRequest.approve(...);      // records events, does not publish them
    await repository.save(transaction, request);    // asserts the version it read
    transaction.collect(request.pullEvents());      // published only after commit
  }),
);
```

1. `app.tenant_id` is set **transaction-local**. A session-level setting would survive a pooled
   connection's checkout and apply one request's tenant to the next — failing *open*, while
   looking like it works.
2. Events publish **after** commit. Nothing downstream reacts to a change that rolled back.
3. A failure rolls back and publishes nothing.

A handler that fails after commit does not undo the write — it cannot, the transaction is
durable. The error surfaces to the caller and the business fact stands, which is the honest
outcome.

## Foundation documentation

| Document | Answers |
| -------- | ------- |
| [Foundation architecture](foundation/architecture.md) | What Phase 1 built and why each piece is shaped that way |
| [Dependency diagram](foundation/dependency-diagram.md) | What may depend on what, and the rules that encodes |
| [Module guide](foundation/module-guide.md) | How to add a business module |
| [CQRS guide](foundation/cqrs-guide.md) | Commands, queries, the pipeline, failure kinds |
| [Event guide](foundation/event-guide.md) | The envelope, publication, versioning, naming |

## What the kernel gives you

Never rebuild any of these in a module — that is what the shared kernel is for.

| Need | Use |
| ---- | --- |
| Expected failure | `Result`, `ok`, `err` — domain rules return, they do not throw |
| Violated invariant | `DomainException`, `ConcurrencyException`, `TenantIsolationException` |
| Identifier | `uuidV7()` — time-ordered, so indexes stay dense |
| Money | `Money` — integer minor units, currency exponent supplied, rounding stated |
| Fractional amount | `Quantity` — leave balances accrue exactly |
| Period | `DateRange` — half-open, so adjacent periods neither overlap nor gap |
| History | `Timeline` — supersedes, never rewrites; one value per date, enforced |
| Dates | `toHijri`, `fromHijri`, `serviceBetween` — calendar stated, never assumed |
| Tenant-aware text | `LocalizedText` — cannot publish with a language missing |
| Business rule | `evaluateRule`, `versionInForce` — deterministic, versioned, self-explaining |
| Aggregate | `AggregateRoot` — records events, asserts its version |
| Command / query | `Dispatcher` — tenancy, then authorization, then validation, then the handler |
| Read model | `Projection`, `project`, `verifyRebuild` |
| Approvals / notifications / documents | `ApprovalPort`, `NotificationPort`, `DocumentPort` (ADR-0024) |
| Feature flag | `InMemoryFeatureFlags` — user beats tenant beats default; unknown is off |
| Tests | `@work/testing` — `InMemoryUnitOfWork`, `FakeRepository`, `permitting`, `assertEventRaised` |

## Two things People learned that the next module should not rediscover

**A parameter a query never references is a query PostgreSQL refuses.** Building a `where` clause
from a fixed placeholder list and passing `null` for the unused filters looks tidy and fails with
`could not determine data type of parameter $2` the moment every filter is absent — which is the
*ordinary* case for a first page. Build the clause and its parameters together
(`person-search.ts`). Organization's repositories carry the older shape and have not hit it because
their unfiltered path goes through a different method.

**A check constraint passes when its result is NULL.** `check (kind = 'skill' and title ? 'en')` is
NULL — and therefore accepted — for a skill with no title at all, which is exactly the row it exists
to refuse. Write the rule as a `case` that returns a definite boolean on every branch. The
integration suite caught this one; a unit test could not have.

**Row-level security stops the planner using an index for a substring search.** `ilike` is not a
leakproof operator, so PostgreSQL will not evaluate it as an index condition ahead of a security
qual — a trigram index on a name is therefore unused by an application that connects with RLS in
force, and it costs writes for nothing. Measured both ways in the Phase 4 report. Do not add one
without measuring *as the application role*.

## Conventions worth knowing before your first commit

**One secret is required, and refused if it is the default.** `PII_MATCH_SECRET` is the key
People derives duplicate-match digests with — a national identifier is compared through a keyed
digest rather than in plaintext, so the query that finds who already holds a number never reads
one. A development default ships so a checkout runs; `loadEnvironment` refuses it when
`NODE_ENV=production`, because a shipped default is the same key in every deployment.

**The environment is read once.** `packages/config` validates `process.env` at startup and
exposes a frozen, typed value. Reading `process.env` anywhere else is a lint error. A missing or
invalid variable fails the process immediately rather than surfacing as a confusing error later.

**Errors leave as Problem Details.** RFC 9457, always. A deliberate `HttpException` may carry a
message for the client; anything else returns a generic detail and the real cause goes to the
log. Stack traces, SQL and connection strings never reach a response.

**Every request is traceable.** `x-request-id` is ours and always new; `x-correlation-id` is the
caller's if it sent one. Both are echoed and both appear on every log line.

**Presentation owns no business logic.** The portals consume `@munaxa/ui` and `@munaxa/theme`
from the registry and the API over `/api/v1`. Never rebuild a component here, never hardcode a
colour, and never reach past the API into a domain — the lint layer enforces all three.

**Tests boot the real composition.** `configureApplication` is shared by `main.ts` and the API
tests, so routing, prefixes, validation and the error filter are tested as they actually run.

## Running the integration tests without Docker

The suites that prove tenant isolation need a real PostgreSQL, because the property under test
belongs to the database rather than to our code. `pnpm db:up` starts one with Docker; where
Docker is unavailable, a local cluster works just as well:

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
initdb -D /tmp/pgdata -U work --auth=trust
pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp/pgrun -c listen_addresses=127.0.0.1' -l /tmp/pgdata/log start
psql "postgresql://work@127.0.0.1:5432/postgres" -c "create database work" \
                                                 -c "alter user work with password 'work'"

DATABASE_URL=postgresql://work:work@127.0.0.1:5432/work pnpm db:migrate
TEST_DATABASE_URL=postgresql://work:work@127.0.0.1:5432/work pnpm test
```

The migration user must be privileged; the suites create their own unprivileged roles and
connect as those, because a test that ran as a superuser would prove nothing about row-level
security — a superuser bypasses every policy.

**`pnpm test` runs packages one at a time** (`turbo run test --concurrency=1`), and that is not a
performance oversight. Every module's integration suite shares one database and truncates its own
tables between tests; run two at once and they delete each other's fixtures. Worse since Phase 5:
`employment.person_id` is a foreign key to `person`, so People truncating its tables with `cascade`
while Employment's suite runs would take Employment's rows with it. Each suite already serializes
its own files (`fileParallelism: false`) for the same reason — this extends the same rule across
packages. A module's own suite still runs on its own with `pnpm --filter <package> test`.

## Running the API locally

The API refuses to serve without an authenticated principal, and this repository ships no
authentication (Platform owns it — ADR-0001). Until Platform's adapter is wired in, every
business endpoint answers 401 and the health probes answer normally. That is the intended state,
not a misconfiguration:

```bash
$ curl -s http://localhost:3000/api/v1/identity/members | jq .title
"Unauthorized"
$ curl -s http://localhost:3000/health/live | jq .status
"ok"
```

The application must connect as a role that owns no tables and holds no `BYPASSRLS`; it checks at
startup and exits if it can bypass isolation (ADR-0030). The role the migrations run as will not
do — create an unprivileged one:

```bash
psql "$DATABASE_URL" -c "
  create role work_app login nosuperuser password 'work_app';
  grant usage on schema public to work_app;
  grant select, insert, update, delete on all tables in schema public to work_app;
  grant execute on all functions in schema public to work_app;"
```

then point `DATABASE_URL` at `work_app`. Starting as the migration user produces:

```
Failed to start: IsolationNotEnforcedError: Refusing to start: the database role "work" can
bypass row-level security because it is a superuser.
```

which is the guard working, not a fault.

## Bootstrapping the first tenant

A migrated database has no tenant in it, and cannot get one through the API: every business route
needs an authenticated principal with a membership, and the first membership is what does not exist
yet. `pnpm db:bootstrap` writes it, so a staging database becomes operable without hand-written SQL.

```bash
DATABASE_URL=postgresql://work_app:...@host:5432/work \
  pnpm db:bootstrap --platform-user-id <the Platform account's subject>
```

**Prerequisites.** A database with every migration applied (`pnpm db:migrate`), the unprivileged
`work_app` role above, and — this is the part that is easy to miss — **a Platform account that
already exists**. Munaxa Work creates no identity (ADR-0001): `--platform-user-id` is the stable
subject Platform will put in the `sub` claim of that account's tokens. Ask Platform for it; do not
invent one, and do not use a value that has to be a secret, because it is written to the database in
plaintext and printed to the console.

**Inputs.**

| Flag | Required | What it is |
| ---- | -------- | ---------- |
| `--platform-user-id` | Yes | The Platform account being admitted. Fails clearly if absent. |
| `--tenant-id` | No | A UUID v7. Generated when omitted; a v4 is refused, because `runInContext` refuses one on the first request. |
| `--allow-production` | Only when `NODE_ENV=production` | Admitting an identity is a real grant of reach, so in production it must be deliberate. |

**Environment.** `DATABASE_URL` only, pointing at the application role. Nothing else is read, and no
secret is involved.

**What it writes**, in one transaction, under the same row-level security every request runs under:

```text
workforce_user     the Platform account, status 'active'
tenant_membership  that user, in the tenant, status 'active'
```

and prints what it created:

```text
Bootstrapped tenant 01920000-0000-7000-8000-00000000b007.
  workforce user  01920000-…  (platform user hr-lead@example)
  membership      01920000-…  status active
No permission was granted: Platform must assign this account the work:* grants it needs.
```

**Idempotency.** Run it twice and the second run reports what it found and writes nothing:

```text
Already bootstrapped. <id> is an active member of tenant <id> (membership …, workforce user …).
Nothing was written.
```

It will not move somebody to a different tenant, reassert a status, or touch `updated_at`. If a
workforce user exists for that Platform account but resolves to no active membership, it refuses and
says so rather than guessing what should happen.

**Database privileges.** The command runs as `work_app` and needs nothing more than the application
already has: `insert` on `workforce_user` and `tenant_membership`, and `execute` on
`app_memberships_of`. It grants no privilege, changes no policy, and leaves the role unable to bypass
isolation. `workforce_user`'s policy carries `with check (true)` precisely so the user can be written
a moment before the membership that makes it readable, so no elevation is needed for this.

**One privilege it does depend on, on the *migration* role.** `app_memberships_of` is
`security definer` over tables with `force row level security`, which applies to their owner too. If
the role that ran the migrations can neither bypass row-level security nor is a superuser, that
function returns no rows — tenant resolution then finds no membership and **every authenticated
request answers 401 with nothing in the log to say why**. Bootstrap verifies its own work through
that function and fails with this diagnosis rather than leaving it to be discovered later. Grant the
migration role `BYPASSRLS`; the application role stays unprivileged (ADR-0030).

**What it does not do.**

- It creates no Platform identity, credential, token or password.
- It grants **no permission**. Authorization arrives in the verified token (ADR-0076), so a
  bootstrapped member can sign in and still do nothing until Platform grants them Work permissions.
- It writes no `tenant_settings` row. A tenant without one uses the deployment's defaults
  (ADR-0036); writing one would freeze this deployment's defaults into the tenant as though somebody
  had chosen them.
- It creates no employee, organization or business data.

**Assigning permissions.** On the Platform side, the account needs Work grants in the `work:`
namespace. The exact list is generated from Work's own declarations:

```bash
node scripts/emit-permission-catalogue.mjs        # every grant, in Platform's form
node scripts/emit-permission-catalogue.mjs --work # the same, in Work's names
```

**Verifying a tenant.** Ask the database the same question the request pipeline asks:

```bash
psql "$DATABASE_URL" -c "select * from app_memberships_of('<platform user id>')"
```

One row, status `active`, is a member who will resolve. No rows means either the bootstrap did not
run or the migration role cannot bypass row-level security — check that first.

**Removing staging data.** There is no undo command, deliberately: a command that deletes
memberships is a command somebody eventually points at production. Remove a bootstrapped member by
hand, as the migration role, naming exactly what you mean:

```sql
delete from tenant_membership m using workforce_user u
 where u.id = m.workforce_user_id and u.platform_user_id = '<platform user id>';
delete from workforce_user where platform_user_id = '<platform user id>';
```

To start over entirely, `pnpm db:reset` re-runs every migration on an empty database.

## Running a portal locally

The portals read the product through the API and hold no business logic. They take one variable,
validated at startup like everything else (`@work/config`):

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `WORK_API_URL` | `http://127.0.0.1:3000` | Where the portal reaches the API |

```bash
WORK_API_URL=http://127.0.0.1:3000 pnpm --filter @work/admin dev
```

The organization screens live at `/organization` and the people register at `/people`. Both take
`?asOf=` to render as at a date and `?lang=ar` to switch language and direction together:

```bash
curl -s "http://localhost:3001/organization?lang=ar" | grep -o 'dir="[a-z]*"'
curl -s "http://localhost:3001/people?lang=ar" | grep -o 'dir="[a-z]*"'
```

Until Platform's authentication adapter is wired in the API answers 401, so the screens render
their empty states. That is the expected condition today rather than a fault.
