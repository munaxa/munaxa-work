import { uuidV7 } from '@work/kernel';

import {
  checkedMetadata,
  checkedText,
  definedOnly,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { isImportSource, type ImportSource } from './compensation-vocabulary.js';

/**
 * What a bulk load covered, wrote, skipped and failed.
 *
 * **An import is not a back door.** Every row it produces is validated through the same domain
 * rules a manual assignment goes through — the same period checks, the same currency checks, the
 * same overlap constraint. An importer that bypassed them would be a second, weaker way to write
 * the module's most sensitive data.
 *
 * **`rowsSkipped` is the count that demonstrates idempotency** rather than merely claiming it. A
 * resubmitted file finds its rows already present through the `(source, sourceId, component,
 * employment)` unique index and reports them as skipped; a batch reporting `submitted: 100,
 * created: 0, skipped: 100` is proof the second run wrote nothing.
 *
 * **No vendor-specific importer.** A normalized row shape reaches this module; the adapter that
 * produces it from a particular file or system lives outside, exactly as a device adapter does for
 * Attendance (ADR-0057).
 *
 * The Recruitment offer is a natural first source — `recruitment_offer.proposed_compensation` is
 * opaque JSON deliberately deferred to this module — and **wiring Recruitment to it is not in this
 * phase**, because that would reopen a completed one.
 */

export interface ImportBatchState {
  readonly id: string;
  readonly tenantId: string;
  readonly source: ImportSource;
  readonly sourceLabel?: string;
  readonly submittedAt: Date;
  readonly submittedBy: string;
  readonly rowsSubmitted: number;
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface OpenImportBatch {
  readonly tenantId: string;
  readonly source: string;
  readonly sourceLabel?: string;
  readonly submittedBy: string;
  readonly rowsSubmitted: number;
  readonly metadata?: Metadata;
}

const LABEL_LIMIT = 128;

/** The page bound a batch may take. Bounded, because an import has to finish. */
export const MAX_IMPORT_ROWS = 500;

export const importBatch = (
  request: OpenImportBatch,
  submittedAt: Date,
): CompensationResult<ImportBatchState> => {
  if (!isImportSource(request.source)) {
    return refuse('import_source_unknown', { source: request.source });
  }
  if (
    !Number.isInteger(request.rowsSubmitted) ||
    request.rowsSubmitted < 0 ||
    request.rowsSubmitted > MAX_IMPORT_ROWS
  ) {
    return refuse('import_batch_too_large', { limit: String(MAX_IMPORT_ROWS) });
  }

  const label = checkedText(request.sourceLabel, 'sourceLabel', LABEL_LIMIT);

  if (!label.ok) return label;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(submittedAt.getTime()),
    tenantId: request.tenantId,
    source: request.source,
    submittedAt,
    submittedBy: request.submittedBy,
    rowsSubmitted: request.rowsSubmitted,
    rowsCreated: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    ...definedOnly({ sourceLabel: label.value }),
    metadata: metadata.value,
    version: 0,
  });
};

/** The batch's outcome, once every row has been attempted. The counts never exceed what came in. */
export const completed = (
  state: ImportBatchState,
  counts: {
    readonly rowsCreated: number;
    readonly rowsSkipped: number;
    readonly rowsFailed: number;
  },
): CompensationResult<ImportBatchState> => {
  const total = counts.rowsCreated + counts.rowsSkipped + counts.rowsFailed;

  if (total > state.rowsSubmitted) return refuse('import_counts_exceed_submitted');
  return accept({ ...state, ...counts });
};
