# Phase 5.3 · Checkpoint 1 — Asset catalogue and inventory · Verification

*Implemented 2026-08-23 on `claude/phase-5-employment-workforce-xaxasu`, from the baseline `3d02922`,
under the owner's explicit authorization of Checkpoint 1.*

---

## 1. What was built

A new module, `@work/assets` — the first since Relations. Two tables, five commands, three reads, four
permissions, one additive migration, **zero cross-module dependencies**.

| | |
|---|---|
| **The catalogue** | `asset_category` — tenant configuration: code, localized name, ordering, active. Nothing ships in it. |
| **The inventory** | `asset` — the individual items: category, tag, serial number, description, location note, purchase reference, in-service status. |

Nothing here issues an item to anybody. **There is no custody.**

## 2. The plan's own promises, as code

**The scope is exactly what was approved.** Two tables, five commands, three reads, four permissions,
one migration. Counted by the tests rather than by this document: the boundaries suite asserts the
command and query names as exact sets, and the composition suite asserts 5 / 3 / 4 from the registered
module.

**Zero cross-module dependencies, asserted three ways.** The module's own imports resolve to exactly
`@work/kernel` and `@work/persistence` and nothing else; no port to another module is declared;
`assetsModuleFor` takes one argument, the unit of work. It is the shortest composition in the
repository, and the composition suite exists to keep it that way.

**Nothing was added for later.** No condition scale, no valuation basis, no acknowledgement or return
requirement, no document reference, no employment identifier, no amount of any kind. Each is asserted
absent in the domain, in the module source and — for the schema — in `information_schema.columns`, so
the claim is about the database that exists rather than the migration somebody thinks was applied.

## 3. Asset status: what is persisted, and what is derived

The specification's lifecycle runs *Registered → Available → Issued → In Custody → Returned → Under
Repair → Retired.* **Four of those seven are persisted.**

| Persisted | `registered` · `available` · `under_repair` · `retired` |
|---|---|
| **Derived, when custody exists** | `issued` · `in_custody` · `returned` |

The three that are missing are facts about *custody*, and the custody table will be their authority. A
copy on the asset would be a second answer that goes stale the moment a custody row is written —
ADR-0070's stored flag, and D-5.2-16's persisted projection, in one column.

This was **not raised as an owner decision**, because two settled precedents determine it. It is
recorded in the register's closing table with both named.

Transitions: `registered → available | retired` · `available → under_repair | retired` ·
`under_repair → available | retired` · `retired → ∅`. All sixteen ordered pairs are asserted, retirement
is terminal, and a move to the status an item already holds is **refused** rather than reported as a
success.

## 4. Identity: two identifiers, asymmetric on purpose

`asset_tag` is the tenant's own — the thing written on the sticker — **required and unique per tenant**.
`serial_number` is the manufacturer's — **optional, and unique per tenant when present**, because a
chair has none and two laptops must never share one.

Both are **partial unique indexes**, not reads (ADR-0071):

| Index | Predicate |
|---|---|
| `asset_tag_idx` | `(tenant_id, asset_tag) where deleted_at is null` |
| `asset_serial_idx` | `(tenant_id, serial_number) where serial_number is not null and deleted_at is null` |
| `asset_category_code_idx` | `(tenant_id, code) where deleted_at is null` |

The `byTag` and `bySerialNumber` reads exist so a storekeeper meets a sentence rather than a constraint
violation. They are a courtesy; the indexes are the guarantee.

A **blank serial number is stored as absent**, enforced in the domain *and* by
`asset_serial_shape_check`. Without both, every unserialled chair in a tenant would collide with every
other.

## 5. Concurrency, proved against PostgreSQL

Two real connections contending, **no sleeps and no timing assumptions**. The assertion is on the
invariant — exactly one survives — never on which one wins.

| Race | Arbiter |
|---|---|
| Two storekeepers registering the same tag | `asset_tag_idx` |
| Two storekeepers registering the same serial number | `asset_serial_idx` |
| Two administrators defining the same code | `asset_category_code_idx` |
| Two amendments from the same version | the `version` predicate in the `update`'s `where` |
| Two status moves from the same version | the same |

Two items with **no** serial number do not contend at all — the index is partial for exactly that, and
that is asserted rather than assumed. A soft-deleted row does not block its replacement either: a tag
written on a sticker outlives the laptop.

## 6. Security

**RLS enabled *and* forced** on both tables via `app_protect_table` (ADR-0030), verified as an
unprivileged role that holds neither `BYPASSRLS` nor `SUPERUSER` — asserted from `pg_roles`, because a
suite run as a superuser would report isolation without having checked it.

