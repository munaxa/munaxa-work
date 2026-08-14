# Release notes

Newest first. Each entry states what changed, what it means for somebody operating the product,
and what is still missing.

---

## Phase 15 — Career, succession and development

One module. It records the ladders a company defines, who is on one, the benches it keeps for its
key posts, what people have been judged ready for, what they agreed to do, and where somebody
suggested they move next.

**It recommends and executes nothing.** Marking a suggested move as accepted means a human agreed
with it. Nobody is promoted, transferred, reassigned or paid differently as a result — those are
other parts of the product, done deliberately by somebody, and this module would not know whether it
happened. There is no setting that changes this and no path through which it could.

**Nobody is scored.** No readiness percentage, no nine-box, no high-potential rating is calculated
anywhere. A named person states that somebody is ready or is not, writes down why, and their name
stays on it. No rule for computing that was ever specified, and a rule invented here would decide
who gets put forward for a director's post.

**A decision and an observation are kept apart.** Putting somebody in a high-potential pool is a
standing decision the organization took and revisits deliberately. A performance placement is what
one review cycle observed. Neither is copied into the other, because the copy is the answer that
goes stale and the stale answer is the one somebody acts on.

**An assessment cannot be edited or deleted.** A correction is a new assessment recorded beside the
old one, and the record shows the most recent statement rather than an average of the two. Somebody
reading a "not ready" a year later can see who said it, when, and what they said before.

**Succession data is treated as the sensitive material it is.** A list of named successors for a
post is something a colleague can be harmed by, and that colleague is not in the room. Asking for a
bench you are not allowed to see answers *not found* rather than *forbidden* — confirming that a
bench exists for a named post is already most of the disclosure. Nominating somebody and recording
that the organization agrees are separate permissions; so are creating a talent pool and putting a
named person into it.

**Every day is a day.** A target date, a review date and an expiry are the same calendar day
wherever the product is opened, and the screens say which day they answered for — so nothing ever
says "due" or "expired" without saying relative to when.

### Measured

Twenty-six workloads at 500, 10,000 and 100,000 employees, each with a second company's data in the
same database. All within budget: the slowest read at 100,000 employees is 15 ms against a 100 ms
budget, and counting the bench for forty posts at once did not get slower as the company grew.

### What is still missing

- **Nobody can see their own career plan.** The product cannot yet tell which employee a signed-in
  person is, so "my career" and a manager's view of their team are not built. Naming an employee in
  a URL is a filter, never a way in.
- **A development plan is not jointly signed.** An administrator records that the employee
  acknowledged it and that the manager did, with the day and who recorded it. Those are records, not
  signatures.
- **Nothing happens on a schedule.** A succession review coming due and a suggested move running out
  of time are worked out when somebody asks, against the day they asked. Nothing fires and nobody is
  notified.
- **No notification is delivered.** This module composes no notification at all.
- **No critical-position list, and no high-potential list drawn from performance.** Neither is
  half-built: the first needs a company's positions to be marked critical somewhere, and the second
  needs a bounded way to ask performance for a page of people. Career answers from the benches and
  pools it holds itself.
- **The 70-20-10 development mix is counted, not judged.** The three categories are shown with their
  counts; no balance rule was ever specified, so the verdict reads `NOT VERIFIED` rather than a
  number somebody would trust.
- **No document is stored, served or linked.** A readiness assessment cites no evidence file.

### Tests

2,660, up from 2,180.

---

## Phase 14A — Learning and development

One module. It records what somebody was asked to do, what they sat, what an assessor observed, and
what they hold.

**It evaluates nobody.** Finishing a course is evidence of what somebody was taught, not a judgement
about how they do their job — those are Performance's record and a different question. Learning
writes no capability, no rating and no status anywhere outside itself; other modules pull a
completion or a certification when they want one.

**Nothing expires on a timer, because nothing here runs on one.** Whether a certificate is still
valid and whether a requirement is overdue are worked out from the dates and the day you asked,
every time you ask. No background job maintains a flag, so there is no flag to go stale — a forklift
licence that lapsed in March cannot read `valid` in June. Every screen and every response says which
day it answered for, so nothing ever says "expiring soon" without saying soon relative to what.

**Recurring training is generated when somebody runs it.** Annual safety training does not appear
overnight: an administrator generates the next round, one page of the workforce at a time, and the
command says whether more remain. Running it twice creates nothing the second time, and two people
running it at once produce one set of requirements rather than two. If the system cannot work out
who a rule applies to, it refuses — it does not report that everybody is up to date about an
organization it never looked at.

**A mark is kept exactly as the assessor wrote it.** `18.50` stays `18.50` on the screen, in the
record and in an export. Nothing in the product calculates with a mark, so nothing rounds one.

**No overall score is calculated from assessments**, and none is displayed. The product records each
outcome an assessor stated. It does not average them, weight them or turn them into a pass mark,
because no rule for doing so was ever specified — and a rule invented here would decide who passes
mandatory safety training.

### Measured

Twenty-five workloads at 500, 10,000 and 100,000 employees, each with a second company's data in the
same database. All within budget: the compliance queue answers in 22 ms and the expiring-certificate
queue in 12 ms at 100,000 employees.

### What is still missing

- **Nobody can see their own training record.** The product cannot yet tell which employee a
  signed-in person is, so "my learning" and a manager's view of their team are not built. Naming an
  employee in a URL is refused rather than honoured.
