import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { CaseEventState } from '../domain/case-event.js';
import type { DisciplinaryActionState } from '../domain/disciplinary-action.js';
import type { DisciplinaryRuleState } from '../domain/disciplinary-ladder.js';
import type { InvestigationRecord } from '../domain/investigation.js';
import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';

/**
 * The persistence and the one outside fact this module needs, as interfaces the domain never sees.
 *
 * **Two stores are narrower than the third, and that is the AD-003 guarantee expressed where a
 * developer meets it first.** `ViolationStore` and `AccessEventStore` offer inserts and reads and
 * **no update, no remove** — there is no method that could rewrite a disciplinary record or its
 * access trail. The database refuses it too, with a trigger; this is the same rule stated twice, in
 * the two places somebody might try.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound. **There is no unbounded violation query in this module** — and none that spans
 * employments, because a query returning every disciplinary matter in a tenant is a report nobody
 * approved.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface ViolationCategoryStore {
  byId(transaction: Transaction, id: string): Promise<ViolationCategoryState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<ViolationCategoryState | undefined>;
  /** Ordered by `(sequence, code)` — deterministic without requiring a unique sequence. */
  all(
    transaction: Transaction,
    includeInactive: boolean,
  ): Promise<readonly ViolationCategoryState[]>;
  insert(transaction: Transaction, state: ViolationCategoryState): Promise<void>;
  update(transaction: Transaction, state: ViolationCategoryState, expected: number): Promise<void>;
}

/**
 * Reads and one insert. **No update and no remove, by construction** — see the note above.
 *
 * `forEmployment` is the only collection read, and it takes an employment: this module publishes no
 * way to list a tenant's violations at large.
 */
export interface ViolationStore {
  byId(transaction: Transaction, id: string): Promise<ViolationRecord | undefined>;
  /**
   * One employment's violations of one category, for the repeat-window derivation.
   *
   * **Bounded by the window at the database**, not read wholesale and filtered in memory: an
   * employment with ten years of history should not be loaded to answer a question about six months
   * of it. The domain filters again over what comes back, so a query that widened by accident would
   * not silently widen the count.
   */
  inCategoryWindow(
    transaction: Transaction,
    employmentId: string,
    violationCategoryId: string,
    window: { readonly from: string; readonly to: string },
  ): Promise<readonly ViolationRecord[]>;
  forEmployment(
    transaction: Transaction,
    employmentId: string,
    paged: Paged,
  ): Promise<Page<ViolationRecord>>;
  insert(transaction: Transaction, state: ViolationRecord): Promise<void>;
}

/** Insert only. An access trail with an update method is an access trail somebody can edit. */
export interface AccessEventStore {
  insert(transaction: Transaction, state: AccessEventState): Promise<void>;
}

/**
 * Investigations. Reads, an insert, and an update that only an *open* row can survive.
 *
 * `update` exists — unlike on the two stores above — because an open investigation is a draft its
 * investigator is still writing. It cannot touch a concluded one: the trigger refuses that from any
 * path, and the `expected` version guards the ordinary lost-update race in between.
 *
 * `openFor` is how a caller learns there is already an inquiry in progress. It is **not** what makes
 * "one open investigation per violation" true — the partial unique index is, because a read that
 * precedes an insert decides nothing under concurrency (ADR-0071). This read exists so the common
 * case is a business refusal rather than a database exception.
 */
export interface InvestigationStore {
  byId(transaction: Transaction, id: string): Promise<InvestigationRecord | undefined>;
  openFor(transaction: Transaction, violationId: string): Promise<InvestigationRecord | undefined>;
  /**
   * Every investigation on a violation, newest first — the chain an operative conclusion is derived
   * from. Unpaged like the case history and bounded by the same nature: a violation has as many
   * inquiries as it has had, which is a handful.
   */
  chainFor(transaction: Transaction, violationId: string): Promise<readonly InvestigationRecord[]>;
  forViolation(
    transaction: Transaction,
    violationId: string,
    paged: Paged,
  ): Promise<Page<InvestigationRecord>>;
  insert(transaction: Transaction, state: InvestigationRecord): Promise<void>;
  update(transaction: Transaction, state: InvestigationRecord, expected: number): Promise<void>;
}

