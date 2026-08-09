import type { Transaction } from '@work/kernel';

import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';
import type { EmploymentContractState } from '../domain/employment-contract.js';
import type { EmploymentState } from '../domain/employment.js';
import type { ReportingLineState } from '../domain/reporting-line.js';
import type { StatusRecordState } from '../domain/status-record.js';

/**
 * What the application layer needs from persistence and from the modules Employment depends on,
 * stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Declaring these in infrastructure would invert that and make a status-machine
 * test need PostgreSQL.
 *
 * Every persistence method takes the `Transaction`, so a use case cannot accidentally read outside
 * the unit of work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

/**
 * What a search may filter on.
 *
 * Every filter here is answered by an indexed column of this module's own tables. A person's
 * *name* is deliberately absent: names live in People, on a timeline, and a name filter would
 * either join across a module boundary or cache a name here — and a cached name is the second
 * answer ADR-0037 exists to remove. Callers who search by name search People and pass the person.
 */
export interface EmploymentQuery extends Paged {
  /** Matches the employment number and the customer's own number. */
  readonly term?: string;
  readonly status?: string;
  readonly personId?: string;
  readonly employmentTypeCode?: string;
  /** Employments whose assignment on `asOf` sits in this unit. */
  readonly unitId?: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  /** Employments reporting to this manager on `asOf`. */
  readonly managerEmploymentId?: string;
  /** Which date the effective-dated filters are resolved at. */
  readonly asOf: Date;
}

export interface EmploymentStore {
  byId(transaction: Transaction, id: string): Promise<EmploymentState | undefined>;
  byNumber(
    transaction: Transaction,
    employmentNumber: string,
  ): Promise<EmploymentState | undefined>;
  byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly EmploymentState[]>;
  /** Every employment of one person, newest first. Rehire history, in one read. */
  forPerson(transaction: Transaction, personId: string): Promise<readonly EmploymentState[]>;
  /**
   * The person's employment that is not ended, if they have one.
   *
   * The natural-key check behind the one-open-employment rule. The domain refuses the second one
   * with this, and the partial unique index refuses it again when two requests race — which is
   * what makes a duplicated create fail deterministically rather than merely usually.
   */
  openForPerson(transaction: Transaction, personId: string): Promise<EmploymentState | undefined>;
  search(transaction: Transaction, query: EmploymentQuery): Promise<Page<EmploymentState>>;
  all(transaction: Transaction): Promise<readonly EmploymentState[]>;
  insert(transaction: Transaction, state: EmploymentState): Promise<void>;
  update(transaction: Transaction, state: EmploymentState, expected: number): Promise<void>;
}

/** The shape every child store shares: read one, read an employment's, read many, write. */
export interface ChildStore<TState> {
  byId(transaction: Transaction, id: string): Promise<TState | undefined>;
  forEmployment(transaction: Transaction, employmentId: string): Promise<readonly TState[]>;
  forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly TState[]>;
  all(transaction: Transaction): Promise<readonly TState[]>;
  insert(transaction: Transaction, state: TState): Promise<void>;
  update(transaction: Transaction, state: TState, expected: number): Promise<void>;
}

export interface AssignmentStore extends ChildStore<EmploymentAssignmentState> {
  /**
   * How many assignments are in force against a position in a unit on a date.
   *
   * Counted in the database rather than by loading assignments, because this is what Organization
   * asks through `FilledHeadcountPort` for *every* budgeted position on an establishment screen —
   * and loading a department's assignments once per position is the shape that turns one screen
   * into a hundred queries.
   */
  countInForce(
    transaction: Transaction,
    positionId: string,
    unitId: string,
    asOf: Date,
  ): Promise<number>;
}

/** Status history is appended, never updated — so the store offers no update. */
export interface StatusRecordStore {
  forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly StatusRecordState[]>;
  forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly StatusRecordState[]>;
  insert(transaction: Transaction, state: StatusRecordState): Promise<void>;
}

/**
 * The counter employment numbers are drawn from.
 *
 * `allocate` takes the next value **and locks the row for the rest of the transaction**, so two
 * concurrent creates in the same tenant cannot receive the same number. It is deliberately not a
 * PostgreSQL sequence: a sequence is not tenant-scoped, and it is not transactional — a create
 * that rolled back would burn a number and leave a permanent gap in a customer's numbering that
 * nobody could explain.
 */
export interface NumberSequenceStore {
  allocate(transaction: Transaction, seriesKey: string): Promise<number>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface EmploymentStores {
  readonly employments: EmploymentStore;
  readonly assignments: AssignmentStore;
  readonly reportingLines: ChildStore<ReportingLineState>;
  readonly contracts: ChildStore<EmploymentContractState>;
  readonly statusHistory: StatusRecordStore;
  readonly numbers: NumberSequenceStore;
}

/**
 * What Employment needs to know about a Person, and nothing more.
 *
 * A port rather than a query, because People owns the person and this module may not read its
 * tables. The adapter asks People's published query through the shared dispatcher, so the person's
 * data is redacted by People's own permission rules on the way out — which is why this shape
 * carries **no name, no date of birth and no identifier**. Employment needs three facts: that the
 * person exists in this tenant, that they are not a merged record redirecting elsewhere, and their
 * name only when a screen asked for it.
 */
export interface EmployablePerson {
  readonly personId: string;
  readonly status: string;
  /** Set when this record was merged into another (Phase 4, AD-001). Consumers follow it. */
  readonly mergedIntoPersonId?: string;
  /** Present when the caller may read it. Absent is meaningful, never rendered as a blank. */
  readonly legalName?: Readonly<Record<string, string>>;
}

export interface PersonDirectoryPort {
  find(personId: string, asOf: Date): Promise<EmployablePerson | undefined>;
}

/**
 * Whether an organizational reference is real, in this tenant.
 *
 * Only the unit can be answered today, and the reason is worth stating rather than hiding:
 * Organization publishes no single-entity read for a position or a cost centre — `list-positions`
 * is paged and filtered, centres have no query at all — so there is nothing to ask. Employment
 * does not reach into Organization's tables to compensate, and does not add an index to
 * Organization's schema to hang a composite foreign key from. Those references are stored, and
 * row-level security is what keeps another tenant's row unreadable. The missing reads are recorded
 * as a gap against Organization's contract (ADR-0042) rather than worked around.
 */
export interface OrganizationDirectoryPort {
  unitExists(unitId: string, asOf: Date): Promise<boolean>;
}

/** The clock, injected so effective dates and audit instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