- **No training sessions, seats, capacity or waiting lists.** That is the next increment, and none
  of it is half-built.
- **No notification is delivered.** The intent to notify is recorded; nothing sends it.
- **No course material or certificate file is stored, served or linked.** A document reference is
  confirmed to exist and nothing more.
- **The certificate that replaced an earlier one is not shown.** A superseded certificate says it
  was superseded; the link to its replacement is not carried by the read.

### Tests

2,180, up from 2,014.

---

## Phase 13 — Performance, competencies and goals

One module. It says what somebody was rated, what that rating was measured against, and why — for as
long as the record has to answer for itself.

**A rating that still means the same thing in three years.** Completing a review freezes the scale it
was measured on, the levels, the template, the component weights, the working behind every number and
where the work happened. Retire the scale next year, re-tune the weights, move the person to a
different manager in a different unit: the review reads exactly as it did on the day. That is not a
display convenience — a performance rating is used in pay, promotion and dismissal decisions, and one
that changes retroactively is one nobody can defend.

**Nothing is a decimal.** A rating of 3.70 is stored, computed and transmitted as the integer 370;
40% is 4000 basis points. The engine works in arbitrary-precision integers and rounds once,
explicitly. A goal's observed measurement — a count of transactions, of parts — travels as a decimal
string from the database to the browser, because a count above nine quadrillion is not a number
JavaScript can hold, and a measurement that quietly lost its last digit is a measurement nobody can
falsify.

**Work nobody assessed is not work rated zero.** A competency section never filled in leaves the
calculation with its reason recorded — missing, incomplete, cancelled or not applicable — rather than
dragging somebody to the bottom of the scale for something nobody looked at. The working is kept, so
a rating can be explained rather than merely reproduced.

**Calibration adds a number; it never replaces one.** A moderated rating carries both the engine's
figure and the panel's, with a mandatory reason and a named human, and the database refuses an update
that would change the original. Running the calibration meeting and signing the reviews off are
separate permissions, so whoever chaired the meeting cannot finalize its outcomes unreviewed.

**Self and peer assessments are recorded, readable, and count for nothing.** No weighting for either
was ever approved, so none was invented — and no screen or API field implies otherwise.

**Confidential, and we do not say anonymous.** Every 360° response is an attributed row: the table
records who wrote it and the request is correlated. Below the configured minimum the panel's average
is withheld — that withholds a number, it does not make anybody anonymous. Telling an employee their
feedback was anonymous when it is not is a claim this architecture cannot make, and the product says
so in English and Arabic.

### For somebody operating it

Twenty-three tables, forty-nine endpoints and one Admin workspace in both languages. Measured at 500,
10,000 and 100,000 employees per tenant against a second tenant of the same size, as an unprivileged
database role with row-level security on: every read is within budget, the manager's queue answers in
13 ms at the largest size, and a full reconciliation of a hundred-thousand-person cycle takes seven
seconds.

Two of those measurements missed their budget first and were fixed rather than re-budgeted:
reconciliation was comparing every review against every goal (10.3 s → 0.5 s), and the cycle's goal
list was sorting three hundred thousand rows to return fifty (670 ms → 37 ms, one index added after
the measurement rather than before it).

### Still missing

Stated here as well as in the report, because a release note that omits them is worse than none:

- **A manager cannot open their own queue.** Nothing in this product can yet establish which
  employment a signed-in person *is*, so a caller claiming to be a manager cannot be checked. Rather
  than trust the claim, the product returns nothing and says why.
- Nobody is notified of anything. The intent to notify is recorded; no transport exists.
- Nothing happens on a schedule. A cycle opens and closes because somebody opened or closed it.
- A goal can cite an evidence document, but no file can be uploaded, downloaded or linked — no
  storage exists anywhere in the product.
- Objectives and key results have tables and nothing else. No screen mentions them.
- No one-to-ones, no improvement plans, no career paths, no succession.

### Tests

1,842 across the repository, none skipped, including twenty-three tables proven isolated in both
directions against real PostgreSQL as a role holding no `BYPASSRLS`.

---

## Phase 12 — Employee documents and letters

Two modules. Documents says what evidence exists about somebody and who has looked at it. Letters
says what this employer stated about somebody, and freezes it.

**A document register that records who looked.** Every document has a stable identity and a history
of versions that are written once and never rewritten — replacing a file adds a version and stamps
the previous one superseded. Verification attaches to a *version*, so replacing the file returns the
document to "pending verification": nobody has looked at the new bytes. Every read is recorded, not
only every download, because "who has been looking at this employee's file" is the question the
trail exists to answer and recording only downloads would leave a hole in it. Refused attempts are
recorded too — somebody trying repeatedly to reach a document they may not see is exactly what an
audit is for. The trail is a queryable table rather than a log, because an unqueryable one cannot
answer a subject access request.

**Confidential means invisible, not greyed out.** A colleague who may see that an employee exists
does not see their medical certificate, and does not learn that one was withheld: the count agrees
with the rows, because "this employee has three documents you may not see" is itself the disclosure.
Asking for one directly answers "not found" rather than "forbidden", for the same reason. Seeing
that a document exists, seeing a confidential one, and obtaining the file are three separate
permissions.

