import {
  emptyTables,
  digestsOf,
  ConstraintViolation,
  paged,
  type Tables,
} from './in-memory-tables.js';
import { figureStores } from './in-memory-figures.js';
import type { Transaction } from '@work/kernel';

import type { PayrollStores } from './payroll-ports.js';

/**
 * In-memory stores, for the suites that test **behaviour** rather than persistence.
 *
 * They implement the same interfaces the PostgreSQL repositories do, so a use case cannot tell them
 * apart — which is the point: the lifecycle, the arithmetic and the authorization are exercised
 * with no database present, and the integration suites then prove the same behaviour survives real
 * SQL, real constraints and real RLS.
 *
 * **Two rules are enforced here as well as in the database**, because a fake that is more permissive
 * than production hides exactly the bugs these suites exist to find: a finalized row cannot be
 * updated or removed, and a period that overlaps an existing one for the same group is refused with
 * the same SQLSTATE the exclusion constraint raises.
 */

export const inMemoryPayrollStores = (): PayrollStores => {
  const tables = emptyTables();

  return {
    ...configurationStores(tables),
    ...periodStores(tables),
    ...executionStores(tables),
    ...recordStores(tables),
    ...decisionStores(tables),
    ...figureStores(tables),
  };
};

const configurationStores = (
  tables: Tables,
): Pick<PayrollStores, 'groups' | 'deductionDefinitions'> => {
  const { groups, definitions } = tables;

  return {
    groups: {
      byId: (_transaction: Transaction, id) => Promise.resolve(groups.get(id)),
      byCode: (_transaction, code) =>
        Promise.resolve([...groups.values()].find((group) => group.code === code)),
      all: () => Promise.resolve([...groups.values()]),
      insert: (_transaction, state) => {
        groups.set(state.payrollGroupId, state);
        return Promise.resolve();
      },
      update: (_transaction, state, expected) => {
        const held = groups.get(state.payrollGroupId);

        if (held !== undefined && held.version !== expected) {
          throw new ConstraintViolation('concurrent_modification');
        }
        groups.set(state.payrollGroupId, state);
        return Promise.resolve();
      },
    },

    deductionDefinitions: {
      byId: (_transaction, id) => Promise.resolve(definitions.get(id)),
      forGroup: (_transaction, groupId) =>
        Promise.resolve(
          [...definitions.values()].filter((state) => state.payrollGroupId === groupId),
        ),
      insert: (_transaction, state) => {
        definitions.set(state.deductionDefinitionId, state);
        return Promise.resolve();
      },
      update: (_transaction, state) => {
        definitions.set(state.deductionDefinitionId, state);
        return Promise.resolve();
      },
    },
  };
};

const periodStores = (tables: Tables): Pick<PayrollStores, 'periods' | 'dashboard'> => {
  const { groups, periods, runs, exceptions } = tables;

  return {
    periods: {
      byId: (_transaction, id) => Promise.resolve(periods.get(id)),
      forGroup: (_transaction, groupId) =>
        Promise.resolve([...periods.values()].filter((state) => state.payrollGroupId === groupId)),
      page: (_transaction, page) => Promise.resolve(paged([...periods.values()], page)),
      insert: (_transaction, state) => {
        // The exclusion constraint, in memory. A fake that permitted an overlap would hide the one
        // race this table exists to settle.
        const clash = [...periods.values()].some(
          (held) =>
            held.payrollGroupId === state.payrollGroupId &&
            held.periodStart <= state.periodEnd &&
            state.periodStart <= held.periodEnd,
        );

        if (clash) throw new ConstraintViolation('23P01');
        periods.set(state.payrollPeriodId, state);
        return Promise.resolve();
      },
      update: (_transaction, state, expected) => {
        const held = periods.get(state.payrollPeriodId);

        if (held !== undefined && held.version !== expected) {
          throw new ConstraintViolation('concurrent_modification');
        }
        periods.set(state.payrollPeriodId, state);
        return Promise.resolve();
      },
    },

    dashboard: {
      counts: () =>
        Promise.resolve({
          openPeriods: [...periods.values()].filter((period) => period.status === 'open').length,
          runsAwaitingApproval: [...runs.values()].filter((run) => run.status === 'calculated')
            .length,
          staleRuns: [...runs.values()].filter((run) => run.status === 'stale').length,
          unresolvedExceptions: exceptions.filter((held) => held.resolvedAt === undefined).length,
          finalizedThisMonth: [...runs.values()].filter((run) => run.status === 'finalized').length,
          groupsConfigured: groups.size,
        }),
    },
  };
};

