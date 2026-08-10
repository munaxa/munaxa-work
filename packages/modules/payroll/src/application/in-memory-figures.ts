import { ConstraintViolation, paged, type Tables } from './in-memory-tables.js';
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
        for (const result of batch)
          results.set(result.payrollResultId, { ...result, finalized: false });
        return Promise.resolve();
      },
      clearRun: (_transaction, runId) => {
        for (const [id, result] of results) {
          if (result.payrollRunId !== runId) continue;
          // The immutability rule, in memory. A finalized result is never removed by a
          // recalculation; the database trigger refuses the same thing (ADR-0066).
          if (result.finalized) throw new ConstraintViolation('payroll_finalized_immutable');
          results.delete(id);
        }
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
        removeRun(earnings, runId);
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
        removeRun(deductions, runId);
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

const removeRun = <TLine extends { readonly runId: string; readonly finalized: boolean }>(
  lines: TLine[],
  runId: string,
): void => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line?.runId !== runId) continue;
    if (line.finalized) throw new ConstraintViolation('payroll_finalized_immutable');
    lines.splice(index, 1);
  }
};
