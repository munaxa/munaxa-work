import {
  APPROVER,
  AUDIT,
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
  options: { readonly approver?: string; readonly subjectId?: string; readonly code?: string } = {},
): Promise<StartedApproval> => {
  const approver = options.approver ?? APPROVER;
  const code = options.code ?? 'requisition-approval';

  return harness.inTenant(tenantId, REQUESTER, async () => {
    const definition = await send<{ definitionId: string }>(harness, {
      commandName: 'workflow.create-definition',
      code,
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      description: { en: 'Raised for a requisition', ar: 'يُرفع لطلب توظيف' },
      subjectType: SUBJECT_TYPE,
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
      subjectType: SUBJECT_TYPE,
      subjectId: options.subjectId ?? 'requisition-1',
      context: { headcount: 2 },
    });

    return { definitionId: definition.definitionId, instanceId: instance.instanceId };
  });
};