**Isolation proved in both directions**, and every assertion confirms the neighbour's row genuinely
exists through the admin connection: a "0 rows" over a row that was never written proves nothing.

**No tenant identifier anywhere a caller can reach.** No command, no query, no DTO and no route accepts
one — asserted over the `application` and `api` layers specifically, because infrastructure *must* write
`tenant_id` and takes it from `transaction.tenantId`. Two tenants may hold the same tag, the same serial
number and the same code, which proves the tenant is genuinely part of every key.

**Four permissions, per resource per capability.** `assets.category.read` · `assets.category.manage` ·
`assets.asset.read` · `assets.asset.manage`. There is no `assets.admin`, no wildcard, no permission for
custody, acknowledgement, incidents, waivers, approvals or payroll, and **no `assets.read-own`** — an
eleventh `read-own` that resolves to nothing (ADR-0032) would look like self-service and would not be.

Every command and query declares a permission, the declared set and the enforced set are asserted equal
in both directions, and a caller holding another module's grants — `employment.read`, `document.read`,
`payroll.approve`, `relations.violation.read` — reaches nothing here. The catalogue grants do not reach
the inventory and the inventory grants do not reach the catalogue.

**Authorization failure and absence are different answers, deliberately.** A caller without a permission
meets `forbidden`; a caller with it meets `not_found` for an identifier that is not theirs, so an
identifier cannot be used as a probe.

## 7. Audit

`created_by` / `updated_by` / `version`, plus `deleted_at` / `deleted_by`, on both tables — AD-007 and
the repository's standard shape, written by `@work/persistence` from the execution context.

**Reads are not audited, and there is no access-trail table.** Relations audits reads because a
violation is an allegation about a named person; an asset register is a list of laptops. Blanket read
auditing is the mechanism D-5.2-05 rejected. Asserted rather than stated: reading an asset and searching
the inventory both leave the store byte-identical.

**There is no actor column of this module's own**, and its absence is the guarantee. Who registered an
item is `created_by`. A second copy in a business column would be the same fact stored twice, and the
two would eventually disagree — so the way a caller is prevented from supplying an actor is that there
is nowhere to put one.

## 8. Immutability — deliberately none

**Neither table carries an immutability trigger, and the absence is asserted by querying `pg_trigger`.**

AD-003's immutability is about *custody history*. Reading it across to a catalogue and an inventory
would freeze them the day they were typed, including their typos — and a description that cannot be
corrected is a register nobody trusts. An asset leaves service by retirement, a category by
deactivation; neither repository has a remove.

The append-only table with the unconditional trigger arrives with `asset_custody`, where the invariant
actually lives.

## 9. Boundaries

| Boundary | State |
|---|---|
| Payroll | **untouched** — no file in the diff, no port, no command, no amount, no numeric column |
| Employment | **untouched** — no reference, no port, no identifier |
| Workflow | **untouched** — no subject, no instance, no `ApprovalPort` consumption |
| Documents | **untouched** — no reference, no adapter, **no `document_source` change** |
| Identity | **untouched** — no membership read |
| Platform | **untouched** — nothing scheduled, no `JobPort`, no clock |
| People | **untouched** — no person, anywhere (AD-001) |
| Relations | **untouched** |

Each is a test, not a promise. `git diff --stat` shows production changes in `packages/modules/assets`,
`apps/api/src/assets`, three lines of registration in `apps/api/src/{app,identity}.module`, the Prisma
models and one new migration — and nothing else.

## 10. What was deliberately not built

* **Custody, in every form** — assignment, transfer, acknowledgement, return, custody history, the
  one-custodian invariant. Checkpoint 2, and it needs D-5.3-01 and D-5.3-05.
* **Incidents, liability, waivers** — Checkpoint 3.
* **The clearance projection** Offboarding consumes — Checkpoint 4.
* **The condition scale** — D-5.3-05 is open, and nothing here records a condition.
* **The valuation basis and any deduction** — D-5.3-03 is open, and no numeric column exists.
* **Document references** — D-5.3-04 settled *how*, and an identifier column nothing reads is the
  stored flag ADR-0070 names.
* **The eight domain events the specification names** — every one describes custody, dispatch is
  at-most-once with no outbox (ADR-0053/0064), and none has a consumer.
* **Self-service acknowledgement** — `NOT VERIFIED`, for the repository-wide ADR-0032 reason, and
  nothing is stubbed for it.

None of these is stubbed, flagged or half-modelled. Each is asserted absent by name.

## 11. Decisions

