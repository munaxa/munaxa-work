# Product Slice #8 — Assets & Custody

Two routes, no new endpoint, no new permission, no migration, and one backend change of four
re-export lines. Read-only.

---

## A. Objective

The Slice #8 investigation (`docs/verification/next-product-slice-investigation-4.md`, commit
`2b310cc`) selected Assets & Custody: seven published reads, seven permissions, ninety localized
keys in each language, eighteen module test files, and **no product surface at all**. It was also
the candidate already half-connected — the Employee Record has read
`/assets/custody/clearance?employmentId=…` since Slice #1 and renders the blockers it returns.

This slice opens the other end. A reader can now see the asset those blockers name, and everyone
who has ever held it.

---

## B. Starting state

`main` at `8e08c7b`. Assets published seven reads and the Admin portal consumed exactly one of them,
from inside the Employee Record.

| Read | Permission | Consumed before |
| --- | --- | --- |
| `GET /assets` | `assets.asset.read` | no |
| `GET /assets/:assetId` | `assets.asset.read` | no |
| `GET /assets/:assetId/custody` | `assets.custody.read` | no |
| `GET /assets/categories` | `assets.category.read` | no |
| `GET /assets/custody` | `assets.custody.read` | no |
| `GET /assets/custody/summary` | `assets.custody.read` | no |
| `GET /assets/custody/clearance` | `assets.custody.read` | **yes** — Employee Record |

The investigation's readiness figures were re-checked against source and all held.

**One correction to the investigation's route sketch.** It assumed a custody register might be a
screen. It cannot be: `GET /assets/custody` **requires an `employmentId`**, and the controller says
why — *"There is deliberately no tenant-wide custody listing, and the page size is bounded."* So
this slice has no register screen and does not assemble one from the inventory. The only
tenant-wide custody answer that exists is `custody/summary`, which is aggregate by construction: a
count and two dates, naming no asset, no custody and no employment.

---

## C. Product workflow

> See what the company owns. Open one item. Find out who has it, who had it before, and how long it
> has been out. Step from the holder to their employee record.

That is the whole slice, and every fact in it is one the module publishes.

---

## D. Routes

| Route | Why it exists |
| --- | --- |
| `/assets` | The inventory, the catalogue, and what is outstanding across the tenant. Three reads, three grants, three separable refusals |
| `/assets/[assetId]` | One asset and its custody chain. The subject is the item; the identifier in the path is what opened it |

Each carries `loading.tsx`; the detail route carries `not-found.tsx`. Both are reachable from the
sidebar (**Operations**, after Payroll — issuing a laptop and getting it back is daily work, like
attendance and leave, not a record somebody files), and the detail route is reachable from the
inventory by the asset tag.

**Routes deliberately not created.** No `/assets/custody` (§B), no `/assets/categories` screen (the
catalogue is a section, not a subject — a tenant reads it to understand the inventory beside it),
and no per-employment custody route: that answer already lives on the Employee Record and a second
copy would be two places to keep true.

---

## E. Backend consumed

Six of the seven reads, all read-only:

| Read | Where |
| --- | --- |
| `GET /assets?page=1&pageSize=50` | `/assets` — the inventory |
| `GET /assets/categories` | both routes — the catalogue, and to name an asset's type |
| `GET /assets/custody/summary` | `/assets` — what is outstanding |
| `GET /assets/:assetId` | `/assets/[assetId]` — defines the route |
| `GET /assets/:assetId/custody` | `/assets/[assetId]` — current holder and history |
| `GET /assets/custody/clearance` | unchanged, still the Employee Record's |

`GET /assets/custody` is not consumed, for the reason in §B.

**Every figure on both screens is the server's.** `total`, `openCount`, `longestDaysOutstanding`,
`daysOutstanding` and `daysHeld` are all published, all derived inside the module against an `asAt`
it echoes. Nothing subtracts two dates anywhere in this slice. There is no overdue, no due date, no
value, no cost and no depreciation, because the module records none of them — and says so, in the
customer's own words, in the boundary notes it already shipped.

---

## F. Contract exports

**The only backend change**, and it is additive:
`packages/modules/assets/src/contracts/index.ts` re-exports four types that were already defined in
`contracts/views.ts` and had no route to a consumer:

```ts
export type { AssetCustodyView, CustodyPageView, CustodySummaryView, CustodyView } from './views.js';
```

All four are needed: `AssetCustodyView` is what the detail route reads, `CustodyView` is a row,
`CustodyPageView` is the history's shape, `CustodySummaryView` is the inventory's summary. They were
written for the contracts directory, carry no handler, store or aggregate, and are what those three
reads have always returned — only the re-export was missing, so a consumer could receive them and
had no name for what it received. `@work/assets`'s own build and its 18 test files pass unchanged.

No new contract was created, nothing was promoted out of `application/`, and no domain ownership
moved. The other 42 unexported view types the investigation counted across eight further modules
were left alone.

---

## G. Permissions

Three grants reach these screens, and the slice keeps them separate rather than flattening them
into one "assets" section:

