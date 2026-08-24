import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import { EmploymentPermissions, type EmploymentView } from '@work/employment';
import type { EmploymentDirectoryPort } from '@work/assets';

import type { Asking } from '../payroll/asking.js';

/**
 * The one permission this adapter ever holds inside another module.
 *
 * **Read from Employment's own export rather than typed as a literal**, and that is not fastidiousness
 * — it is a defect this repository has already shipped once. `GrantAwarePermissionChecker` matches a
 * grant by *exact string*, and `apps/api/src/relations/relations-sources.ts` permits
 * `'employment.read'` while `employment.read-employment` declares `employment.employment.read`. No
 * handler anywhere declares the former, so Relations' employment check cannot succeed through its
 * grant. Naming the constant makes the mismatch impossible here, and a test reconciles it besides.
 */
const EMPLOYMENT_READ = EmploymentPermissions.employmentRead;

/**
 * One typed dispatch, local to this adapter.
 *
 * A local helper rather than a shared export, matching `relations-sources.ts` and
 * `documents-sources.ts`: a bare `dispatcher.ask` narrows an object literal to `Query` and rejects the
 * fields the query actually carries, so each call site would need an assertion — and an assertion at
 * every call site is an assertion nobody reads.
 */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

/**
 * Whether an employment exists in this tenant — asked of Employment, through Employment's own
 * published read.
 *
 * **A boolean, and deliberately nothing more.** Assets needs to know that the employment an asset is
 * being issued to is real and this tenant's. It does not need the person's name, their status, their
 * grade or their manager, and returning any of those would make an asset register into a workforce
 * directory. Whether an *ended* employment may still be issued an asset is D-5.3-07, which is open —
 * so this adapter cannot express the difference, rather than guessing at it.
 *
 * **Another tenant's employment is `false`, indistinguishable from one that never existed.** The read
 * runs inside the caller's tenant context, so row-level security answers before this adapter does —
 * which is what stops `assets.issue-custody` being used to enumerate another organisation's workforce
 * one identifier at a time.
 */
export class AssetsEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(employmentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'assets',
        operation: 'assets.issue-custody',
        permits: [EMPLOYMENT_READ],
        reason: 'Confirming that the employment an asset is issued to exists',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
        }),
    );

    return found.ok;
  }
}
