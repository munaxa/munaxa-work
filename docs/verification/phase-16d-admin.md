# Phase 16D — Checkpoint 7 — Admin UI

**Status: PARTIALLY DELIVERED — STOPPED on two requirements.**

Two of the four requirements were implementable against the published contract and are done. Two
were not, and §2 and §12 of the checkpoint say to stop and report the gap rather than reach around
it. This document delivers the first two and reports the second two.

| # | Requirement | Outcome |
|---|---|---|
| 1 | Show **when** a step was escalated | **DONE** — via the published `step-escalated` timeline event |
| 2 | Distinguish an **escalated approver** from an assigned one in the steps table | **STOPPED** — §2 contract gap |
| 3 | Expose the approved human escalation **action** | **STOPPED** — §3 and §12 gaps |
| 4 | Update the **honesty catalogue** | **DONE** |

---

## 1. What was inspected before anything was changed

- `packages/modules/workflow/src/contracts/views.ts` — every published view.
- `apps/admin/src/workflow/*` — all fourteen sections, the loader, the locale bridge.
- `packages/modules/workflow/locales/{en,ar}.json` — the whole `workflow.*` catalogue.
- A repository-wide search of `apps/admin/src` for `use server`, `<form`, `<button`, `useState`,
  `useEffect`, `action=` — **zero matches**. The Admin app has no interactive precedent anywhere,
  in any module, not only in Workflow.

---

## 2. The §2 gate — CAN the published views distinguish an escalated step? **NO.**

`WorkflowStepView` is, in full:

```
stepId · instanceId · ordinal · approverKind · approverMembershipId ·
status · sourceGroupId? · branchRule? · quorum? · condition? · serviceLevel? · version
```

