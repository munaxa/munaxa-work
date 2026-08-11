import type { HandlerFailure, Query, Result } from '@work/kernel';

/**
 * The one capability every Payroll adapter needs.
 *
 * Narrower than `Dispatcher` on purpose: an adapter that held the whole dispatcher could *send a
 * command*, and none of Payroll's five sources has any business writing anything. The dependency
 * points one way and Payroll pulls (ADR-0058, ADR-0064).
 *
 * In its own file so the adapters and the composition that wires them can each import it without
 * importing each other.
 */
export interface Asking {
  ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>>;
}
