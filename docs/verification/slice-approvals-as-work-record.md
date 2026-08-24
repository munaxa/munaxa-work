# Product Slice — Approvals as Work · implementation record

**Date** 2026-08-24 · **Baseline** `00dfe26` · **Branch** `claude/munaxa-product-readiness-audit-8mr34d`
· **Authorized** by the owner against
[`slice-approvals-as-work.md`](slice-approvals-as-work.md)

The second vertical slice. It is not a phase, it creates no numbered sequence, and it adds no backend
capability: it promotes approvals from the last two sections of a configuration screen into a
destination of their own, with an approval detail behind it.

---

## 1. What it delivers

**`/approvals`** — the caller's own work as the page's subject. A summary of three figures, the
queue of what is waiting, the list of what they answered, and a footnote naming what the screen does
not do.

**`/approvals/[instanceId]`** — one approval opened. Until this route existed the product could show
an instance only by rendering the *first* row of a listing as an example; there was no way to open
the second, and therefore no way to look at the approval somebody was actually being asked about.
It shows the chain, the branch tallies, the decisions, the timeline, and the same approval in the
approval port's own five-state vocabulary.

**Navigation** — `Approvals` is now the first destination in **Operations**, because it is the only
screen in this portal whose content is addressed to the reader personally. `/workflow` keeps every
configuration section and is relabelled **Workflow configuration** in Governance. The two queue
sections were removed from it.

---

## 2. Every rule the authorization set, and where it is kept

| Rule | How |
|---|---|
| Implement only the approved slice | Two routes, one navigation change, one section removal. Nothing else |
| Not a phase, no new phase | Recorded as slice 2 in `PHASES.md`'s slice table |
| No new table, column, migration, permission, handler, port or event | **None.** `git diff` against `packages/`, `apps/api/` and `prisma/` is empty |
| Do not wire `ApprovalPort` | `workflowApprovalPortFor` is untouched and still composed nowhere |
| No approve/reject/decision writes | Asserted: no request literal contains `/decision`, and the source contains no `POST`, `PUT`, `PATCH`, `DELETE` or `method:` |
| Do not resolve `subjectId` into business descriptions | The subject is its type and its identifier, and the screen says why |
| Do not resolve membership identifiers into names | Every membership is rendered in full, never shortened and never resolved; the screen says no module publishes such a lookup |
| No notification badge | The shell is untouched apart from the navigation map |
| No analytics, escalation, expiry or reminders | None. `expired` is asserted never to appear |
| Keep `/workflow` as configuration | It keeps definitions, versions, steps, groups, members, instances, branches, awaiting steps, port status, history and its notices |
| Move the queue to `/approvals` | `PendingSection` and `DecidedSection` no longer render on `/workflow` |
| Add `/approvals/[instanceId]` | Done, under ADR-0075's route-segment convention |
| Published contracts and existing routes only | Six reads, all existing. Every `@work/*` import is a `/contracts` subpath, asserted |
| Preserve refused ≠ empty ≠ populated | Three states, asserted in both directions at the composition layer, the section layer and the route layer |
| Server's total, never `items.length` | The fixture's totals (317, 42, 9) are deliberately larger than its pages, and the tests assert the totals reach the screen |
| Never calculate service level, due dates or tallies | No arithmetic on any published figure. The one count on the screen — how many rows on **this page** the server already called overdue — is a tally of a published word, and says so |
| `authority` and `onBehalfOfMembershipId` stay separate | Two columns, two fixture memberships, asserted to be different values and both present |
| Employee Record design language | `Page` + `PageHeader` + `Section`, summary first, design-system tables, semantic badges, `<bdi>` isolation, boundaries as a footnote, no cards for their own sake, no fake controls |
| English and Arabic/RTL | Both, verified rendered; the slice added **no module string** — Workflow's catalogue already carried every vocabulary |
| Loading and not-found | `loading.tsx` for both routes; `not-found.tsx` for the detail |
| Tests anchored to the stated findings | 50 assertions across four files |
| Complete verification gate | §5 |
| Verify the rendered product at desktop and mobile | §4 |

---

## 3. What changed, file by file

### New — `apps/admin/src/approvals/`

| File | What |
|---|---|
| `api.ts` | The six reads. Refusal and empty kept apart; the server's total carried through untouched |
| `locale.ts` | Workflow's catalogue and the portal's, merged. No new module string |
| `frame.tsx` | `Term`, `Refused`, `Clear`, `Rows`, `Identifier`, `Isolated`, `Facts` — the Employee Record's language, applied here |
| `queue.tsx` | The summary, what is waiting, what the caller decided, the boundaries footnote |
| `detail.tsx` | The summary, the chain, the branch tallies, the decisions, the boundaries footnote |
| `timeline.tsx` | The timeline and the port's own view — split from `detail.tsx` at the seam the two halves already had, before the file budget |
| `approvals.fixture.ts` | One person's work as Workflow would answer it, with totals larger than the pages |
| `api.test.ts`, `queue.test.tsx`, `detail.test.tsx`, `routes.test.tsx` | 50 assertions |

