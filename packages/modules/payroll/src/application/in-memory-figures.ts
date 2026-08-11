import { ConstraintViolation, paged, type Tables } from './in-memory-tables.js';
import type { PayrollResultState } from '../domain/payroll-lines.js';
import type { PayrollStores } from './payroll-ports.js';

/**
 * The stores that hold **figures**: results, lines, and the two outputs.
 *
 * Apart from the configuration and lifecycle stores because these are the ones that enforce
 * immutability. A finalized result or line cannot be removed here, exactly as the database trigger
 * refuses it (ADR-0066) — a fake more permissive than production would hide the bug the suites
 * exist to find.
 */
export const figureStores = (
  tables: Tables,
): Pick<
  PayrollStores,
  'results' | 'earnings' | 'deductions' | 'reconciliations' | 'accounting' | 'payments'
> => ({
  ...resultStores(tables),
  ...lineStores(tables),
  ...outputStores(tables),
});

const resultStores = (tables: Tables): Pick<PayrollStores, 'results'> => {
  const { results } = tables;

  return {
    results: {
      byId: (_transaction, id) => Promise.resolve(results.get(id)),
      forRun: (_transaction, runId, page) =>
        Promise.resolve(
          paged(
            [...results.values()].filter((result) => result.payrollRunId === runId),
            page,
          ),
        ),
      forEmployment: (_transaction, runId, employmentId) =>
        Promise.resolve(
          [...results.values()].filter(
            (result) => result.payrollRunId === runId && result.employmentId === employmentId,
          ),
        ),
      insertMany: (_transaction, batch) => {
        for (const result of batch) {
          // `payroll_result_unique_idx`, in memory. Without it a recalculation that forgot to
          // clear its prior rows leaves one person holding two results for one run — which is
          // exactly what happened, and what the real index would have raised 23505 for.
          const duplicate = [...results.values()].some(
            (held) =>
              held.payrollRunId === result.payrollRunId &&
              held.employmentId === result.employmentId &&
              held.currencyCode === result.currencyCode,
          );

          if (duplicate) throw new ConstraintViolation('23505');
          results.set(result.payrollResultId, { ...result, finalized: false });
        }
        return Promise.resolve();
      },
      clearRun: (_transaction, runId) => {
        removeResults(tables, (result) => result.payrollRunId === runId);
        return Promise.resolve();
      },
      clearEmployments: (_transaction, runId, employmentIds) => {
        const named = new Set(employmentIds);

        removeResults(
          tables,
          (result) => result.payrollRunId === runId && named.has(result.employmentId),
        );
        return Promise.resolve();
      },
    },
  };
};

const lineStores = (tables: Tables): Pick<PayrollStores, 'earnings' | 'deductions'> => {
  const { earnings, deductions } = tables;

  return {
    earnings: {
      forResult: (_transaction, resultId) =>
        Promise.resolve(
          earnings.filter((held) => held.resultId === resultId).map((held) => held.line),
        ),
      insertMany: (_transaction, runId, lines) => {
        earnings.push(...lines.map((line) => ({ ...line, runId, finalized: false })));
        return Promise.resolve();
      },
      clearRun: (_transaction, runId) => {
        removeLines(earnings, (line) => line.runId === runId);
        return Promise.resolve();
      },
      clearEmployments: (_transaction, runId, employmentIds) => {
        removeLines(earnings, held(runId, employmentIds));
        return Promise.resolve();
      },
    },

    deductions: {
      forResult: (_transaction, resultId) =>
        Promise.resolve(
          deductions.filter((held) => held.resultId === resultId).map((held) => held.line),
        ),
      insertMany: (_transaction, runId, lines) => {
        deductions.push(...lines.map((line) => ({ ...line, runId, finalized: false })));
        return Promise.resolve();
      },
      clearRun: (_transaction, runId) => {
        removeLines(deductions, (line) => line.runId === runId);
        return Promise.resolve();
      },
      clearEmployments: (_transaction, runId, employmentIds) => {
        removeLines(deductions, held(runId, employmentIds));
        return Promise.resolve();
      },
    },
  };
};

const outputStores = (
  tables: Tables,
): Pick<PayrollStores, 'reconciliations' | 'accounting' | 'payments'> => {
  const { reconciliations, accounting, payments } = tables;

  return {
    reconciliations: {
      forRun: (_transaction, runId) =>
        Promise.resolve(reconciliations.filter((held) => held.payrollRunId === runId)),
      insertMany: (_transaction, records) => {
        reconciliations.push(...records);
        return Promise.resolve();
      },
    },

    accounting: {
      forRun: (_transaction, runId, page) =>
        Promise.resolve(
          paged(
            accounting.filter((line) => line.payrollRunId === runId),
            page,
          ),
        ),
      insertMany: (_transaction, lines) => {
        accounting.push(...lines);
        return Promise.resolve();
      },
    },

    payments: {
      forRun: (_transaction, runId, page) =>
        Promise.resolve(
          paged(
            payments.filter((instruction) => instruction.payrollRunId === runId),
            page,
          ),
        ),
      insertMany: (_transaction, instructions) => {
        payments.push(...instructions);
        return Promise.resolve();
      },
    },
  };
};

interface HeldLine {
  readonly runId: string;
  readonly finalized: boolean;
  readonly line: { readonly employmentId?: string };
}

/** Matches the lines a named set of employments produced in one run. */
const held =
  (runId: string, employmentIds: readonly string[]) =>
  (candidate: HeldLine): boolean => {
    const named = new Set(employmentIds);

    return candidate.runId === runId && named.has(candidate.line.employmentId ?? '');
  };

const removeLines = <TLine extends { readonly finalized: boolean }>(
  lines: TLine[],
  matches: (line: TLine) => boolean,
): void => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line === undefined || !matches(line)) continue;
    // The immutability rule, in memory. A finalized line is never removed by a recalculation;
    // the database trigger refuses the same thing (ADR-0066).
    if (line.finalized) throw new ConstraintViolation('payroll_finalized_immutable');
    lines.splice(index, 1);
  }
};

type HeldResult = PayrollResultState & { readonly finalized: boolean };

const removeResults = (tables: Tables, matches: (result: HeldResult) => boolean): void => {
  for (const [id, result] of tables.results) {
    if (!matches(result)) continue;
    if (result.finalized) throw new ConstraintViolation('payroll_finalized_immutable');
    tables.results.delete(id);
  }
};