**One answer to when a passport expires.** Where a document evidences an identity document the
People module already holds, the expiry lives there and this module stores no copy. The screen shows
People's date and says so. Two stored dates are two things that can disagree.

**Letters a customer writes, not letters this product ships.** An employment certificate, a salary
certificate, an experience letter and an embassy letter are all templates a tenant authors in both
languages. A template's variables are declared names looked up in a map — there is no expression
language and no way for template text to reach code, which is what makes a tenant-authored template
safe to run against another employee's salary. A variable that cannot be resolved fails the letter
rather than rendering a blank: a bank letter stating that an employee earns nothing, over the
employer's name, is worse than no letter.

**An issued letter never changes.** What it said is frozen when it is issued — the template version,
every substituted value, and which revision of each source they came from. A salary certificate
issued in March still reads March's salary after April's raise. A correction issues a *new* letter
that supersedes the original, because somebody may be holding a printed copy of it. A third party
can confirm a reference is genuine and current without learning the employee's name, employer,
salary or purpose.

**A letter that states pay needs two permissions**, not one: the template must be allowed to expose
salary and the person issuing it must be allowed to see one. Otherwise a letter becomes a way to
read a salary the caller could not read directly.

### Known limitations

Stated here as well as in the report, because a release note that omits them is worse than none:

- **No file is stored, uploaded or downloaded.** There is no object storage in this product yet.
  Documents records what a file *is* — its name, size, declared type and checksum — and the
  reference to wherever it lives; asking for the file answers that the capability is unavailable
  rather than returning a link. Content inspection, malware scanning and checksum verification are
  absent for the same reason: all three require reading bytes nobody here holds.
- **No PDF is produced.** A letter has content and no file. There is no renderer in this product.
- **Nothing is signed.** A letter may record that a signature is required; nothing claims one
  happened, because there is no signing provider.
- **No notice is sent when a document is about to expire.** The thresholds are configured and the
  expiring queue is a screen somebody opens. Nothing scheduled runs in this product yet, and a
  reminder nobody receives is worse than none promised.
- **Employees cannot see their own documents or request their own letters.** The permissions exist;
  the routing from a signed-in person to their employment does not, in any module.
- **Third-party letter verification needs an account.** The check itself discloses almost nothing
  and works correctly; the anonymous route in front of it does not exist, because every read in this
  product resolves a tenant first.
- **Missing-mandatory-document detection is not built.** Deferred deliberately rather than
  half-built.

### Tests

1,647, up from 1,447. Two schema defects were found by tests before release and fixed: one trigger
refused a change the design required, and another permitted one it should not have.

---

## Phase 11 — Payroll

Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period. This is the third of those, and the last module in the
chain.

**A payslip you can still explain eight months later.** Every run records, per employment, exactly
what it read: the employment facts, the compensation components, the attendance answer and the
leave answer, with a digest of each. The figure is then a pure function of that record. By the time
somebody disputes a payslip the sources have all moved; the snapshot has not, and replaying it
reproduces the stored figure exactly. Every earning and deduction line carries its own arithmetic —
the basis, the fraction, the rounding — so a person who disputes a figure can be shown how it was
reached rather than told the system computed it.

**Finalized means finalized.** Approving a payroll and finalizing one are separate permissions, and
neither can be exercised by whoever requested the run — the domain refuses it and a database
constraint refuses it again. Once finalized, the figures are frozen at the table: a trigger rejects
any update or delete of a frozen row, from any path, including SQL nobody wrote in the application.
A wrong finalized run is corrected by a reversal that creates new state and leaves the original
intact. Nothing edits history.

**It notices when it has gone wrong.** After a run is calculated, reconciliation asks every source
whether it has moved — a pull, not a subscription. A lost event therefore cannot leave a payroll
quietly wrong: the next reconciliation finds the difference by digest, marks the run stale, and a
stale run cannot be approved or finalized until it is recalculated. Recalculation is narrow: only
the employments that actually went stale are recomputed, and it replaces their figures rather than
adding a second set.

**Nobody is silently skipped.** An employment the run could not calculate becomes a named exception
with a reason — missing compensation, an unknown leave state, an unreachable dependency, a broken
eligibility rule — never a result of zero and never an omission. A misconfigured eligibility rule
blocks finalization rather than quietly producing a smaller payroll. If Organization cannot be
reached, the run is refused outright: calculating a workforce under no statutory rules because a
dependency blinked would be silently wrong.

**Money that survives the whole path.** Amounts are integer minor units in a `bigint` carrying their
own currency exponent, and cross every boundary — including HTTP — as exact decimal strings. A
salary of 9,007,199,254,740,993 minor units is carried through the API, the application, the
repository, the column and back unchanged; a JSON number would have quietly returned
9,007,199,254,740,992. Nothing is totalled across currencies, because there is no exchange rate in
this product.

**Built for a real workforce.** A hundred-thousand-employee run is about two hundred bounded
transactions rather than one, driven by repeated calls rather than a request that holds a connection
open for the duration. A crash resumes from a committed cursor instead of restarting. Measured
against real PostgreSQL as an unprivileged role with row-level security on, at 500, 10,000 and
100,000 employees — every figure, including the ones that missed their target first time, is in the
verification report.