There is **no escalation marker of any kind on the step view.** Checkpoint 5 made `escalated_at`
durable and Checkpoint 6 deliberately did not publish it — the API suite asserts, by scanning the
whole response body, that no shape of it reaches the wire
(`apps/api/src/workflow/workflow.escalation.spec.ts`, "publishes no escalation provenance anywhere
in the response").

So an escalated approver and an assigned approver arrive at this screen as **byte-identical row
shapes**, differing only in which person they name. The fixture is now faithful to that: the two
steps at ordinal 2 in `anInstanceDetail()` are indistinguishable except by membership identifier,
and the comment beside `anEscalatedStep()` records why there is no field to set.

### Every route to the distinction, and why each is closed

| Candidate | Status |
|---|---|
| Add `escalatedAt` to `WorkflowStepView` | **Forbidden by §2 and §12** — an API change, and this checkpoint may not modify the API. |
| Add a new endpoint | Forbidden by §2. |
| Read the database | Forbidden by §2 and §14. |
| Infer from membership identifiers | Forbidden by §2 — and impossible: the identifiers carry no structure. |
| Compare list lengths | Forbidden by §2 — and wrong: the tally denominator is snapshotted (D-16D-08) and is *supposed* to disagree with the row count. |
| Use `sourceGroupId` | Forbidden by §2 — and wrong: it means "came from an approval group", which an escalated step never does and a group-expanded step always does. |
| Use `escalatedAt` from persistence | Forbidden by §2. |
| **Join the `step-escalated` history event by `stepId`** | **Not forbidden, and still rejected — see below.** |

### Why the history join is unsafe, and not merely inelegant

This is the only derivation the checkpoint did not name, so it deserves the reasoning rather than a
citation. The Admin loads the timeline as a **bounded page**: `/instances/:id/history?page=1&size=50`
(`apps/admin/src/workflow/api.ts`; the fixed request budget is asserted in
`apps/admin/src/workflow/api.test.ts`). The escalation event is one entry in an append-only timeline
that also records every step becoming current and every decision made.

On an approval with more than fifty entries the escalation event **falls off the page that was
fetched**, and the join silently returns nothing. The row does not render as "unknown" — it renders
as an **ordinary assigned approver**, because that is what the absence of a marker means. The screen
would then tell an administrator that a person the product added is a person the workflow assigned,
and it would do so precisely on the long-running, heavily-escalated approvals where the distinction
matters most.

Raising the page size does not fix it; it moves the threshold. Fetching more pages breaks the fixed
request budget §10 requires. A distinction that is correct on short approvals and quietly wrong on
long ones is worse than no distinction, because nothing on the screen marks which regime it is in.

**The exact contract gap:** `WorkflowStepView` needs a published, non-derived escalation marker.
Nothing else closes it. The narrowest form is a boolean (`escalated: true` on steps that were added,
omitted otherwise) — which publishes *that* a step was escalated without publishing *when*, and so
does not expose `escalated_at` itself. Whether to publish it at all, and in which form, is an API
contract decision this checkpoint has no authority to make.

---

## 3. The §3 gate — CAN the screen offer the escalate action? **NO — two independent blockers.**

### 3a. There is no published pool to select an approver from

`workflow.escalate-branch` takes `{ instanceId, ordinal, approverMembershipId }`. The third field
must name a membership, and §3 requires it come from an existing published membership list or an
already-authorized Workflow view.

What this page holds is:

- the memberships **already on the approval** — every one of which the domain refuses with
  `escalation-approver-already-assigned`;
- the members of whichever **single approval group** the page happens to have loaded — a list that
  exists only if the tenant has a group, that has no relationship to the approval being escalated,
  and that on this screen is one group rather than all of them.

There is no published view answering "who could be added here". A picker built from what is on the
page would offer a set that is either guaranteed to be refused or arbitrary. §3 says to stop.

### 3b. There is no mutation architecture in this application, at all

The Admin app is server-rendered end to end. It has no server action, no form, no button, no
client component, and no route handler that writes. §13 forbids introducing jsdom, Playwright,
Cypress, testing-library or any new dependency; §14 forbids `useState`, `useEffect`, the router and
`window.` for this feature.

Building the first write path in the entire application — inside a checkpoint scoped to one
capability, without a `use client` boundary, a CSRF story, an error-surface convention, or any test
harness able to exercise an interaction — is not a Workflow decision. It is an application-wide
architectural one, and it belongs to whoever owns `apps/admin`.

The existing catalogue already tells an administrator the truth about this:
`workflow.notice.actionsAreApi` — every action on this screen is taken through the API.
`workflow.provided.escalation`, added below, now names escalation as one of them.

---

## 4. What WAS delivered — requirement 1: when a step was escalated

`WorkflowHistoryView` publishes `event`, `stepId`, `ordinal`, `occurredOn` and `actorMembershipId`,
and `HistorySection` already renders the event through `<Term group="historyEvent">`. So *when* a
branch was widened, at which ordinal, and by whom is fully available and now fully rendered.

**It was rendering as a raw key.** Checkpoint 3 added `step-escalated` as the ninth history event
and Checkpoint 6 shipped the route that produces it, but neither locale catalogue had the term.
`translator` in `apps/admin/src/workflow/locale.ts` answers a missing key **with the key itself**, so
the cell would have read `workflow.vocabulary.historyEvent.step-escalated` — legible enough to look
deliberate, and wrong in a way nobody reports. That is a live defect created by Checkpoint 6, in an
Admin file, fixed here:

| Key | English | Arabic |
|---|---|---|
| `vocabulary.historyEvent.step-escalated` | Approver added | أُضيف معتمد |

`check-localization` gates both. The wording is deliberately **"Approver added"** rather than
"Escalated": it says what happened to the branch rather than naming a mechanism, and it agrees with
the tally, which did not move.

---

## 5. What WAS delivered — requirement 4: the honesty catalogue

The page carried `workflow.withheld.escalation`, which opened **"Nothing escalates."** Checkpoint 6
made that false at product level. It was **narrowed, not deleted** — the pattern this page has used
since 16B, and the reason both directions are asserted:

- **Was:** "Nothing escalates. A step past its target is shown as past it and nothing follows…"
- **Now:** "Nothing escalates **by itself**. A step past its target is shown as past it and nothing
  follows: no reassignment after a delay, and no next approver on a timer."
- **Added, `workflow.provided.escalation`:** "An administrator can add an approver to a branch that
  is stuck, through the API. It adds somebody — nobody is replaced, removed or reassigned, and the
  approvers already asked stay asked. Nothing starts it but a person."

`escalation` stays on the withheld list, because what is withheld is real and unchanged: nothing
automatic. Both entries are asserted **together**, in one test, because the honesty of either
depends on the other standing beside it.

The word `escalat` also stays on the forbidden-heading list in `notices.test.tsx`. §16 of the
checkpoint says not to simply remove it, and it should not be removed: there is no escalation column
and — per §2 — there cannot be one, so a heading naming escalation would still be a claim about data
this screen does not have. The refusal *sentences* use the word, which is why that scan searches
`<h1>`, `<h2>`, `<th>` and `<dt>` rather than the whole page.

---

## 6. The fixtures now carry an escalated approval

`anInstanceDetail()` gained a fourth step and `aHistory()` a fourth entry, so every existing
rendering, localization and honesty test now runs against a **widened branch** rather than only
against sequential ones.

The tally at ordinal 2 is deliberately left at `assigned: 1, threshold: 1, outstanding: 1` while
**two** steps await there. That is D-16D-08 as an administrator sees it, and it is the fixture that
makes the arithmetic assertion meaningful: a screen that counted the rows it was rendering would
print two, and a fixture whose denominator followed the row count would let it pass.

Two sibling assertions in `api-payload.test.ts` selected steps **by array index**; they now select by
membership, so a step added to a fixture cannot silently re-point them at a different row.

---

## 7. Request budget — unchanged

No new request, no conditional request, no request in a loop. `apps/admin/src/workflow/api.test.ts`
still asserts the fixed budget: **5** when the tenant is empty, **10** with one row, **10** with
fifty rows, **1** when the first read fails. The escalation is rendered entirely from responses the
page already fetched.

---

## 8. No unpublished field reaches the screen

- `escalatedAt` appears **nowhere** in `apps/admin`.
- The fixture file states explicitly that there is no such field to set, so a later reader cannot
  add one to a fixture and make a screen appear to render a distinction the server never sends.
- No new endpoint, no new permission, no scheduler, no timer, no `Date.now`, no `new Date`.
- `apps/admin/src/workflow/boundary.test.ts` still passes: no Prisma, SQL, repository, UnitOfWork,
  domain, application-handler, Identity, Employment, Organization or Recruitment import.

---

## 9. Files changed

| File | Change |
|---|---|
| `packages/modules/workflow/locales/en.json` | `historyEvent.step-escalated`; narrowed `withheld.escalation`; added `provided.escalation` |
| `packages/modules/workflow/locales/ar.json` | the same three, in Arabic |
| `apps/admin/src/workflow/status.tsx` | `workflow.provided.escalation` added to `PROVIDED`; counts corrected |
| `apps/admin/src/workflow/views.fixture.ts` | an escalated step, a `step-escalated` timeline entry, two constants |
| `apps/admin/src/workflow/notices.test.tsx` | the escalation claim/refusal pair, the event term in both languages, the widened branch |
| `apps/admin/src/workflow/api-payload.test.ts` | index lookups replaced by identity lookups; counts updated |

**No production component was modified.** `history.tsx` already rendered the event; it needed a word,
not a change.

---

## 10. Gates

| Gate | Result |
|---|---|
| `pnpm standards` | no violations · 176 models · 17 catalogue sets · 1722 files |
| `@work/admin` lint | clean |
| `@work/admin` typecheck | clean |
| `@work/admin` test | **250 passed** (was 246) |

---

## 11. NOT VERIFIED

- That an administrator can escalate **from the screen**. They cannot; §3 and §12 stopped it.
- That the steps table distinguishes an escalated approver. It does not; §2 stopped it.
- Any behaviour of a real browser: this suite renders to static markup with
  `renderToStaticMarkup` and asserts on the string. No jsdom, no Playwright, no interaction.
- Arabic **rendering** beyond string presence — the catalogue is complete and the terms appear, but
  no right-to-left layout was visually inspected.

---

## 12. What is required before this checkpoint can be completed

1. **An API contract decision** on publishing an escalation marker on `WorkflowStepView` —
   whether at all, and whether as a boolean or an instant. Requirement 2 is blocked on it and on
   nothing else.
2. **A published "who may be added" view**, or an approved rule naming which existing list the
   picker draws from. Requirement 3a is blocked on it.
3. **An `apps/admin` mutation architecture decision** — the first write path in the application.
   Requirement 3b is blocked on it, and it is not Workflow's to make.