/**
 * The case history. Reads and one insert — **no update and no remove**, like the access trail.
 *
 * `forViolation` is unbounded by page on purpose, and bounded by nature: it returns the transitions
 * of a single case, which is a handful of rows, and paginating a history would make deriving the
 * current state from it a paginated question.
 */
export interface CaseEventStore {
  forViolation(transaction: Transaction, violationId: string): Promise<readonly CaseEventState[]>;
  insert(transaction: Transaction, state: CaseEventState): Promise<void>;
}

/**
 * The ladder. Ordinary configuration: read, insert, update — no immutability, because a tenant may
 * change its policy, and an action already issued keeps its own frozen copy of what the rule said.
 */
export interface DisciplinaryRuleStore {
  byId(transaction: Transaction, id: string): Promise<DisciplinaryRuleState | undefined>;
  /** Every rule for one category, active first — what the evaluation reads. */
  forCategory(
    transaction: Transaction,
    violationCategoryId: string,
    includeInactive: boolean,
  ): Promise<readonly DisciplinaryRuleState[]>;
  insert(transaction: Transaction, state: DisciplinaryRuleState): Promise<void>;
  update(transaction: Transaction, state: DisciplinaryRuleState, expected: number): Promise<void>;
}

/**
 * Issued actions. **Reads and one insert — no update and no remove**, like the violation and the
 * case history, and for the same reason: somebody may be dismissed on the strength of one.
 */
export interface DisciplinaryActionStore {
  byId(transaction: Transaction, id: string): Promise<DisciplinaryActionState | undefined>;
  forViolation(
    transaction: Transaction,
    violationId: string,
  ): Promise<DisciplinaryActionState | undefined>;
  insert(transaction: Transaction, state: DisciplinaryActionState): Promise<void>;
}

export interface RelationsStores {
  readonly categories: ViolationCategoryStore;
  readonly violations: ViolationStore;
  readonly access: AccessEventStore;
  readonly investigations: InvestigationStore;
  readonly caseEvents: CaseEventStore;
  readonly disciplinaryRules: DisciplinaryRuleStore;
  readonly disciplinaryActions: DisciplinaryActionStore;
}

/**
 * Whether an employment exists in this tenant — the module's **only** cross-module dependency.
 *
 * A boolean, and deliberately nothing more. Relations needs to know that the employment a violation
 * is filed against is real and this tenant's; it does not need the person's name, their manager,
 * their grade or their status, and a port that returned any of those would be a directory this
 * domain has no business holding. Employment answers through its own published read, reached under a
 * bounded service grant (ADR-0043).
 */
export interface EmploymentDirectoryPort {
  exists(employmentId: string): Promise<boolean>;
}

/**
 * Whether the membership named as an investigator may act in this tenant.
 *
 * **A second boolean, for the same reason as the first.** An investigator is assigned by the person
 * opening the inquiry, so the identifier arrives on the command — and an identifier a command
 * supplies is an identifier a command can invent. Without this, a tenant could accumulate
 * investigations attributed to memberships that never existed or left last year, and nothing would
 * notice until a tribunal asked who conducted the inquiry.
 *
 * **No new query and no new permission.** Identity already publishes `identity.membership-standing`
 * — one identifier in, one predicate out — precisely so a consumer needing this fact does not receive
 * a member's whole page. It is reached under a bounded service grant (ADR-0043), exactly as Workflow
 * reaches it for escalation. Relations learns whether the membership may act and nothing else: not a
 * name, not a role, not an employment.
 *
 * A membership in another tenant answers `false`, indistinguishable from one that never existed.
 */
export interface MembershipDirectoryPort {
  canAct(membershipId: string): Promise<boolean>;
}

/** The clock, as a port, so a test can hold time still without stubbing the platform. */
export interface Clock {
  now(): Date;
}
