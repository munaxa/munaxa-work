import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CORRELATION,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  type PoolLike,
} from './workflow-database.fixture.js';

/**
 * Rows the schema suites build on, written the way the application will write them.
 *
 * Every insert here goes through the **real columns, constraints, indexes and triggers**. Nothing is
 * disabled and no constraint is relaxed to make seeding easier: a fixture that could create a state
 * the product cannot is a fixture whose assertions are about a different database.
 *
 * The helpers return the identifiers they created rather than taking them, because `app_uuid_v7()`
 * is the column default and letting the database mint them is what the application will do.
 */

export interface SeededDefinition {
  readonly definitionId: string;
  readonly workflowVersionId: string;
  readonly templateIds: readonly string[];
}

export interface SeededInstance extends SeededDefinition {
  readonly instanceId: string;
  readonly stepIds: readonly string[];
}

const idOf = (rows: readonly { id: string }[]): string => {
  const [row] = rows;

  if (row === undefined) throw new Error('The seed inserted no row.');
  return row.id;
};

const NAME = `'{"en":"Approval","ar":"اعتماد"}'::jsonb`;

/** A definition with a published version of `steps` steps, each named to a different approver. */
export const seedDefinition = async (
  client: PoolLike,
  tenantId: string,
  steps: readonly string[] = [APPROVER],
  code = 'requisition-approval',
): Promise<SeededDefinition> => {
  const definition = await client.query<{ id: string }>(
    `insert into workflow_definition
       (tenant_id, code, name, subject_type, status, ${AUDIT_COLUMNS})
     values ($1, $2, ${NAME}, $3, 'active', ${AUDIT_VALUES}) returning id`,
    [tenantId, code, SUBJECT_TYPE],
  );
  const definitionId = idOf(definition.rows);
  const version = await client.query<{ id: string }>(
    `insert into workflow_version
       (tenant_id, definition_id, version_number, status, published_at, published_by,
        ${AUDIT_COLUMNS})
     values ($1, $2, 1, 'published', now(), 'user:test', ${AUDIT_VALUES}) returning id`,
    [tenantId, definitionId],
  );
  const workflowVersionId = idOf(version.rows);
  const templateIds: string[] = [];

  for (const [index, approver] of steps.entries()) {
    const template = await client.query<{ id: string }>(
      `insert into workflow_step_template
         (tenant_id, workflow_version_id, ordinal, name, approver_kind, approver_membership_id,
          ${AUDIT_COLUMNS})
       values ($1, $2, $3, ${NAME}, 'membership', $4, ${AUDIT_VALUES}) returning id`,
      [tenantId, workflowVersionId, index + 1, approver],
    );

    templateIds.push(idOf(template.rows));
  }
  return { definitionId, workflowVersionId, templateIds };
};

/**
 * A running instance with its steps copied from the templates.
 *
 * The first step is `awaiting` and the rest are `pending`: a sequential chain, which is what every
 * process configured under 16A is and what `startInstance` still produces from distinct ordinals.
 * `seedBranchInstance` below is its parallel counterpart.
 */
export const seedInstance = async (
  client: PoolLike,
  tenantId: string,
  steps: readonly string[] = [APPROVER],
  subjectId = 'requisition-1',
): Promise<SeededInstance> => {
  // The definition code is derived from the subject so that two instances in one tenant do not
  // collide on `workflow_definition_code_idx` — which is the index doing its job, and a fixture
  // that reused one code would be testing uniqueness rather than the invariant it came for.
  const definition = await seedDefinition(client, tenantId, steps, `approval-${subjectId}`);
  const instance = await client.query<{ id: string }>(
    `insert into workflow_instance
       (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
        requested_by_membership_id, status, started_at, correlation_id, context, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, $5, $6, 'running', now(), $7, '{"headcount":2}'::jsonb,
             ${AUDIT_VALUES}) returning id`,
    [
      tenantId,
      definition.definitionId,
      definition.workflowVersionId,
      SUBJECT_TYPE,
      subjectId,
      REQUESTER,
      CORRELATION,
    ],
  );
  const instanceId = idOf(instance.rows);
  const stepIds: string[] = [];

  for (const [index, approver] of steps.entries()) {
    const step = await client.query<{ id: string }>(
      `insert into workflow_step
         (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
          ${AUDIT_COLUMNS})
       values ($1, $2, $3, 'membership', $4, $5, ${AUDIT_VALUES}) returning id`,
      [tenantId, instanceId, index + 1, approver, index === 0 ? 'awaiting' : 'pending'],
    );

    stepIds.push(idOf(step.rows));
  }
  return { ...definition, instanceId, stepIds };
};