| Decision | State after this checkpoint |
|---|---|
| D-5.3-01 — custody after an employment ends | **OPEN**, unchanged. The recommendation is documented; **no termination behaviour was implemented**, no Employment reference created, no ended-employment consumer written |
| D-5.3-03 — the Payroll intake | **OPEN**, unchanged. `payroll.record-adjustment` is not called, no Payroll port exists, Payroll is untouched |
| D-5.3-05 — the condition scale | **OPEN**, unchanged. The direction is documented; **no condition column was created**, and no unused column was added to prepare for one |
| D-5.3-02 · D-5.3-04 · D-5.3-06 | **SETTLED BY EXISTING EVIDENCE**, and none was reopened. None applies to Checkpoint 1 |

**No decision was approved by this implementation, and none was reopened.**

## 12. Stated limitations

1. **The catalogue carries less than the specification's `AssetCategory`.** The condition scale,
   acknowledgement requirement, return requirement and valuation basis are absent by design; three of
   the four are downstream of custody or of an open decision.
2. **Asset status cannot express custody**, and until Checkpoint 2 exists there is no derived answer
   either. An asset that is in somebody's hands today reads as `available`.
3. **`locationNote` is free text, not a location.** Organization owns units; a foreign key here would
   have invented a boundary. Reporting by organizational unit is not possible and is not claimed.
4. **`purchaseReference` is free text and carries no value.** Finance owns value and depreciation; there
   is no numeric column on either table.
5. **A tag is unique per tenant and immutable.** A tenant that mis-keys one corrects it by registering
   the item again, because a tag that could be edited is not an identity.
6. **Legal validity is `NOT VERIFIED`.** No jurisdiction prescribes what a company may call a laptop,
   and there is no country-pack provenance on this catalogue — deliberately, unlike Relations'.

## 13. Two defects in my own work, found by the gate and fixed

1. **A complexity budget passed, and the function was split rather than exempted.**
   `identifierClash` reached a complexity of 11 against a maximum of 10, because it asked the same
   three questions twice — is a value given, does something hold it, and is that something this item.
   Asked once now, in `takenBySomebodyElse`, which is where the repetition already was. No rule was
   exempted and no assertion changed.

2. **A test smuggled extra fields through `as never`**, which the lint caught as an unsafe argument.
   The assertion was worth keeping — that an amendment cannot change the category, the tag or the
   status even if a caller sends them — so it was rewritten with the request typed as
   `AmendAssetRequest & Record<string, unknown>`. The extra keys are genuinely present at runtime,
   which is what the assertion needs, and the call is now type-safe: if `AmendAssetRequest` ever
   legitimately grew one of those fields, this would fail to compile rather than pass silently.

Both were in code written for this checkpoint. Neither was worked around.

## 14. Verification

Every figure below is from an actual run, and the gate's status is Turbo's own exit code — the command
was not piped into anything that could have replaced it.

| Gate | Result |
|---|---|
| `pnpm standards` | clean — **185** models, **19** catalogue sets, **1,867** source files, no cycles, no unused dependencies, no unreachable files |
| `pnpm format:check` | clean |
| `prisma validate` | valid |
| `prisma migrate status` | **30 migrations**, database up to date, **no drift** |
| `turbo run build lint typecheck test --force --concurrency=1` | **116 / 116 tasks successful · `TURBO_EXIT=0` · 13m 15s** |
| Tests | **4,732 passed, 0 failed, 0 skipped** |

Of those, **`@work/assets` contributes 99 tests in 8 files** — 24 domain, 6 catalogue, 15 inventory, 12
authorization, 17 negative space, and **25 integration tests against real PostgreSQL** (14 constraints,
6 concurrency, 5 isolation). `@work/api` contributes 15 more in the two assets specs, inside its 821.

Also verified: no `.only`, no `any`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`, no
skipped test anywhere in the new code. The only `skipIf` is the fixture's database guard, which
**refuses to skip in CI**.

The migration is purely additive: it creates two tables and their constraints, indexes and policies,
and alters nothing that existed. `git diff --stat` outside `packages/modules/assets`,
`apps/api/src/assets`, `docs/` and `prisma/` is four files — `apps/api/package.json`,
`apps/api/src/app.module.ts`, `apps/api/src/identity/identity.module.ts` and `pnpm-lock.yaml` — and all
three code changes are module *registration*. **No module's production code was modified.**

*(`apps/api/src/identity/identity.module.ts` is the application's shared composition root where every
module registers, not Identity's own production code — `packages/modules/identity` is untouched. The
distinction is drawn here rather than glossed, because "Identity untouched" would otherwise be a claim
the diff contradicts.)*
