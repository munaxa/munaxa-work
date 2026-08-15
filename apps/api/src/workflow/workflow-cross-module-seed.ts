import { uuidV7 } from '@work/kernel';

import {
  APPROVER,
  AUDIT,
  AUDIT_COLUMNS,
  DECIDE_SCOPE,
  DEPUTY,
  REQUESTER,
  SUBJECT_TYPE,
  send,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';

/**
 * The world the cross-module suites act in: Identity's people, their delegations, and the approvals
 * Workflow raises for them.
 *
 * **Identity's rows are seeded as the owner; Workflow's are raised through its own commands.** The
 * split is deliberate. `workforce_user`'s policy admits a user only when a membership already points
 * at it and `tenant_membership` is forced-RLS as well, so the unprivileged application role cannot
 * bootstrap the two of them — correctly, because in production Identity's own commands create them.
 * Setting up another module's world is fixture work and is not where a security claim is made; every
 * assertion in the suites runs through the application role, whose `rolsuper` and `rolbypassrls` are
 * checked before any isolation result is believed.
 *
 * A **delegation**, by contrast, goes in through the unprivileged connection, so the policy that
 * governs it has to accept the write — and the query that reads it back is Identity's own.
 */

export interface DelegationSeed {
  readonly delegator?: string;
  readonly delegate?: string;
  readonly scope?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly status?: string;
}

/**
 * One delegation, written straight into Identity's table.
 *
 * Written rather than commanded because Identity's `grant-delegation` command is not what is under
 * test and would need its own memberships, profiles and permissions to reach. **The row goes in
 * through the real columns, constraints and policy**, and comes back out through Identity's real
 * query — which is the half that matters.
 */
export const seedDelegation = async (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  seed: DelegationSeed = {},
): Promise<void> => {
  const client = await harness.pool.connect();

  try {
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `insert into delegation
         (tenant_id, delegator_membership_id, delegate_membership_id, scope, effective_from,
          effective_to, status, reason, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, $5, $6, $7, 'Annual leave', ${AUDIT})`,
      [
        tenantId,
        seed.delegator ?? APPROVER,
        seed.delegate ?? DEPUTY,
        seed.scope ?? DECIDE_SCOPE,
        seed.from ?? new Date('2026-08-01T00:00:00.000Z'),
        seed.to ?? new Date('2026-09-01T00:00:00.000Z'),
        seed.status ?? 'active',
      ],
    );
    await client.query('commit');
  } catch (error: unknown) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

export interface StartedApproval {
  readonly definitionId: string;
  readonly instanceId: string;
}

/**
 * A published one-step workflow and an instance of it, raised through **Workflow's own commands**.
 *
 * Every row this produces went through a handler, a repository and PostgreSQL, so the state the
 * decision tests act on is a state the product can actually reach.
 */
export const startApproval = async (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  options: {
    readonly approver?: string;
    readonly subjectId?: string;
    readonly code?: string;
    /** A subject type no adapter owns, for proving the unadopted path. Defaults to a requisition. */
    readonly subjectType?: string;
  } = {},
): Promise<StartedApproval> => {
  const approver = options.approver ?? APPROVER;
  const code = options.code ?? 'requisition-approval';
  const subjectType = options.subjectType ?? SUBJECT_TYPE;

  return harness.inTenant(tenantId, REQUESTER, async () => {
    const definition = await send<{ definitionId: string }>(harness, {
      commandName: 'workflow.create-definition',
      code,
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      description: { en: 'Raised for a requisition', ar: 'يُرفع لطلب توظيف' },
      subjectType,
    });
    const version = await send<{ workflowVersionId: string; versionNumber: number }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: definition.definitionId,
    });

    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version.workflowVersionId,
      ordinal: 1,
      name: { en: 'Approve', ar: 'اعتماد' },
      approverMembershipId: approver,
    });
    await send(harness, {
      commandName: 'workflow.publish-version',
      workflowVersionId: version.workflowVersionId,
      expectedVersion: 1,
    });

    const instance = await send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: definition.definitionId,
      subjectType,
      subjectId: options.subjectId ?? 'requisition-1',
      context: { headcount: 2 },
    });

    return { definitionId: definition.definitionId, instanceId: instance.instanceId };
  });
};