| Section | Grant |
| --- | --- |
| Outstanding summary; current holder; custody history | `assets.custody.read` |
| Registered assets; one asset | `assets.asset.read` |
| Asset catalogue; an asset's type name | `assets.category.read` |

The module separated them deliberately — *"a storekeeper who maintains the list of categories is not
necessarily a person who may enumerate every laptop in the company"* — and *"`assets.custody.read` is
separate from `assets.asset.read`… a custody row names an employment, and reading the inventory must
not imply reading who holds what."*

**Refused ≠ empty ≠ populated**, per read. Measured against a stub answering 403:

- Refused renders the sentence naming the grant. Empty renders the module's own "there is nothing"
  line. They are different strings and a test asserts they are.
- **An asset nobody holds is not an asset nobody has ever held.** `current` absent means the item is
  in nobody's custody; an empty `history` means it has never been issued. Two sections, two
  messages, and a test that they differ.
- **A refused custody read produces one withheld section, not two** — the current holder and the
  history come from a single request, and reporting one refusal twice would be reporting it twice.
- **When the catalogue is refused, an asset's type renders as its identifier**, never as a blank and
  never as an invented name.

No permission was added, broadened or bypassed. No `read-own` was declared — the module's own file
explains why an eleventh would be a grant that resolves to nothing.

---

## H. Employee Record integration

**Nothing on the Employee Record changed.** It already reads clearance and renders the blockers, and
that is the per-employment answer; duplicating it here would be a second place to keep true.

The link runs the other way. Every custody row and the current holder carry `employmentId` — the
only personal reference Assets publishes, and an employment rather than a person by AD-001 — and
each links to `/employment/[employmentId]`, an existing route reached with an identifier the module
already publishes. No new cross-module infrastructure, no lookup service, no resolver.

Assets holds no name for anybody, so the employment stays an identifier, monospaced, muted and never
shortened.

---

## I. Relations / clearance relationship

Both Assets and Relations are read by the Employee Record's governance section, which names them
together: *"The two modules that had complete backends and no screen at all until this record
existed: employee relations and asset custody."*

**This slice surfaces neither relationship as a new screen.** Clearance is documented rather than
re-rendered (§H). Relations is untouched: no read, no link, no change — it is a separate candidate
and building any of it here would be starting a slice nobody authorized.

AD-006 names offboarding clearance as the consumer that will read custody through public contracts.
Three of the four types this slice exported are the ones that consumer will use. That is recorded
here as a fact about why the export is safe, not as an offboarding capability.

---

## J. Product findings

Two defects were found by rendering the product, neither by a test.

**1. A duplicate heading.** The page `h1` was *Assets* and the inventory section's `h2` was also
*Assets* — the same word twice, one above the other. The page is the subject; the section is the
register of items inside it. Added `assets.label.registered` in both languages, so the three
sections now read *Outstanding · Registered assets · Asset catalogue*.

**2. The same refusal sentence three times.** With every read refused, all three sections said *"This
section was withheld: the API did not answer for this caller."* — which tells a reader nothing about
what they lack, on the one screen where the three grants are the point. Added
`assets.withheld.categoryRead` and `assets.withheld.custodyRead` (`assetRead` already existed), so a
fully refused page now reads:

```text
Outstanding          Reading who holds what needs a permission this caller does not hold.
Registered assets    Reading the inventory needs a permission this caller does not hold.
Asset catalogue      Reading the asset catalogue needs a permission this caller does not hold.
```

A test now asserts all three are present **and distinct from one another**.

Checked and clean: no arbitrary first row, no raw catalogue key in either language on either screen
at either width, no duplicate status information, no developer-looking presentation, no screen
without a subject, no missing navigation.

---

## K. Localization

Twenty keys added to `packages/modules/assets/locales/{en,ar}.json` — the module's catalogue, which
`check-localization.mjs` gates, rather than a second copy in the portal. **90 → 110 keys in each
language, with no key lost**, verified by diffing the key paths against `HEAD`. One more,
`admin.nav.assets`, went into the portal's own catalogue because the sidebar is a portal fact.

The boundary footnotes are composed **entirely from notes the module already shipped** —
`statusIsService`, `noValuation`, `employmentNotPerson`, `catalogueIsTenant` on the inventory;
`oneHolder`, `noTransfer`, `noAcknowledgement`, `employmentNotPerson` on the asset. Not one was
written for this slice.

An asset tag, a serial number, a purchase reference and a category code are never translated — they
are values a tenant stored. A status (`available`, `under_repair`, `retired`) and a custody state
(`open`, `returned`) are Assets' own closed vocabularies, shipped in both languages, and are.

**RTL.** An assets row is unusually dense in Latin runs even in Arabic: a tag, a serial, two civil
dates, an employment identifier and two day counts. Every one goes through `<bdi>`, and every day
count through `<bdi dir="ltr">`. A sweep test strips all `<bdi>` from the Arabic render of each
section and requires nothing Latin remains — and **the detector is itself asserted first**, because
all five sweeps passed on their first run and in three earlier slices that meant the helper was
blind rather than the markup clean.

