import type { Transaction } from '@work/kernel';

import type { CorrectionRequestState } from '../domain/correction.js';
import type { PolicyState } from '../domain/attendance-policy.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type {
  ScheduleAssignmentState,
  ScheduleDayState,
  ScheduleState,
} from '../domain/schedule.js';
import type { SegmentState, ShiftState } from '../domain/shift.js';

import type {
  AttendanceStores,
  ImportBatchState,
  Page,
  SnapshotState,
} from './attendance-ports.js';
import {
  InMemoryDayStore,
  InMemoryEventStore,
  InMemoryExceptionStore,
  InMemoryStore,
  equalWhereGiven,
  paged,
  scoped,
  withinDates,
} from './in-memory-stores.js';

/**
 * The definition and record stores, and the bundle that assembles all thirteen.
 *
 * Apart from the event, day and exception stores for size, and along a seam that means something:
 * those three are where the reliability properties live — the deduplication key and the stale mark
 * — and these are the configuration and the output beside them.
 *
 * Every read filters on `transaction.tenantId`, exactly as the SQL does, so the *tenant* filter is
 * exercised in the fast suites rather than only in the integration ones.
 */

class InMemoryShiftStore extends InMemoryStore<ShiftState> {
  public byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly ShiftState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => ids.includes(row.id)));
  }

  public byCode(transaction: Transaction, code: string): Promise<ShiftState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.code === code));
  }
}

class InMemorySegmentStore {
  public readonly rows: SegmentState[] = [];

  public forShift(transaction: Transaction, shiftId: string): Promise<readonly SegmentState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction)
        .filter((row) => row.shiftId === shiftId)
        .sort((left, right) => left.sequence - right.sequence),
    );
  }

  public forShifts(
    transaction: Transaction,
    shiftIds: readonly string[],
  ): Promise<readonly SegmentState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => shiftIds.includes(row.shiftId)),
    );
  }

  public insert(_transaction: Transaction, state: SegmentState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryScheduleStore extends InMemoryStore<ScheduleState> {
  public byCode(transaction: Transaction, code: string): Promise<ScheduleState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.code === code));
  }
}

class InMemoryScheduleDayStore {
  public readonly rows: ScheduleDayState[] = [];

  public forSchedule(
    transaction: Transaction,
    scheduleId: string,
  ): Promise<readonly ScheduleDayState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.scheduleId === scheduleId),
    );
  }

  public insert(_transaction: Transaction, state: ScheduleDayState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryAssignmentStore extends InMemoryStore<ScheduleAssignmentState> {
  public forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly ScheduleAssignmentState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.employmentId === employmentId),
    );
  }
}

class InMemoryRosterStore extends InMemoryStore<RosterEntryState> {
  public on(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<RosterEntryState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) => row.employmentId === employmentId && row.onDate === onDate,
      ),
    );
  }

  public between(
    transaction: Transaction,
    from: string,
    to: string,
    employmentId?: string,
  ): Promise<readonly RosterEntryState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          withinDates(row.onDate, from, to) &&
          (employmentId === undefined || row.employmentId === employmentId),
      ),
    );
  }

  public remove(_transaction: Transaction, id: string, _expected: number): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);

    if (index !== -1) this.rows.splice(index, 1);
    return Promise.resolve();
  }
}

class InMemoryPolicyStore extends InMemoryStore<PolicyState> {
  public published(transaction: Transaction): Promise<readonly PolicyState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => row.status === 'published'));
  }
}

class InMemoryCorrectionStore extends InMemoryStore<CorrectionRequestState> {
  public appliedRemovals(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly string[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter(
          (row) =>
            row.employmentId === employmentId &&
            row.attendanceDate === attendanceDate &&
            row.kind === 'remove_event' &&
            row.state === 'applied',
        )
        .map((row) => row.targetEventId)
        .filter((id): id is string => id !== undefined),
    );
  }

  public search(
    transaction: Transaction,
    query: {
      readonly limit: number;
      readonly offset: number;
      readonly employmentId?: string;
      readonly state?: string;
      readonly kind?: string;
    },
  ): Promise<Page<CorrectionRequestState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.state, query.state) &&
        equalWhereGiven(row.kind, query.kind),
    );

    return Promise.resolve(paged(matched, query));
  }
}

class InMemorySnapshotStore {
  public readonly rows: SnapshotState[] = [];

  public latest(
    transaction: Transaction,
    employmentId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<SnapshotState | undefined> {
    const matched = scoped(this.rows, transaction)
      .filter(
        (row) =>
          row.employmentId === employmentId &&
          row.periodStart === periodStart &&
          row.periodEnd === periodEnd,
      )
      .sort((left, right) => right.sequence - left.sequence);

    return Promise.resolve(matched[0]);
  }

  public forPeriod(
    transaction: Transaction,
    periodStart: string,
    periodEnd: string,
    employmentId?: string,
  ): Promise<readonly SnapshotState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter(
        (row) =>
          row.periodStart === periodStart &&
          row.periodEnd === periodEnd &&
          (employmentId === undefined || row.employmentId === employmentId),
      ),
    );
  }

  public insert(_transaction: Transaction, state: SnapshotState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryImportStore extends InMemoryStore<ImportBatchState> {
  public recent(transaction: Transaction, limit: number): Promise<readonly ImportBatchState[]> {
    return Promise.resolve(this.scoped(transaction).slice(0, limit));
  }
}

export interface InMemoryAttendanceStores extends AttendanceStores {
  readonly events: InMemoryEventStore;
  readonly days: InMemoryDayStore;
  readonly exceptions: InMemoryExceptionStore;
}

export const inMemoryAttendanceStores = (): InMemoryAttendanceStores => ({
  events: new InMemoryEventStore(),
  days: new InMemoryDayStore(),
  exceptions: new InMemoryExceptionStore(),
  shifts: new InMemoryShiftStore(),
  segments: new InMemorySegmentStore(),
  schedules: new InMemoryScheduleStore(),
  scheduleDays: new InMemoryScheduleDayStore(),
  assignments: new InMemoryAssignmentStore(),
  rosters: new InMemoryRosterStore(),
  policies: new InMemoryPolicyStore(),
  corrections: new InMemoryCorrectionStore(),
  snapshots: new InMemorySnapshotStore(),
  imports: new InMemoryImportStore(),
});
