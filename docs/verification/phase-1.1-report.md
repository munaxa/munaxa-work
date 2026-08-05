# Phase 1.1 — Architecture Verification

**Date** 2026-08-05 · **Verdict** Pass, with three limitations stated below

This phase implements no functionality. Its purpose is to confirm that Phases 0 and 1 comply
with the standards before any business code is written, and to record what is not yet true.

Every claim here is evidenced by a command that was run, not by a reading of the code. Where
something could not be verified in this environment, it says so rather than being marked pass.

---

## 1. Repository verification

| Check | Result | Evidence |
| ----- | ------ | -------- |
| Workspace structure | Pass | Module-first per ADR-0023; `packages/modules/` awaits its first module |
| Folder organization | Pass | `scripts/check-standards.mjs` |
| Naming conventions | Pass | Same gate, per ecosystem (ADR-0029) |
| Package ownership | Pass | Each package's purpose stated in its manifest |
| Application boundaries | Pass | Portals depend on the SDK and the design system only |
| Configuration | Pass | One package reads the environment; lint enforces it |
| No duplicate packages | Pass | `check-dependencies.mjs` — no duplicate utility exports |
| No unused packages | Pass | Same gate — no dependency nothing imports |
| No circular workspace references | Pass | Same gate — cycle detection over 91 source files |

## 2. Module boundary verification

No business module exists yet, so there is nothing to violate a boundary. What is verified is
that the boundary is enforceable before the first module arrives:

- The layer globs in `tooling/eslint/standards.mjs` match `domain`, `application`,
  `infrastructure`, `api` and `presentation` at any depth, so a module gets them for free.
- Repositories and `@prisma/client` are importable only from infrastructure.
- Presentation applications may import neither business layers nor persistence.

Proven by fixture: files placed in each layer importing what they must not were rejected, with
the message naming the rule.

## 3. Dependency verification

```
Dependencies: 91 source file(s), no cycles, no unused dependencies, no unreachable files.
```

The permitted direction is `domain ◄ application ◄ infrastructure ◄ api ◄ presentation`, and it
is enforced by lint rather than convention. No cycles exist at file or package level.

## 4. Shared kernel verification

**Contains no business concept.** A search of `packages/kernel/src` for HR vocabulary
(`employee`, `employment`, `payroll`, `salary`, `leave`, `attendance`) returns nothing outside
comments, where those words appear only as examples explaining why a primitive is shaped as it
is.

Present and reusable: `Entity`, `AggregateRoot`, `ValueObject`, `Repository` contracts,
`UnitOfWork`, `Specification`, `Result`, `DomainException`, audit and version information,
`DateRange`, `Money`, `Quantity`, `LocalizedText`, paging, calendars, `ServicePeriod`,
`Timeline`, the rule engine, the CQRS pipeline, projections, the module registry, localization,
and the ports.

## 5. Event infrastructure verification

| Property | Verified by |
| -------- | ----------- |
| Immutable | `Object.isFrozen` on a raised event |
| Versioned | `eventVersion` required on the envelope |
| Envelope complete | Asserted field by field |
| Dispatcher abstracted | `EventDispatcher` interface; in-process adapter is one implementation |
| Transaction safety | A handler running after commit sees the committed row **on a separate connection** |
| Nothing published on failure | Rollback test asserts zero events and zero rows |

No event implementation is tied to infrastructure: the kernel's event code imports nothing.

## 6. CQRS verification

Commands, queries, handlers, validators and the pipeline exist. No business command is
implemented. Order verified by test: an unauthorized caller is refused **before** validation, so
a malformed payload from an unauthorized actor reveals nothing about the payload.

## 7. Repository verification

| Requirement | Verified against a real database |
| ----------- | -------------------------------- |
| Returns domain models, not ORM entities | The base exposes rows to subclasses only |
| No business logic | The base has no business vocabulary |
| Supports Unit of Work | Every method takes a `Transaction` |
| Supports optimistic concurrency | Stale write rejected; first writer's value intact |
| Tenant filtered | Another tenant's row not found by its exact identifier |
| Soft delete honoured | Deleted row invisible to reads, retrievable administratively |
| Audit written by infrastructure | `created_by` came from the context, not the caller |