export interface SeededGroup {
  readonly approvalGroupId: string;
  readonly memberIds: readonly string[];
}

/**
 * A group and the memberships on its list.
 *
 * Written the way an administrator will: a list is named first and filled afterwards, which is why
 * an empty `members` is a legal seed rather than a broken one. What is refused is *using* an empty
 * group, and that is the domain's rule at instance start rather than the table's.
 */
export const seedApprovalGroup = async (
  client: PoolLike,
  tenantId: string,
  members: readonly string[] = [APPROVER, SECOND_APPROVER],
  code = 'capital-approvers',
): Promise<SeededGroup> => {
  const group = await client.query<{ id: string }>(
    `insert into workflow_approval_group (tenant_id, code, name, ${AUDIT_COLUMNS})
     values ($1, $2, ${NAME}, ${AUDIT_VALUES}) returning id`,
    [tenantId, code],
  );
  const approvalGroupId = idOf(group.rows);
  const memberIds: string[] = [];

  for (const membershipId of members) {
    const member = await client.query<{ id: string }>(
      `insert into workflow_approval_group_member
         (tenant_id, approval_group_id, membership_id, added_at, ${AUDIT_COLUMNS})
       values ($1, $2, $3, now(), ${AUDIT_VALUES}) returning id`,
      [tenantId, approvalGroupId, membershipId],
    );

    memberIds.push(idOf(member.rows));
  }
  return { approvalGroupId, memberIds };
};

/**
 * An instance whose steps form **one parallel branch**: every step at ordinal 1, all awaiting.
 *
 * This is the state 16A's two replaced indexes made unrepresentable, so it is seeded through the
 * real columns rather than asserted about: if either index were still unique, nothing below would
 * reach its assertion.
 */
export const seedBranchInstance = async (
  client: PoolLike,
  tenantId: string,
  approvers: readonly string[] = [APPROVER, SECOND_APPROVER],
  subjectId = 'requisition-branch',
): Promise<SeededInstance> => {
  const definition = await seedDefinition(client, tenantId, approvers, `approval-${subjectId}`);
  const instance = await client.query<{ id: string }>(
    `insert into workflow_instance
       (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
        requested_by_membership_id, status, started_at, correlation_id, context, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, $5, $6, 'running', now(), $7, '{"amount":50000}'::jsonb,
             ${AUDIT_VALUES}) returning id`,
    [
      tenantId,
      definition.definitionId,
      definition.workflowVersionId,
      SUBJECT_TYPE,
      subjectId,
      REQUESTER,
      CORRELATION,
    ],
  );
  const instanceId = idOf(instance.rows);
  const stepIds: string[] = [];

  for (const approver of approvers) {
    const step = await client.query<{ id: string }>(
      `insert into workflow_step
         (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
          branch_rule, ${AUDIT_COLUMNS})
       values ($1, $2, 1, 'membership', $3, 'awaiting', 'majority', ${AUDIT_VALUES}) returning id`,
      [tenantId, instanceId, approver],
    );

    stepIds.push(idOf(step.rows));
  }
  return { ...definition, instanceId, stepIds };
};

/** One decision on one step, by the assigned approver on their own authority. */
export const seedDecision = async (
  client: PoolLike,
  tenantId: string,
  seeded: { readonly instanceId: string; readonly stepIds: readonly string[] },
  decidedBy: string = APPROVER,
): Promise<string> => {
  const [stepId] = seeded.stepIds;

  if (stepId === undefined) throw new Error('The seed produced no step to decide.');

  const decision = await client.query<{ id: string }>(
    `insert into workflow_decision
       (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority, decided_at,
        ${AUDIT_COLUMNS})
     values ($1, $2, $3, 'approved', $4, 'assigned', now(), ${AUDIT_VALUES}) returning id`,
    [tenantId, seeded.instanceId, stepId, decidedBy],
  );

  return idOf(decision.rows);
};

/** One history entry about an instance starting. */
export const seedHistory = async (
  client: PoolLike,
  tenantId: string,
  instanceId: string,
): Promise<string> => {
  const history = await client.query<{ id: string }>(
    `insert into workflow_history
       (tenant_id, instance_id, event, occurred_at, actor_membership_id, ${AUDIT_COLUMNS})
     values ($1, $2, 'instance-started', now(), $3, ${AUDIT_VALUES}) returning id`,
    [tenantId, instanceId, REQUESTER],
  );

  return idOf(history.rows);
};