const executionStores = (tables: Tables): Pick<PayrollStores, 'runs'> => {
  const { runs, results, earnings, deductions } = tables;

  return {
    runs: {
      byId: (_transaction, id) => Promise.resolve(runs.get(id)),
      forPeriod: (_transaction, periodId) =>
        Promise.resolve([...runs.values()].filter((run) => run.payrollPeriodId === periodId)),
      page: (_transaction, page) => Promise.resolve(paged([...runs.values()], page)),
      insert: (_transaction, state) => {
        runs.set(state.payrollRunId, state);
        return Promise.resolve();
      },
      update: (_transaction, state, expected) => {
        const held = runs.get(state.payrollRunId);

        if (held !== undefined && held.version !== expected) {
          throw new ConstraintViolation('concurrent_modification');
        }
        runs.set(state.payrollRunId, state);
        return Promise.resolve();
      },
      finalize: (_transaction, runId) => {
        for (const [id, result] of results) {
          if (result.payrollRunId === runId) results.set(id, { ...result, finalized: true });
        }
        for (const line of earnings) if (line.runId === runId) line.finalized = true;
        for (const line of deductions) if (line.runId === runId) line.finalized = true;
        return Promise.resolve();
      },
    },
  };
};

const recordStores = (tables: Tables): Pick<PayrollStores, 'snapshots' | 'exceptions'> => {
  const { snapshots, exceptions } = tables;

  return {
    snapshots: {
      forRun: (_transaction, runId) =>
        Promise.resolve([...snapshots.values()].filter((held) => held.runId === runId)),
      forEmployment: (_transaction, runId, employmentId) =>
        Promise.resolve(snapshots.get(`${runId}:${employmentId}`)),
      digestsFor: (_transaction, runId) =>
        Promise.resolve(
          new Map(
            [...snapshots.values()]
              .filter((held) => held.runId === runId)
              .map((held) => [held.employmentId, digestsOf(held)]),
          ),
        ),
      insertMany: (_transaction, runId, batch) => {
        for (const snapshot of batch) {
          snapshots.set(`${runId}:${snapshot.employmentId}`, { ...snapshot, runId });
        }
        return Promise.resolve();
      },
    },

    exceptions: {
      forRun: (_transaction, runId) =>
        Promise.resolve(exceptions.filter((held) => held.payrollRunId === runId)),
      insertMany: (_transaction, batch) => {
        exceptions.push(...batch);
        return Promise.resolve();
      },
      clearRun: (_transaction, runId) => {
        for (let index = exceptions.length - 1; index >= 0; index -= 1) {
          if (exceptions[index]?.payrollRunId === runId) exceptions.splice(index, 1);
        }
        return Promise.resolve();
      },
    },
  };
};

const decisionStores = (tables: Tables): Pick<PayrollStores, 'adjustments' | 'decisions'> => {
  const { adjustments, decisions } = tables;

  return {
    adjustments: {
      byId: (_transaction, id) => Promise.resolve(adjustments.get(id)),
      forRun: (_transaction, runId) =>
        Promise.resolve([...adjustments.values()].filter((held) => held.payrollRunId === runId)),
      insert: (_transaction, state) => {
        adjustments.set(state.payrollAdjustmentId, state);
        return Promise.resolve();
      },
    },

    decisions: {
      forRun: (_transaction, runId) =>
        Promise.resolve(
          [...decisions.values()]
            .filter((held) => held.payrollRunId === runId)
            .sort((left, right) => left.sequence - right.sequence),
        ),
      byId: (_transaction, id) => Promise.resolve(decisions.get(id)),
      insert: (_transaction, state) => {
        // The self-approval check constraint, in memory.
        if (state.decidedBy === state.requestedBy) {
          throw new ConstraintViolation('payroll_approval_decision_self_approval_check');
        }
        decisions.set(state.approvalDecisionId, state);
        return Promise.resolve();
      },
    },
  };
};