**Not built, and said plainly.** No approved overtime: Attendance publishes *candidate* minutes by
design, a candidate is not an approved fact, and Payroll will not promote one. No tax, no social
security, no GOSI, no end-of-service, and no country pack of any kind. No WPS, Mudad or Muqeem. No
journal posting — the accounting output is balanced lines against opaque tenant codes, prepared in
Payroll's own table and posted nowhere. No payment execution — the instruction carries an amount, a
date and a method code, no account identifier of any kind, and the status `prepared` and nothing
beyond it. No currency conversion. No payslip document: Payroll owns the data, and rendering,
storage and delivery have no owner yet. No benefits, no loans, no workflow routing, no
notifications. Each is absent rather than stubbed, and where a classification is reserved for one, a
test asserts it has no producer.

---

## Phase 10 — Compensation Management

Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period.

**Money that is exact, and stays exact.** Every amount is stored as integer minor units in a
`bigint`, alongside its currency code *and its currency's number of decimal places*. Two decimals is
a habit rather than a rule — the Kuwaiti dinar, the Bahraini dinar and the Omani rial all have three
— and a system that assumed two would be wrong by a factor of ten in three of this product's
markets. Amounts cross every boundary as decimal strings; there is no path on which one becomes a
JavaScript number, and a test proves a figure above nine quadrillion minor units survives a database
round trip unchanged.

**Configured, not shipped.** No basic salary, no housing allowance, no transport allowance, no
minimum wage, no tax treatment and no statutory progression. Components, plans, grades, scales and
steps are all things a tenant or a country pack defines. A new tenant sees empty tables, and the
screen says so.

**A hierarchy nobody is forced into.** Structures, grades, scales and steps are each optional and
none implies another; a forty-person company assigns a bare amount and configures none of it. Where
a grade *is* named, it constrains the amount and never supplies one — a system that filled in a
midpoint would be deciding somebody's salary.

**History you can rely on.** A change closes the previous period and opens a new one; no historical
value is ever rewritten. An amount taken from a salary step is copied onto the assignment, so
revising the step next year cannot restate what last year's payroll was run against. Both time axes
are recorded — when a change took effect, and when the system learned about it — which is what makes
a back-dated raise distinguishable from one everybody always knew about. Two administrators
assigning the same allowance concurrently race in the database rather than both succeeding.

**Decisions made by people.** Approving a salary change is a separate permission from making one,
and self-approval is refused by the domain, by the permission separation and by a database
constraint. A wrong decision is corrected by a reversal that stays in the record, never by an edit.
A plan requiring no approval produces no decision row at all, and the chain says so rather than
naming a system approver.

**The contract Payroll will read.** One query resolves a page of five hundred employments over a
period in a single statement, publishing amounts per currency, a payroll-treatment code it never
interprets, and flags saying a component *may* be prorated and a period *is* partial. It publishes
no gross, no net, no tax and no conversion, and nothing sums across currencies. Payroll will find
retroactive corrections by asking rather than by being told.

**Not built, and said plainly.** No payroll. No deductions of any kind — statutory deductions belong
to Payroll and loan recovery to a later phase, and half of one here would have created a second
owner. No tax, social security, pension or end-of-service. No benefits administration. No currency
conversion. No country pack, so no statutory behaviour is exercised anywhere. No employee or manager
self-service.

---

## Phase 9 — Leave & Absence Management

Leave explains authorized absence. Attendance records what happened. Payroll decides what it costs.

**Configured, not shipped.** No leave type, entitlement figure, accrual formula or eligibility
threshold ships with the product. A tenant configures leave types and versioned policies, and a
country pack supplies statutory content through stated extension points — an eligibility
`RuleDefinition`, service bands as data, a Hijri leave year, a gender restriction as a code.

**A balance you can audit.** Every figure is a sum of append-only ledger rows. The stored balance is
a projection with a digest, reconciled by asking rather than by being told, and a second query
re-derives the same number from the ledger independently. A cancellation writes a reversal; nothing
is ever deleted. Every duration is integer minutes.

**Requests, decided by people.** A per-date breakdown makes duration unambiguous and is exactly what
Attendance reads. Approval is recorded against a named human taken from the authenticated context;
self-approval is refused by the domain, by the permission separation and by a database constraint.
A policy requiring no approval produces no decision row at all, and the screen says so rather than
naming a system approver. Overlapping leave is refused by the database, including two overlapping
hourly requests on one date.

**Attendance and Leave, agreeing.** Leave counts working days by asking Attendance's new
`attendance.expected-working-days` read rather than duplicating the schedule engine. Attendance
learns of a leave change by asking Leave on its own reconciliation run — Leave never writes an
Attendance row. An attendance day moves from an unexplained absence to leave applied end to end, and
when Leave cannot be asked the day says the question is open rather than asserting somebody was
absent without leave.

**Not built, and said plainly.** No employee or manager self-service. No scheduled execution of
accrual, leave-year closure or carry-over expiry — those are operator commands, because nothing in
this product runs on a timer. No document verification. No notification delivery. No cross-midnight
hourly leave.

## Phase 8 — Attendance

**2026-08-11** · [Verification report](verification/phase-8-report.md)

When people actually worked. Thirteen tables, thirty-two endpoints, and four decisions worth reading
even if nothing else here is.

### A punch is never rewritten

What a reader captured stays exactly as it was captured. There is no way to edit a punch and no way
to delete one — not a restricted way, no way at all: the table has no update path and the code has no
method that could.