## 8. Multi-tenant verification

Three layers, all exercised (ADR-0030):

```
tenant A → sees only tenant A's rows              ✓
tenant B → sees only tenant B's rows              ✓
no tenant set → 0 rows (fails closed)             ✓
insert for another tenant → policy violation      ✓
update / delete across tenants → 0 rows affected  ✓
```

**No repository bypasses isolation**, and no repository can: the policy is enforced by the
database beneath the application, and the application refuses to start against a connection that
could bypass it.

## 9. Audit, effective dating, soft delete, concurrency

Audit fields and timestamps are written by infrastructure; a caller cannot supply or omit them.
`Timeline` supersedes rather than rewrites and refuses to hold two periods in force at once.
There is no hard delete on the repository base. Version conflicts raise `ConcurrencyException`;
no silent overwrite path exists.

## 10. API verification

Versioned routing under `/api/v1`, Problem Details on every error path, OpenAPI published, three
distinct health endpoints. Health probes are deliberately unversioned, so an orchestrator's probe
URL survives a version bump — asserted by test in both directions.

No business endpoint is implemented.

## 11. Security verification

| Check | Result |
| ----- | ------ |
| Authentication integration point | Present; Platform supplies the implementation in Phase 2 |
| Authorization integration point | `PermissionChecker`, enforced centrally by the pipeline |
| Tenant validation | Middleware, context, RLS, and a startup guard |
| Correlation and request identifiers | Assigned, echoed, logged |
| Secure defaults | Unknown feature flag off; no tenant means no rows; startup refuses a database that cannot isolate |
| Dependency audit | `pnpm audit --audit-level high` clean; four transitive advisories pinned |
| Secrets | None in source; the environment is validated and never logged |

Log redaction is deny-by-default for authorization headers, cookies, API keys, passwords and
tokens.

## 12. Configuration and logging verification

Typed, validated, fails startup on an invalid value. `process.env` is read in exactly one
expression in the repository, enforced by lint. Structured JSON logging with request,
correlation, service and version on every line. No `console.log` in production code, enforced by
gate.

## 13. Testing verification

**208 tests**, including tenant isolation, permission, concurrency, localization and calendar
golden cases. Integration suites run against a real PostgreSQL and **refuse to skip in CI** — a
suite that quietly skips itself on the machine that gates merges reports success for a property
nobody checked.

Shared infrastructure: `InMemoryUnitOfWork` (keeps commit semantics), `FakeRepository` (keeps
tenant, version and soft-delete guarantees), `RecordingDispatcher`, permission fakes, object
mothers, and assertions that name what actually happened.

## 14. Build verification

| Gate | Result |
| ---- | ------ |
| Standards, architecture, localization, dependencies | Pass |
| Format, lint, typecheck | Pass |
| Tests (208) | Pass |
| Production build (11 packages) | Pass |
| Migration validation | Pass — applied to a fresh database |
| Dependency audit | Pass |
| Flutter analyze and test | Pass — 3.27.1 / Dart 3.6.0 |
| Flutter APK build | **Not verifiable on this machine** — no Android SDK. Verified in CI, where it failed and was fixed (see below) |

### The APK build, and what it caught

This row was the one thing above that could not be run here, and it is the one thing that was
wrong. On the first CI run the mobile job failed: *"your app is using an unsupported Gradle
project"*. The application had been committed with its Dart sources and no platform host, so
`flutter analyze` and `flutter test` passed for an application that could not be built.

The host project is now committed and checked (ADR-0031), and the CI job pins Temurin 17 so the
Gradle build does not depend on the runner image's default JDK. The lesson is recorded rather
than smoothed over: a gate that cannot run locally is not a gate that can be assumed to pass, and
this report was right to refuse to mark it green.

