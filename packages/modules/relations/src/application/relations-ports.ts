import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
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

export interface RelationsStores {
  readonly categories: ViolationCategoryStore;
  readonly violations: ViolationStore;
  readonly access: AccessEventStore;
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

/** The clock, as a port, so a test can hold time still without stubbing the platform. */
export interface Clock {
  now(): Date;
}