Corrections still happen, constantly. Somebody forgot to clock out; a reader was offline; two devices
recorded one arrival. So a correction *adds*: a new punch that supersedes the old one, or, where a
punch should not count, a correction record that says so and takes it out of the sum. Both are still
on the screen afterwards — the original time, who asked for the change, why, and who approved it.
Nobody can approve their own correction, and that holds even for somebody who was granted both
permissions, because the database refuses it too.

### The system asks what needs recalculating, rather than waiting to be told

Change a rota in June and May's days are affected. This product's internal events are delivered
at-most-once with nothing that replays a lost one, so an attendance figure that waited for an event
would sometimes wait forever — and a stale figure looks exactly like a correct one.

Instead, every change that affects a day *marks* that day, in the same breath as the change itself.
Recalculation takes what is marked and is safe to run as often as you like. And **the number of days
still waiting is on the dashboard**, because it is the number that reveals a problem, and a number
somebody can see is a number somebody notices growing.

The same idea protects the punch clocks: send the same punch twice and the second is a success naming
the first, not an error and not a duplicate. A turnstile with a flaky uplink retries; so does a phone
flushing a queue after a tunnel; so does a re-run of yesterday's import file. All of them land once.

### Two in the morning is not yesterday

A punch at 02:00 in Riyadh is 23:00 the previous day in UTC. Filing it under the UTC date puts it on
somebody else's shift and in the wrong pay period, and no arithmetic afterwards fixes it.

So a schedule carries the time zone its hours are written in, and it is required — there is no
default and no guess. Night shifts end on the following morning rather than 24 hours later. The
Sunday the clocks go forward is 23 hours long, and nobody is marked an hour absent for it.

### Nothing here decides what your time is worth

Overtime is reported in minutes and labelled a *candidate*. There is no rate anywhere in this module,
no multiplier and no amount, because what an hour is worth depends on a contract and a jurisdiction —
neither of which is a question about when somebody arrived.

Nothing statutory ships either: no grace period, no rounding, no late tolerance, no overtime
threshold. Every one of them starts at zero until a customer configures it, because in several of
this product's markets those numbers are written in law and belong to a country pack.

When a month is closed, the figures are frozen. A correction afterwards produces the *next* version
rather than editing the one payroll already read, so what was paid and what is now true are both
still answerable.

### "We can't tell" is a real answer

There is no leave module yet. A scheduled day nobody worked could be approved leave or could be an
unexplained absence, and this product has nowhere to look.

So it says so. The day reads *absent, leave cannot yet be checked* — not *absent without leave*,
which would be an assertion on somebody's record that nothing supports. The adapter that answers
"nobody can be asked" is the one actually wired in, and there is a test that says so.

### What is not here

No device or biometric integration is verified. A reader reaches this module through an adapter that
speaks the same normalized command a web client does, and no vendor's SDK is imported anywhere. **No
raw biometric data is stored** — not a fingerprint, not a face template, not a hash of one.

No work locations, no sites and no geofences. A punch can carry coordinates where a customer enables
capture, and that is evidence, not a verified place of work: this product has no location model to
check a coordinate against, and inventing one inside an attendance module would be worse than the
gap. There is no location trail anywhere, and coordinates appear on no list screen and in no export.

No employee or manager self-service, and no mobile app. The administration screen is read-only, like
every other module's, and there is no punch button on it.

No notifications and no documents, for the same reason the earlier phases have none.

Public holidays are recorded as rota entries. A real holiday calendar is country data this product
does not yet hold, and two owners of "is the 23rd a holiday" would give two answers.

---

## Phase 7 — Onboarding

**2026-08-10** · [Verification report](verification/phase-7-report.md)

The induction, from the day somebody is hired to the day they are working. Six tables, twenty-five
endpoints, and one decision about reliability that is worth reading even if nothing else here is.

### An onboarding is never started by an event alone

The obvious design is that hiring raises an event and onboarding listens for it. This product's event
delivery is in-process and at-most-once with nothing that replays a lost one — so that design's
failure is a joiner arriving on their first day with no induction and no record that one was expected.

So the way an onboarding begins is a command that is safe to send twice. Send it again and you get
back the onboarding that already exists, not a second one and not an error. Two requests arriving at
the same instant converge on one, because the database — not the application — decides.

And because a command nobody sends starts nothing, there is a list: **the employments that have no
onboarding**. It is on the screen, and there is an endpoint that starts one for each of them. Running
it twice creates nothing twice. That list is the guarantee; an event is only ever a shortcut to it.

### Onboarding holds no employment facts

There is no employment status here, no unit, no position, no manager and no employee number — and no
plan to add them. Completing an induction does not make somebody an employee, and cancelling one does
not end anybody's employment. The person and the employment are created by hiring; this module could
not create either if it tried, because the database would refuse the row.

### A published checklist never changes

An administrator improving next quarter's plan drafts a new version of it. The published one stays
exactly as it was, and every onboarding generated from it keeps the list it was actually given. A year
later, "what were we asking of joiners last March" has one answer.

Nothing is shipped: no plan, no task, no reason code. What a joiner is asked to do is the customer's
decision, and in several of this product's markets part of it is written in law.

### What is not here

No document upload. A document task records a *reference* and says which document it wants; no part of
this product stores a file yet, and the report marks that **not verified** rather than implying
otherwise. No notifications are delivered, for the same reason recruitment's are not. No approvals
routing — an approval task records a decision by the person who made it, and Phase 16 will route it
without changing the task.