## 15. Performance verification

Measured on this machine, against a real database:

| Operation | Measurement |
| --------- | ----------- |
| Cold start to first response | 1657 ms |
| `GET /health/live` | 7 ms average over 20 |
| `GET /health/ready` (round trip to the database) | 7 ms average over 20 |
| `GET /health` | 7 ms average over 20 |
| Workspace typecheck | ~5 s across 11 packages |

Well inside the < 300 ms interactive budget, with no business logic in the path yet. These are a
baseline to regress against, not a result to be pleased with.

## 16. Static analysis

| Finding | Result |
| ------- | ------ |
| Unused dependencies | One found and removed (`@nestjs/terminus`) |
| Dead code / unreachable files | None |
| Circular references | None |
| Boundary violations | None |
| Large classes | Largest file 275 lines, against a 400-line budget |
| God objects | Largest class 17 members (`Money`), all cohesive value-object operations |
| Improper abstractions | None identified |
| Duplicate utilities | None — no exported name appears in two packages |

Two findings were fixed during this phase rather than recorded:

1. **`@nestjs/terminus` was declared and never used.** Removed.
2. **`@munaxa/ui` was declared and never imported.** The portals rendered plain HTML while
   depending on the design system, so the integration was unverified. They now use `Card` and
   `Button` from the platform, which makes the dependency real and proves the design system
   resolves, renders and themes in a production build.

---

## Technical debt

Stated plainly, because a register that omits the awkward entries is worse than none.

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| The tenant arrives as an HTTP header | Any caller can claim any tenant | **Phase 2**, when Platform authentication supplies it. This is the single largest open risk and the API is not production-exposed until it closes |
| `actor` is `user:anonymous` in the middleware | Audit records a placeholder | Phase 2, same change |
| No projection store | `verifyRebuild` folds in memory; nothing persists a checkpoint | Phase 20, or the first module needing a read model |
| The rule engine has no arithmetic | It decides, it does not compute | Phase 11.1, when payroll formulas need evaluation |
| `@work/contracts`, `@work/sdk`, `@work/country-packs` are empty | Placeholders | The phases that own them |
| Cache health is `not-configured` | Redis is declared but unused | Whenever the first cache consumer arrives |
| No rate limiting | An unauthenticated endpoint could be hammered | Before production exposure, Phase 24 at the latest |
| The Android release build type signs with the debug keys | A release artefact built from this repository is not distributable | Phase 19.1, the phase that ships the mobile application. Only `--debug` is built in CI (ADR-0031) |

No item above is a shortcut taken to move faster. Each is work a later phase owns.

## Risks

1. **The header-supplied tenant** must not survive into any environment reachable by a customer.
   It is a development affordance and it looks exactly like a production feature.
2. **Statutory correctness is unbuilt.** The rule engine's determinism and traceability are the
   foundation for it, and nothing above validates a real entitlement yet.
3. **The in-process adapters are honest but temporary.** Auto-approval approves. A module built
   against it must not assume approval is instant once Workflow arrives.

## Recommendations

1. Close the tenant-header debt as the first task of Phase 2, before any business data exists.
2. Keep the golden-case discipline for anything statutory: the calendar tests already agree with
   an independent implementation, and payroll deserves the same standard.
3. Run `pnpm verify` before every push. It is the whole gate set, and it is fast.

## Production readiness

**Ready for business development. Not ready for production exposure**, and nothing in the
repository implies otherwise: there is no authentication, no business functionality and no rate
limiting. The architecture is verified; the product does not exist yet.

## Acceptance criteria

✓ Every architectural verification passes
✓ No dependency violations
✓ No circular dependencies
✓ No duplicate infrastructure
✓ Build succeeds
✓ Tests succeed
✓ Documentation updated
✓ Static analysis completed
✓ Technical debt documented
✓ Production readiness assessed

**Phase 1.1 passes.** Phase 2 may begin.