// ------------------------------------------------------------------------------------------------
// The adopting module's own record
// ------------------------------------------------------------------------------------------------

export interface SeededRequisition {
  readonly requisitionId: string;
}

let sequence = 0;

/**
 * A requisition waiting for a decision, written straight into Recruitment's table.
 *
 * Written rather than commanded because reaching `pending_approval` through Recruitment's own
 * commands needs a position, a unit and an employment from three other modules, none of which is
 * what this seam is about. **The row goes in through the real columns, constraints and policy**, and
 * everything the suites then do to it — read it, decide it, reconcile against it — goes through
 * Recruitment's own published contracts and its own aggregate.
 *
 * `approvalId` is left null unless a suite is deliberately setting up the "already decided" cases,
 * which is the state every requisition in this repository is in today: nothing has ever written that
 * column.
 */
export const seedRequisition = async (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  seed: {
    readonly status?: string;
    readonly approvalId?: string;
    readonly requisitionId?: string;
  } = {},
): Promise<SeededRequisition> => {
  const requisitionId = seed.requisitionId ?? uuidV7();

  sequence += 1;

  const client = await harness.pool.connect();

  try {
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `insert into recruitment_requisition
         (id, tenant_id, requisition_number, status, position_id, unit_id, headcount_requested,
          headcount_filled, reason_code, requested_by_employment_id, approval_id, metadata,
          ${AUDIT_COLUMNS})
       values ($1, $2, $3, $4, $5, $6, 1, 0, 'growth', $7, $8, '{}'::jsonb, ${AUDIT})`,
      [
        requisitionId,
        tenantId,
        `REQ-2026-${String(sequence).padStart(6, '0')}`,
        seed.status ?? 'pending_approval',
        uuidV7(),
        uuidV7(),
        uuidV7(),
        seed.approvalId ?? null,
      ],
    );
    await client.query('commit');
  } catch (error: unknown) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { requisitionId };
};

/** What Recruitment currently holds, read straight from its table for an assertion. */
export const requisitionRow = async (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  requisitionId: string,
): Promise<{ readonly status: string; readonly approval_id: string | null } | undefined> => {
  const rows = await harness.rowsIn<{ status: string; approval_id: string | null }>(
    tenantId,
    `select status, approval_id from recruitment_requisition where id = $1`,
    [requisitionId],
  );

  return rows[0];
};

/** The decision rows Recruitment wrote — the evidence a headcount audit reads. */
export const requisitionDecisions = (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  requisitionId: string,
): Promise<{ readonly decision: string; readonly decided_by: string }[]> =>
  harness.rowsIn<{ decision: string; decided_by: string }>(
    tenantId,
    `select decision, decided_by from recruitment_requisition_decision where requisition_id = $1`,
    [requisitionId],
  );

/**
 * Puts a requisition into a state a prior decision would have left it in.
 *
 * Used to set up the "already decided" cases — including the one a failed Workflow commit leaves
 * behind, where Recruitment carries the approval and Workflow has no record of it. There is no
 * command that produces that state, because it is a *partial* outcome rather than an act.
 *
 * **Inside a tenant context**, because the application role cannot bypass row-level security: a write
 * issued without `app.tenant_id` set matches no row, and a fixture that did so would silently change
 * nothing and leave every assertion after it testing the wrong world.
 */
export const decidedAlready = async (
  harness: WorkflowCrossModuleHarness,
  tenantId: string,
  requisitionId: string,
  state: { readonly status: string; readonly approvalId?: string },
): Promise<void> => {
  const client = await harness.pool.connect();

  try {
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

    const written = await client.query(
      `update recruitment_requisition
          set status = $1, approval_id = $2, version = version + 1, updated_at = now()
        where id = $3`,
      [state.status, state.approvalId ?? null, requisitionId],
    );

    if (written.rowCount !== 1) throw new Error('The fixture updated no requisition.');
    await client.query('commit');
  } catch (error: unknown) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};