### New — routes

`app/approvals/{page,loading}.tsx` and `app/approvals/[instanceId]/{page,loading,not-found}.tsx`.

### Changed

| File | What |
|---|---|
| `shell/navigation.ts` | `approvals` added at the head of Operations; a comment records why `workflow` stays in Governance |
| `shell/navigation.test.ts` | Asserts the two destinations are distinct in both languages |
| `app/workflow/page.tsx` | The two queue sections removed; a comment records where they went and why no link is offered from here |
| `locales/{en,ar}.json` | The portal's own words for the new screens |

**No module's `domain`, `application`, `infrastructure`, `api` or `contracts` layer was touched. No
module locale file was touched. `prisma/` and `apps/api/` are untouched.**

---

## 4. The rendered product

Built, served against a fixture API shaped by the published contracts (scratchpad only, never
committed), and inspected.

| Check | Result |
|---|---|
| `/approvals`, English, 1440 px | Summary reads `317` waiting, `1` overdue, `42` decided; three queue rows; two decided rows |
| `/approvals`, Arabic, 1440 px | Mirrored; every vocabulary translated; Latin runs isolated |
| `/approvals`, 390 px | Summary stacks to one column; tables scroll inside their own bounds; the page does not |
| `/approvals/[instanceId]`, English | Chain of three steps with kinds, statuses, escalation and service level; branch tally; two decisions; timeline; port status |
| `/approvals/[instanceId]`, Arabic | Mirrored and fully translated; the delegated decision shows `بالتفويض` with `نيابة عن` and both memberships |
| Navigation | `Approvals` active in Operations; `Workflow configuration` in Governance |
| `/workflow` | Configuration intact; the two queue sections gone |

Three defects were found by looking at the rendered screens and fixed:

1. The summary's overdue cell rendered **the word "Overdue"** beside a label already reading
   "Overdue". It now renders the **count**, with the badge as emphasis on the figure.
2. The detail's decisions were headed **"Decided by you"** — the queue's wording — which would tell
   a reader that a colleague's decision was theirs. It is now "Decisions".
3. A free-text comment was **not bidi-isolated**, so `Budget confirmed.` rendered as
   `.Budget confirmed` inside the Arabic table. It is isolated like every other Latin run.

A fourth was fixed from the mobile capture: a thirty-six-character membership wrapped across four
lines in a narrow column. Identifiers now keep one line and the table scrolls, which is what the
design system's `Table` is for.

---

## 5. Gate

Run against real PostgreSQL 16 with all 32 migrations applied.

| Gate | Result |
|---|---|
| `check-standards.mjs` | pass |
| `check-architecture.mjs` | pass — 186 models |
| `check-localization.mjs` | pass — 20 catalogue sets, both languages |
| `check-dependencies.mjs` | pass — 1,926 files, no cycles, no unused dependencies, no unreachable files |
| `pnpm format:check` | pass |
| `pnpm lint` | pass — 51/51 |
| `pnpm typecheck` | pass — 51/51 |
| `pnpm test` | pass — 51/51; the Admin application's own suites are 32 files / 362 tests |
| `pnpm build` | pass — 29/29; `/approvals` and `/approvals/[instanceId]` both server-rendered on demand |
| **`pnpm verify`** | **pass, end to end** |

The registry caveat is unchanged: `@munaxa/*` is served from GitHub Packages and this session's
token is not authorized for it, so the gate ran against a source build of the public
`munaxa/munaxa-platform`. `package.json` and `pnpm-lock.yaml` are byte-identical to the commit.

---

## 6. What this slice deliberately leaves for later

Unchanged from the investigation, and none of it was needed:

1. **Deciding** — gated on the authentication decision in the audit's §19.
2. **Wiring `ApprovalPort`** — an owner decision per adopting module. Until it is taken, Recruitment
   is the only module that raises approvals, and the screen says so.
3. **Describing a subject in business terms** — requires asking the owning module per subject type.
   The first thing worth revisiting after this slice, and the most visible limitation of the queue.
4. **Resolving a membership to a person** — no module publishes a bounded lookup. The same shape of
   gap the Employee Record recorded for organizational units, and now recorded twice.
5. **A notification count in the shell** — would cost a queue read on every page of every screen.
6. **Analytics, escalation, expiry, reminders** — Phase 20 and Platform's job runner respectively.
