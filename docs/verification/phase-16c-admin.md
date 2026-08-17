# Phase 16C — Checkpoint 9 — Admin UI

**Scope.** The existing `/workflow` server-rendered read-only workspace, shown the two things Phase
16C built: a step that routes to the requester's manager, and a service-level target. No domain, no
application, no repository, no Prisma, no migration, no API controller, no route, no permission, and
no completed-module change.

Migrations unchanged at 23. No dependency added.

---

## 1. What the screen now shows

| Where | What | Source |
| --- | --- | --- |
| Definition steps | `approverKind: manager`, and two empty approver cells | `WorkflowStepTemplateView` |
| Definition steps | The configured target, as `48 hours` | `WorkflowStepTemplateView.serviceLevel` |
| Approval steps | The resolved membership, in full, as `membership` | `WorkflowStepView` |
| Approval steps | Target, state, due instant, overdue minutes | `WorkflowStepView.serviceLevel` |
| Awaiting steps | The state alone | `WorkflowStepView.serviceLevel.state` |
| Pending queue | The state alone | `PendingApprovalView.serviceLevel.state` |

Every value is a field the API already published in Checkpoint 4 and Checkpoint 8. **No endpoint was
added, no response field was requested, and no API file was touched** — which is the outcome
Checkpoint 8's `§1` predicted when it noted every 16C read was already on the wire.

---

## 2. A manager step names nobody, and the screen says so

A manager template carries no `approverMembershipId` and no `approverGroupId`. Both cells render
empty, and a notice underneath — `workflow.notice.managerIsConfiguredNotNamed` — says that is the
configuration rather than missing data. Without it, two blank cells are indistinguishable from a
screen that failed to load an approver.

**No organizational fact reaches the table.** The manager is resolved from an employment and a
reporting line, and neither is Workflow's to know. The table is scanned for `employment`,
`reporting`, `department`, `organizational unit`, `chain` and `directory`, and carries none of them.
The scan is over the `<table>` rather than the page, deliberately: the *notice* has to be able to say
"employment" in order to explain what is not shown, and a page-wide scan would force the screen to
stop explaining itself.

---

## 3. Once it is running, it is a membership

The screen renders the resolved step exactly as the API publishes it: `approverKind: membership` and
a concrete identifier. **It does not label the row "manager".** The API says `membership`; calling it
a manager would be the screen inferring a fact from where the identifier came from, which is exactly
the guess an auditor must not find on a page.

`workflow.notice.managerIsSnapshotted` states that the resolution happened once, when the approval
started, and that the step stays where it is if the reporting line changes afterwards. There is no
"Refresh manager", no "Re-resolve", no "Update approver" and nothing to click — the notice is prose,
and the assertion that it offers no `<form>`, `<button>`, `<input>`, `<select>`, `href=` or `onclick`
is made over the rendered markup.

**Identifiers are rendered in full.** These are UUIDv7s: `MANAGER` and `DEPUTY` share their first
eight characters, and the test asserts that they do — so a screen that truncated would print the
manager and the approver beside them identically.

---

## 4. Service levels: shown, never computed

`service-level.tsx` renders four published fields and derives none of them.

- `dueOn` is **not** `awaitingOn` plus the target. The fixture's overdue step is due on the 4th of
  March while forty-eight hours after its awaiting instant is the 2nd, and the test asserts the 2nd
  appears nowhere. A screen computing the due instant would print the wrong day.
- `state` is the application's own word, worked out against a reading instant this screen never sees
  — not "is `dueOn` in the past".
- `overdueByMinutes` is printed as published: `90`, never `1.5`, never hours, never a percentage.
  It is **absent** on a step within its target rather than rendered as a zero, because "not overdue"
  and "overdue by none" are different sentences.
- The unit is shown as it was configured. `48 hours` does not become `2 days`.

**There is no progress bar and no width**, because a bar is elapsed-over-target rendered as a shape
and the division is the part that does not belong on a screen — the same rule the branch tally has
been held to since 16B.

This is asserted twice: over the markup, and over the **source with prose stripped**. The renderer is
searched for `Math.`, `toFixed`, `parseFloat`, `parseInt`, `Date.now`, `new Date`, ` / `, ` * `,
` % `, ` - `, ` + `, `width`, `progress`, `setInterval` and `setTimeout`, and contains none.

**No `expired`.** The approval vocabulary declares it and this product never produces it; the
service-level vocabulary rendered here has exactly three values. There is no countdown, no timer, no
"remaining", and no colour that changes on its own — nothing fires when a target passes, so a screen
implying otherwise would be advertising a capability three checkpoints deliberately did not build.

---

## 5. Honesty

Two notices were promoted from withheld to provided, and the withheld ones beside them were narrowed
rather than deleted:

| Key | Change |
| --- | --- |
| `provided.managerRouting` | New — a step can route to the requester's manager, resolved **once, when the approval starts** |
| `provided.serviceLevel` | New — a target is **observed rather than enforced** |
| `withheld.sla` | Removed — no longer true |
| `withheld.managerRouting` | Removed — no longer true |
| `withheld.escalation` | Narrowed — nothing happens when a step is *past its target* |
| `withheld.approvalExpiry` | Narrowed — an approval past its target *stays exactly where it is* |
| `withheld.roles` | Narrowed — adds "or the requester's manager" |
| `notice.serviceLevelIsElapsedTime` | New — elapsed time, **weekends included** |
| `notice.serviceLevelIsObserved` | New — nothing happens when it passes and nobody is reminded |