No employee self-service screens. The data an employee's own task list needs is published and tested;
what is missing is the step that turns a signed-in user into their employment, and building a route
without it would be a route that can close somebody else's task.

Deadlines are calendar days. Which days a customer's week-end falls on is country data this product
does not yet hold.

---

## Phase 6 — Recruitment

**2026-08-09** · [Verification report](verification/phase-6-report.md)

Hiring, from the authority to hire to the day somebody becomes an employee. Eleven tables, thirty-six
endpoints, and one decision that changes how modules talk to each other.

### A candidate is not a person, and applying does not create one

Somebody who applies and is never contacted leaves this product no national identifier, no date of
birth and no nationality — not because a rule forbids reading them, but because there is nowhere to
put them. A Person appears at hire, once, through the module built to protect that data.

The corollary is a control a recruiter cannot skip: two candidate records cannot resolve to one human
being, and a create that finds the address already known refuses rather than quietly overwriting the
record it found.

### Recruiters no longer need permission to edit the person register

Hiring creates a Person and an Employment. Until now, a module reaching another inherited its
permission check — which would have made every recruiter hold `people.person.manage`.

Instead, the *module* holds the narrow permission for the duration of one operation, under a grant
that is explicit about what it permits, cannot nest, keeps the acting human's name on every audit
column, and is written to the log every time it is used. A recruiter holds recruitment permissions
only, and `recruitment.hire` is held by fewest people.

### Approving a requisition is a real decision by a named person

Nothing here auto-approves. A requisition records who approved it and when, approving is a separate
permission from raising the request, and a decision is never edited — undoing one writes a new record
naming the one it reverses. Once hiring has started against a requisition, its approval can no longer
be unmade.

### A hire that stops half way is visible

Creating the person, creating the employment and closing the application happen in different modules
and cannot be one transaction. So each step commits what it achieved, the application carries how far
the hire got, and running the hire again continues from there rather than creating a second person or
a second employment.

An unfinished hire is one filter away — `?unfinishedHire=true` — rather than something a customer
discovers. An application never reads *hired* without an employment behind it.

### What is not here

No candidate portal and no public careers pages: every action in this phase is taken by a recruiter.
No CV parsing, scoring or ranking. No background checks, visas or work permits. No onboarding. No
document storage — a résumé or an offer letter is a reference into the document store.

Candidate and interviewer notifications are not delivered either, and the report says so rather than
claiming email works: the notification contract addresses a workforce user, and a candidate is not one.

---

## Phase 5 — Employment

**2026-08-09** · [Verification report](verification/phase-5-report.md)

The workforce. Six tables, sixteen endpoints, and the record every later part of this product will
read before it does anything: *is this person employed, where do they sit, and who do they report
to*.

### A person is permanent; a job is not

Somebody is hired, leaves after three years, and comes back. That is **one person and two
employments**, with two employment numbers and one continuous identity — not a re-created person, and
not an edited old record. Their original hire date travels to the new employment, so the service
their entitlements are measured from is not silently reset to zero.

The product refuses to give one person two employments at the same time. Retry a create that already
succeeded and it fails, by name, rather than quietly producing a second job for one human being.

### The employment number is ours, and it is never reused

`EMP-2026-000123` is generated here — a caller cannot supply one, and no number is ever issued twice,
even after somebody leaves. That is what stops an archived payslip, a bank file and a government
submission resolving to the wrong person years later.

**Your own numbers still travel.** A migration brings its legacy employee numbers in a separate
field, indexed and searchable, without either number pretending to be the other.

### Where somebody worked in March is still where they worked in March

A transfer does not edit a record. It closes the period that was in force and opens a new one, so
the org chart, the department and the manager are all answerable **as at a date** — this year and
last. `GET /api/v1/employments/{id}?asOf=2026-03-01` answers with March's placement and March's
manager, after both have changed twice.

Back-dating works properly. Recording a March transfer for somebody who also moved in June leaves
three periods, in order, with June intact — not a March record that swallowed the summer.

### A manager is a job, not a name

Reporting lines point at an *employment*. When a manager changes roles or leaves, "who did this
person report to last year" still answers correctly, because the answer was never their name.

### Ending is deliberate, and separately permitted

Ending an employment needs a date and a reason, is terminal, and is guarded by its own permission —
somebody who can suspend a colleague cannot dismiss them. The reason is a code you define:
resignation, dismissal, end of contract and retirement mean different things in different countries,
and this product commits to none of them.

**This is not offboarding.** Exit interviews, clearance, asset return and final settlement are a
later phase. What Employment owns is the relationship and its final state, which is what a
settlement will read.

### Vacancies are real numbers now

Establishment screens have reported `filled: 0` and `vacant = budgeted` since Phase 3, because
nothing had ever been assigned. Assignments now feed that figure. **Expect vacancy numbers to change
the day this ships** — they are becoming correct rather than changing.

### What Employment deliberately does not hold

- **Leave status.** Somebody on annual leave is employed. Leave belongs to the Leave phase, and two
  places holding it would give two answers.
- **Work location.** A department and a place of work are different things, and this product does not
  yet model the second. The field is absent and the screen says so, rather than a unit standing in
  for a site.
- **Salary, attendance, documents, disciplinary records.** Each has an owner, and none of them is
  this one.