Rendered headings, Arabic: `الأصول` / `غير مُعاد` · `الأصول المسجّلة` · `دليل الأصول` · `ما لا تفعله
هذه الشاشة`. The asset tag stays `LT-000418` as the `h1` in both languages, which is correct.

---

## L. Mobile

Chromium, both routes, both languages, both widths, against the full fixture:

| | 1440 px | 390 px |
| --- | --- | --- |
| `/assets` en | overflow 0 | overflow 0 |
| `/assets` ar | overflow 0 | overflow 0 |
| `/assets/[assetId]` en | overflow 0 | overflow 0 |
| `/assets/[assetId]` ar | overflow 0 | overflow 0 |

**No page-level horizontal scroll anywhere.** The custody table carries seven columns including a
full employment identifier; it scrolls inside its own `overflow-x-auto` container, which is the
design system's own behaviour. No identifier was shortened to avoid that scroll.

---

## M. Tests

**39 new tests in 4 files**, each protecting a property rather than a snapshot.

| File | Tests | What it protects |
| --- | ---: | --- |
| `inventory.test.tsx` | 11 | assets open by identifier and never by position; the server's total, not `items.length` (fixture: 2 rows, total 26); refused ≠ empty; one section withheld without its neighbours; three refusals distinct; category identifier when the catalogue is refused; both vocabularies translated |
| `asset.test.tsx` | 10 | absent optionals render as dashes; the in-service status never states the holder; **an absent current custody is never filled from the first row of the history**; the holder links by a published identifier; the module's day counts, never a computed one; one withheld section for one refused read |
| `rtl.test.tsx` | 12 | the isolation primitives; **the detector proves it can fail**; five sweeps requiring no bare Latin run on any Arabic section |
| `localization.test.ts` | 6 | no key whose own name contains a dot; identical key paths in both languages; no empty string; **all 61 keys these screens ask for resolve in both languages** |

No snapshot tests were added.

---

## N. Full gate

`pnpm verify` with `TURBO_FORCE=true` (no cached replay), PostgreSQL 16 live with 31 of 31
migrations applied, parity guard enforced with no override:

| Stage | Result |
| --- | --- |
| standards | 5 gates, no violations — parity all-registry at `@munaxa/platform` 1.6.1 |
| format:check | clean |
| lint | **51 successful, 51 total**, 0 cached — 1m31.853s |
| typecheck | **51 successful, 51 total**, 0 cached — 39.174s |
| test | **51 successful, 51 total**, 0 cached — 6m43.782s |
| build | **29 successful, 29 total**, 0 cached — 56.359s |
| **`pnpm verify`** | **exit 0** |

**466 test files, 5,345 tests, 0 failed, 0 skipped** — up from 462 and 5,306 on `main`, which is
exactly the 4 files and 39 tests this slice adds. Every turbo task was a cache miss. Both new routes
appear in the build output as dynamic: `ƒ /assets` and `ƒ /assets/[assetId]`.

No pre-existing failure was found, so none had to be documented or worked around, and no production
code was changed to make the gate pass.

---

## O. Security

**Read-only.** No `POST`, `PUT`, `PATCH` or `DELETE` is issued anywhere in the slice — verified by
grep over `apps/admin/src/assets`, which contains no write verb and no `method` on any fetch. The
module's three write capabilities (`custody.assign`, `custody.return`, `asset.manage`) are not
reached, and no control appears on either screen that would suggest they are.

No permission was added, broadened or bypassed. Every read goes through the module's own pipeline,
which settles authorization before a handler runs. A refusal is rendered as a refusal.

Nothing personal crosses a boundary: Assets publishes an employment identifier and nothing else about
a person, and the screens render exactly that.

---

## P. Remaining gaps

Discovered and deliberately not fixed:

- **`notFound()` returns HTTP 200 on the new detail route**, exactly as on the ten before it. The
  correct not-found page renders; the status is committed while the shell streams, before the
  page's `await` resolves. Shared infrastructure, separately tracked, and not made worse here.
- **42 unexported view types remain across eight other modules** (relations 8, workflow 2,
  compensation 13, leave 13, attendance 3, career 1, onboarding 1, recruitment 1). Only Assets' four
  were exported.
- **`GET /assets/custody` is published and unconsumed.** It needs an `employmentId`, and the answer
  it gives already appears on the Employee Record. It would be the natural read for a self-service
  or offboarding screen, neither of which exists.
- **Relations still has no screen of its own.** Untouched.
- **`assets.custody.assign` and `assets.custody.return` have no UI.** This slice is read-only by
  authorization; issuing and returning are a separate decision.

---

## Q. Git

| | |
| --- | --- |
| Branch | `claude/munaxa-product-readiness-audit-8mr34d` |
| Base | `main` at `8e08c7b` |
| Files | 15 added, 6 modified — 2,207 insertions |
| Backend change | 4 re-export lines in `packages/modules/assets/src/contracts/index.ts` |
| Status | recorded on push; **not merged** |