Two tests hold the pair apart. One forbids `remind`, `escalat`, `expire`, `notif`, `automatically`,
`business day` and `continuously` inside the **claims**; the other *requires* those words inside the
**denials**. Without the second, a catalogue that simply stopped mentioning reminders would pass the
first while leaving an administrator to assume the obvious.

`withheld.businessDays`, `withheld.scheduling`, `withheld.externalApprovers` and
`withheld.notificationDelivery` are unchanged and still rendered.

---

## 6. Request budget and N+1

**Unchanged, and proved at all four points:**

| Tenant | Requests |
| --- | --- |
| Empty | 5 — the three listings and the two queues, and none of the four details |
| One of everything | 10 |
| **Fifty rows in every listing** | **10** |
| First read fails | 1, and the screen reports the service as unavailable |

The fifty-row case is the N+1 assertion, and the fixtures it runs against now carry manager steps and
service levels — so a screen that looked up a manager's name, or asked how a row stood against its
target, would fail here rather than in a production trace. A further assertion scans every request
path for `manager`, `reporting`, `my-manager`, `sla`, `service-level`, `routing`, `escalation`,
`expiry`, `asOf` and `now=`, and finds none.

**No reading instant is sent.** There is no `asOf` on any request: a screen that could choose the
instant its due-ness is judged against could report any step as within its target.

---

## 7. Security boundary

The existing boundary suite covers every production file of the workspace — the listing is read from
disk rather than written down, so `service-level.tsx` was checked the moment it existed. It names no
`PrismaClient`, no repository, no `UnitOfWork`, no handler, no domain object and no SQL; it imports
only `@work/workflow/contracts`, this module's locales, `@munaxa/ui`, `@work/config` and React; and
it carries no `use client`, `useState`, `useEffect`, `useRouter`, `onClick` or `window.`.

No request names a person — not a membership, a workforce user, a platform user, a delegate or
somebody to act on behalf of. The acting membership is resolved from the authenticated request.

---

## 8. Localization

Both catalogues carry every new label, vocabulary term and notice, and `pnpm standards` reports 17
complete catalogue sets. The Arabic test asserts, for each new key, that the Arabic differs from the
key, contains Arabic script, and **appears in the rendered markup** — so a key that was translated
but never rendered fails, and one rendered but untranslated fails too.

`?lang=ar` switches language and direction together; an unknown language falls back to English and
`ltr` and renders no raw key. Identifiers and digits are left alone: a UUID is not transliterated,
and `90` does not become Arabic-Indic digits, which would mean a count went through
`toLocaleString` somewhere.

---

## 9. Files

**New (3)** — `service-level.tsx`, `routing.test.tsx`, `api.fixture.ts`, plus `api-payload.test.ts`
(split at budget).

**Changed** — `definitions.tsx`, `instances.tsx`, `branches.tsx`, `approvals.tsx`, `status.tsx`,
`views.fixture.ts`, `notices.test.tsx`, `api.test.ts`, and both Workflow locale catalogues.

`api.test.ts` reached 436 lines and was split on the seam the screen itself has — *what is asked
for* against *what is made of the answer* — with the stubbed API moved to a fixture both suites share
so neither can drift into testing a different product from the other.

---

## 10. Tests

246 in `@work/admin`, up from 224. The new suite is 19 tests across manager configuration, runtime
snapshot semantics, service-level rendering, the refusals that remain, Arabic, and the source scan.
The 16B suites — branches, tallies, groups, notices, render — pass unchanged.

---

## 11. Defects

None found in existing behaviour. Three test-authoring mistakes were caught and corrected while
writing this checkpoint's suite, each recorded because the correction is the interesting part:

1. The leak scan for `employment` matched the word inside **my own explanatory notice**. Scoping it
   to the `<table>` is right — the notice must be allowed to name what it is explaining.
2. A truncation assertion could not work, because every fixture UUIDv7 shares the prefix `01930000`.
   Replaced with an assertion that both memberships render in full *and* share their first eight
   characters, which is the property that made truncation dangerous in the first place.
3. The "promises nothing" scan matched `reminded` inside a **denial**. Split into a claims-only scan
   plus a positive assertion that the denials say those words.

A fourth was a real gap rather than a mistake: the Arabic test rendered only the definition and the
approval, neither of which carries the `serviceLevelState` header — that label lives on the queue.
The test now renders the queue too, and would have passed indefinitely while the header sat
untranslated.

---

## 12. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,708 files, no cycles |
| `pnpm format:check` | clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `pnpm prisma:validate` | valid |
| `prisma migrate status` | 23 migrations, up to date |
| `turbo run test --force --concurrency=1` | uncached, serial, 47/47, 0 failed, 0 skipped, no `.only` |

---

## 13. NOT VERIFIED

No screen displays an employment, a reporting line, a department, an organizational unit, a manager
chain, a role or any directory information, and no API publishes one to display. Automatic expiry,
escalation execution, business-day targets, reminders, notifications, role approvers, external
approvers, analytics and portals remain absent, and the status section says so in both languages.

---

**Phase 16C Checkpoint 9 is complete. Checkpoint 10 has not started.**