### Still missing

Nothing here can be used in a browser yet: every endpoint returns 401 until Platform's authentication
adapter lands, which has been the position since Phase 2. The administration screen reads; every
change goes through the API. Bulk import is bounded at 2,000 rows and is resumable but not atomic.

---

## Phase 4 — People master registry

**2026-08-06** · [Verification report](verification/phase-4-report.md)

The register of who somebody is. Thirteen tables, twenty-nine endpoints, and the first personal
data this product has ever held.

### One person, once

A Person is created once and stays one Person through everything a career does to them — hired,
promoted, made a manager, gone for four years, back again. Every workforce module from here on
references that record; it references none of them.

**Why the product refuses to let you create somebody twice.** A second record for one human being
is not untidy data. It splits their service period, so an end-of-service gratuity computes on four
years instead of eleven; it splits their leave balance and their loan repayments; and it registers
one national identifier twice with a social insurance authority. Every one of those looks like a
correct number on the page it appears on.

So creating a person runs a duplicate check first, and refuses with the candidates rather than
writing. If they really are different people — two brothers, the same name, the same birthday — you
say so and it creates both, and queues the pair for somebody to look at. **Nothing is ever merged
automatically.**

The check finds `أحمد` and `احمد`, and `1234-5678-90` and `1234 5678 90`. One name typed on two
keyboards is one name; one document written three ways is one document.

### Names have a history

A person's legal name changes — marriage, naturalisation, a court correction — and this product
keeps every one of them with the date it took effect. `GET /api/v1/people/{id}?asOf=2026-03-01`
answers with the name that was in force then.

**Operators should know:** that is not a reporting nicety. A settlement letter, a visa application
and a government submission are all documents about a *date*, and a register that overwrote the name
would put the wrong person on all three. Recording a change back-dated in front of a later one
splits the history rather than discarding the later change.

### Personal data, and what protects it

This is the first release holding national identifiers, dates of birth, home addresses, emergency
contacts and notes about people. Six things protect them, and all six are enforced rather than
promised — see [ADR-0038](adr/0038-personal-data-protection.md):

- **Seeing a person and seeing their date of birth are different permissions.** Without the second
  you still get the person; the field is simply absent, and the response says so.
- **Seeing that somebody holds a passport and seeing the number are different permissions.** Without
  the second you get `••••7890`, which is enough to confirm you have the right document and not
  enough to be the document.
- **Every time somebody is shown a full identifier value, it is recorded** — who, whose, and what
  kind. Never the number.
- **The duplicate check never reads a number.** It compares a keyed digest, so the index that makes
  it fast holds nothing worth stealing.
- **No event, refusal or export carries a value.** An export deliberately omits identifiers, notes,
  addresses and dates of birth: a file on a laptop is the one copy this product cannot protect.
- **Nothing is deleted.** Records are withdrawn or superseded; a merge redirects. A note is never
  amendable and never deletable — an editable note evidences nothing.

**Operators must set `PII_MATCH_SECRET`.** It is the key the duplicate-match digests are derived
with. A development default ships so a checkout runs, and **startup refuses it when
`NODE_ENV=production`**, because a shipped default is the same key in every deployment. Generate at
least 32 random characters, store it with your other secrets, and do not rotate it casually —
rotating it invalidates every stored match digest, so the duplicate check stops finding existing
records until they are re-recorded.

### What is not here

No employment, no assignment, no unit, no position, no manager, no salary, no attendance. Those are
Phase 5 and later, and they reference this register rather than living in it.

Erasure is not implemented: this release cannot satisfy a right-to-erasure request, and resolving
that against "historical identity information is never destroyed" is a governance decision recorded
for Phase 21. The disclosure record is a structured log rather than a queryable ledger, so "who read
this person's passport this year" is not yet a question the product answers.

---

## Phase 3 — Organization

**2026-08-06** · [Verification report](verification/phase-3-report.md)

The enterprise's structure, and the closure of the tenant-settings limitation Phase 2 shipped
with.

### Every customer gets its own language and calendar

Before this release a deployment had one default language, one calendar, one time zone and one
invitation validity, shared by every tenant in it — so a hosting arrangement containing a Riyadh
customer and an Amman customer had to pick one of them.

Tenants now configure themselves, through `PUT /api/v1/organization/tenant-settings`. A tenant
that has configured nothing behaves exactly as it did before, falling back to the deployment's
values, so nothing changes until somebody chooses to change it.

**Operators should know:** the `DEFAULT_LOCALE`, `DEFAULT_CALENDAR`, `DEFAULT_TIME_ZONE`,
`DEFAULT_NUMERALS`, `INVITATION_VALIDITY_DAYS` and `DEFAULT_PORTALS` variables are unchanged and
still required — they are now the *fallback* for an unconfigured tenant rather than the answer
for every tenant.

### Organization

Eleven tables, thirty-three endpoints, and the structure beneath them:

- **Units of any depth.** The levels of the hierarchy — company, branch, department, or whatever
  a customer calls them — are the tenant's own data rather than a fixed ladder in the schema. A
  retail group with company / region / store defines those three and nothing else; a franchise
  nesting twelve deep simply does. The nine levels the specification names are offered as a
  starting set from `GET /organization/standard-unit-types`, and nothing installs them.
