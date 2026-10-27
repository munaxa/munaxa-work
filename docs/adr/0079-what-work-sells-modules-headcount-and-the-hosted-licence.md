# ADR-0079 — What Work sells: modules, headcount, and the hosted licence

**Status** Accepted
**Date** 2026-10-26
**Author** Munaxa Work engineering
**Approval** Pending review
**Relates to** [ADR-0078](0078-licence-gate-through-the-shared-licensing-contract.md) (the request
gate), [ADR-0076](0076-cross-product-authorization-contract.md) (a licence is never a grant),
munaxa-platform ADR-0022 (`@munaxa/licensing`), munaxa-control (the central subscription service)

## Context

ADR-0078 capped requests by a licence's term but left two product decisions open: which parts of
Work a plan includes, and what it limits. Hosted Work also had no way to ask the central
subscription service, which now exists (`munaxa-control`), so a hosted tenant could not be
suspended or limited at all.

## Decision

1. **The catalogue is Work's** (`apps/api/src/licensing/catalogue.ts`). The central service stores
   plans whose keys it never interprets; this file is the one place that says what each key means.
   No price is in it: what a key costs is a commercial decision recorded in the central service.
2. **Core modules are never gated**: identity, organization, people, employment, onboarding,
   attendance, leave, documents, letters and workflow. They are the HR record system itself, and
   gating them would hold a customer's own records hostage to an upsell.
3. **Licensable modules, one feature key each**, named after the module: `payroll`, `compensation`,
   `recruitment`, `performance`, `learning`, `career`, `relations`, `assets`.
4. **One limit: `employees`** — the licensed headcount, counted as employments that are not ended
   (draft, pending approval, active, suspended). `null` in a plan is unlimited. A plan that does not
   list it licenses nobody, as the shared contract reads every unlisted limit, so every Work plan
   names it.
5. **Modules are gated in the dispatcher, not on controllers.** Every operation declares its
   permission, and every permission is `<module>.<action>`, so the kernel's new `OperationGate`
   learns the module without a decorator any controller could forget. The gate runs after the
   permission check — an unauthorised caller learns nothing about the plan — and only for the
   **outermost** operation: Leave asking Compensation while handling a leave request is modules
   collaborating on an operation already admitted, and refusing it would let one module's
   entitlement break another module's work. A permission whose module is in neither list needs a
   feature no plan includes: a module added without a catalogue decision is refused, not free.
6. **Headcount is enforced in Employment's create transaction**, under a per-tenant advisory lock
   taken before counting, so two concurrent hires cannot both take the last place. Employment holds
   a `HeadcountLicence` port and never learns what a licence is.
7. **Refusals travel as `NotEntitledException`** (in `@work/kernel`, not a `DomainException`) and the
   one problem-details filter answers `402` with the contract's reason. Seventeen per-module failure
   mappings stay as they are.
8. **`LICENSING_MODE=CONTROL_PLANE`** asks the central service per tenant
   (`GET /api/v1/products/work/tenants/{tenantId}/entitlements`, bearer service credential, no
   redirects, 3-second timeout), reusing an answer for a minute. A `404` is "no subscription" and
   drops the remembered snapshot; any other failure, including `401`, is an outage, during which
   the last answer is degraded by age through the shared policy: full for an hour, no growth (no
   hiring) for a day, read-only for a week, then nothing. The URL must be `https` in production.

9. **What was verified is kept** in `licensing_state`, one row per tenant under
   `app_protect_table`: the last snapshot and the latest instant observed, which only moves
   forward (`greatest` in SQL). Read once per tenant per process, written on every answer. A process
   started during an outage bridges it like a running one; a kept "no subscription" bridges nothing;
   a clock wound back across a restart cannot make an ended term current.
10. **A cancelled organisation exports its records.** Its access mode is `EXPORT_ONLY`. An operation
    whose permission is `<module>.export` is an `EXPORT`, which that mode admits; every other read
    and every write is refused. The request guard lets `GET …/export` through to the gate, and the
    gate decides by the dispatched query's *permission*, so a route merely named `export` that reads
    anything else is still refused. The exports are the modules' own: people, employment,
    organization structure, attendance, and recruitment where the plan included it. Nothing is
    deleted; reactivation in the central service restores everything else.
11. **The licensed headcount is reported** to the central service under `CONTROL_PLANE`: at most once
    per tenant per hour per process, on the tenant's first admitted operation in that hour, measured
    by Employment's own count (the rows the limit counts) and stamped with the hour, so several
    processes report one point. Best effort; informational at the other end.

## Consequences

- Clock rollback is now detected across restarts too, as in Docs and School; a clock that was
  wrong from the first boot and never moved backwards still cannot be detected.
- A tenant that does nothing in an hour is not reported for it; its headcount cannot have changed
  through Work.
- `licensing_state` is a new table: the deployment's standing grant to `work_app` must cover it
  (`grant select, insert, update, delete on all tables in schema public to work_app`, or the
  equivalent default privileges), as for every migration.

## Alternatives considered

- **A `@LicensedFeature()` decorator on each controller** — a controller written next year without it
  is a free module. The permission already names the module.
- **Gating nested operations too** — makes core modules fail when they consult a licensable one.
- **Counting headcount outside the transaction** — two concurrent hires both see the last place.
