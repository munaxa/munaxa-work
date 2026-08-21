import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type {
  DueReminder,
  InstanceFilters,
  InstanceStore,
  Page,
  Paged,
  StepStore,
} from '../application/workflow-ports.js';
import {
  instanceColumns,
  instanceState,
  instanceValues,
  stepColumns,
  stepState,
  stepValues,
  type InstanceRow,
  type StepRow,
} from './workflow-record-rows.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';
import { dueForReminderRows } from './step-due-reminders.js';

/**
 * Running approvals, and the steps they are made of.
 *
 * Two repositories rather than one, because the application asks for two stores: a step is read on
 * its own by the queue, which never wants the approval it belongs to. That is a genuine seam rather
 * than a table-shaped one — the queue is the busiest read in the module and it must not join.
 *
 * **Nothing here opens a transaction.** Starting an approval writes an instance, a step per template
 * and two history entries, and either all of them exist or none does.
 */
export class PostgresInstanceRepository
  extends Repository<InstanceRow & { version: number }>
  implements InstanceStore
{
  public constructor() {
    super('workflow_instance');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<WorkflowInstanceState | undefined> {
    const rows = await transaction.execute<InstanceRow>(
      `select ${instanceColumns('i')} from workflow_instance i
         where i.id = $1 and i.tenant_id = $2 and i.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : instanceState(rows[0]);
  }

  /**
   * The open approval for a subject, if there is one — the read behind duplicate convergence.
   *
   * Filtered on `running` because `workflow_instance_open_subject_idx` is partial on exactly that:
   * an approval that was rejected or cancelled does not block a later one, which is how a corrected
   * request is raised.
   */
  public async openForSubject(
    transaction: Transaction,
    subjectType: string,
    subjectId: string,
  ): Promise<WorkflowInstanceState | undefined> {
    const rows = await transaction.execute<InstanceRow>(
      `select ${instanceColumns('i')} from workflow_instance i
         where i.subject_type = $1 and i.subject_id = $2 and i.tenant_id = $3
           and i.status = 'running' and i.deleted_at is null`,
      [subjectType, subjectId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : instanceState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: InstanceFilters,
    paged: Paged,
  ): Promise<Page<WorkflowInstanceState>> {
    const predicate = predicateFor('i', transaction.tenantId, instanceFilters(filters));

    return pageOf<InstanceRow, WorkflowInstanceState>(
      transaction,
      {
        select: `select ${instanceColumns('i')} from workflow_instance i
                   where ${predicate.clause}
                   order by i.started_at desc, i.id
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from workflow_instance i where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      instanceState,
    );
  }

  public insert(transaction: Transaction, state: WorkflowInstanceState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_instance',
      instanceValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: WorkflowInstanceState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.instanceId,
      expected,
      mutable(instanceValues(state, transaction.tenantId)),
    );
  }
}

const instanceFilters = (filters: InstanceFilters): readonly Filter[] => [
  { column: 'i.status', value: filters.status },
  { column: 'i.definition_id', value: filters.definitionId },
  { column: 'i.subject_type', value: filters.subjectType },
  { column: 'i.subject_id', value: filters.subjectId },
];

/**
 * The steps of an approval, and the queue.
 *
 * `awaitingFor` is the read this whole phase exists to serve, and it is deliberately narrow: one
 * membership, one status, ordered by identifier. `workflow_step_queue_idx` is partial on
 * `status = 'awaiting'`, so the index stays the size of the open work rather than of every step ever
 * decided — and the query's shape is what makes it reachable.
 *
 * **The membership is a parameter, not a context read.** A store cannot see an execution context;
 * the handler resolves the caller and passes it, and there is no query in this module through which
 * a caller could name somebody else.
 */
export class PostgresStepRepository
  extends Repository<StepRow & { version: number }>
  implements StepStore
{
  public constructor() {
    super('workflow_step');
  }

  public async byId(transaction: Transaction, id: string): Promise<WorkflowStepState | undefined> {
    const rows = await transaction.execute<StepRow>(
      `select ${stepColumns('s')} from workflow_step s
         where s.id = $1 and s.tenant_id = $2 and s.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : stepState(rows[0]);
  }

  public async forInstance(
    transaction: Transaction,
    instanceId: string,
  ): Promise<readonly WorkflowStepState[]> {
    const rows = await transaction.execute<StepRow>(
      `select ${stepColumns('s')} from workflow_step s
         where s.instance_id = $1 and s.tenant_id = $2 and s.deleted_at is null
         order by s.ordinal, s.id`,
      [instanceId, transaction.tenantId],
    );

    return rows.map(stepState);
  }

  public async awaitingFor(
    transaction: Transaction,
    approverMembershipId: string,
    paged: Paged,
  ): Promise<Page<WorkflowStepState>> {
    const parameters = [approverMembershipId, transaction.tenantId];
    const clause = `s.approver_membership_id = $1 and s.tenant_id = $2
                      and s.status = 'awaiting' and s.deleted_at is null`;

    return pageOf<StepRow, WorkflowStepState>(
      transaction,
      {
        select: `select ${stepColumns('s')} from workflow_step s
                   where ${clause}
                   order by s.id
                   limit $3 offset $4`,
        count: `select count(*)::text as total from workflow_step s where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      stepState,
    );
  }

  /**
   * The steps whose automatic service-level reminder is due, after a cursor, bounded.
   *
   * The SQL and the reasoning behind it are in `step-due-reminders.ts` — it is the only read here
   * that answers a machine's question rather than a person's, and it is kept whole beside its own
   * explanation.
   */
  public dueForReminder(
    transaction: Transaction,
    asAt: Date,
    limit: number,
    cursor?: string,
  ): Promise<readonly DueReminder[]> {
    return dueForReminderRows(transaction, asAt, limit, cursor);
  }

  public insert(transaction: Transaction, state: WorkflowStepState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_step',
      stepValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: WorkflowStepState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.stepId,
      expected,
      mutable(stepValues(state, transaction.tenantId)),
    );
  }
}