- **Reorganizations that keep their history.** Moving a department records a new period rather
  than overwriting the old one, so "which division was this under last March" keeps its answer
  forever. Every structure endpoint takes `?asOf=` and defaults it to now.
- **Legal entities, each with its country.** A tenant may operate in several countries at once,
  and an employment will resolve its statutory rules from its legal entity rather than from the
  tenant — which is what makes end of service, social insurance and wage protection correct for a
  group operating across borders. `GET /organization/units/{id}/governing-legal-entity` answers
  which one governs a unit on a date.
- **Cost and profit centres**, as reference data finance recognizes. No budgets: financial
  ownership stays with the finance system this product integrates with.
- **A position catalogue** of reusable roles, holding no people, and an **establishment** of
  budgeted headcount per position per unit, effective dated and separately approved.
- **Organizational calendars** — the working week and the dates that are exceptions to it. This
  product knows no country's holidays; they are data a tenant or a country pack loads.
- **Import and export** of a whole structure. Import applies every rule an administrator would
  meet one unit at a time, and can be re-run after a correction without duplicating anything.

### Administration screens

The admin portal gains an organization section: the org chart as at any date, the levels defined,
the legal entities and their countries, and the tenant's settings. Bilingual and bidirectional —
`?lang=ar` switches language and direction together.

**Operators should know:** the portal reads through the API, which returns 401 until Platform's
authentication adapter is supplied. Until then the screens render their empty states, which is
the expected condition rather than a fault.

### Configuration

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `WORK_API_URL` | `http://127.0.0.1:3000` | Where the portals reach the API |

---

## Phase 2 — Workforce Identity

**2026-08-05** · [Verification report](verification/phase-2-report.md)

The first business module, and the closure of the security risk Phase 1.1 named as the largest
one open.

### The tenant no longer comes from a header

Before this release the API believed an `x-tenant-id` header, which meant any caller could act as
any tenant, and every audit row recorded `user:anonymous`. Both are gone.

A request's tenant is now resolved from a **tenant membership** — a row this product wrote when a
tenant admitted a person — keyed on the principal Platform authenticated. A caller may still say
*which* of their tenants they mean, using `x-munaxa-tenant`, because people genuinely belong to
several; naming one they are not an active member of resolves to nothing, and nothing means the
request runs with no tenant and every tenant-scoped operation refuses.

**Operators should know:** the API now returns 401 to every business endpoint until Platform's
authentication adapter is supplied. This repository contains no authentication implementation and
will not acquire one. Health probes are unaffected.

### Workforce Identity

Eight aggregates, an API, and the persistence beneath them:

- **Workforce user** — one per Platform account, spanning every tenant that person belongs to.
- **Tenant membership** — admission, suspension, reinstatement, departure and rejoining.
- **Invitations** — issued, withdrawn, accepted or lapsed. They carry no token: the invited
  person signs into Platform first, and accepts as an authenticated principal whose address must
  match the one invited.
- **Portal access** — which of the employee, manager and admin applications a tenant has opened
  to a member. Business configuration, not permission.
- **Employment links** — the jobs a member holds, several at once, with exactly one marked as
  their main job. Detaching a job never removes the person.
- **Delegation** — who acts for whom, for a stated period and scope. Recorded now; Workflow
  consumes it from Phase 16.
- **Business profile** — the member's name and title in both first-class languages. A profile
  missing one is refused by the domain *and* by the database.
- **User preferences** — language, calendar, time zone and numerals, seeded from the tenant's
  defaults and changed by the member themselves.

### Configuration

New environment variables, all with defaults, all applying deployment-wide until Phase 3 can
store them per tenant:

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `DEFAULT_NUMERALS` | `western` | Western or Arabic-Indic digits |
| `INVITATION_VALIDITY_DAYS` | `14` | How long an invitation stays open |
| `DEFAULT_PORTALS` | `employee` | Which portals open when somebody joins |

`DEFAULT_LOCALE`, `DEFAULT_CALENDAR` and `DEFAULT_TIME_ZONE` already existed and now have a
consumer.

### Migration

One forward-only migration adds eight tables, each with row-level security enabled and forced by
the same migration that creates it. It also installs `app_uuid_v7()`, so rows written by a script
or a data fix carry time-ordered identifiers like the ones the application mints.

There is no data to migrate: this is the first business module.

### Known limitations

Stated here as well as in the report, because a release note that omits them is worse than none:

- Tenant settings are deployment-wide, not per tenant. Phase 3 owns that.
- Nothing sweeps elapsed invitations or delegations yet, so an invitation past its expiry still
  reads `pending`. Behaviour is already correct — acceptance refuses it, and delegation is
  computed from its period — but the register looks stale.
- No bulk import or export. Deferred deliberately rather than half-built: a bulk path that
  bypassed the application service would bypass the invariants with it.
- The portal screens are not built. The API, contracts and translations they need are complete.
- The authenticated request path has never run outside a test, because there is no authentication
  adapter to run it with.

### Tests

379, up from 208, including tenant isolation proven per entity against a real PostgreSQL.

---

## Phases 0, 1 and 1.1 — Foundation

**2026-08-05** · [Verification report](verification/phase-1.1-report.md)

Engineering standards enforced by tooling, the pnpm/turbo workspace, the NestJS API, both
portals, the Flutter application with its Android host, the shared kernel, and tenant isolation
enforced by PostgreSQL row-level security. No business functionality.
