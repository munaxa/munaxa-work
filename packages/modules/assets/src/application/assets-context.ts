import { err, rejected, type HandlerFailure, type Result } from '@work/kernel';

import type { AssetsRejection } from '../domain/assets-rejection.js';

/**
 * The small translations every handler here needs: a domain rejection into a pipeline failure, and a
 * missing record into the one answer that does not leak.
 *
 * They live in one place because both are the kind of thing written correctly nine times and wrongly
 * once — and the wrong one is a business refusal returned as a server error, or an identifier that
 * can be probed.
 *
 * **There is no `currentActor()` here, and its absence is deliberate rather than an oversight.**
 * Checkpoint 1 stores no actor column of its own: who registered an asset and who last amended it are
 * `created_by` and `updated_by`, which `@work/persistence` writes from the execution context on every
 * insert and update. A second copy in a business column would be the same fact stored twice, and the
 * two would eventually disagree. The actor a command could supply is the one thing no command may
 * supply, and the way to guarantee that is to have nowhere to put it.
 */

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request was
 * understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: AssetsRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found — for a record in another tenant as much as for one that never existed.
 *
 * **`not_found` rather than `forbidden`, deliberately.** An identifier must not be usable as a probe:
 * a caller who guesses one learns exactly what a caller who invents one learns. Row-level security
 * makes another tenant's asset arrive here as absent, so the two answers are the same by construction
 * rather than by a branch somebody remembered to write.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
