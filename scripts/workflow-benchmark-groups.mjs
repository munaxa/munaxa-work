/**
 * The Phase 16B half of the Workflow benchmark fixture: the lists, and the branches raised from
 * them.
 *
 * Split from `workflow-benchmark-data.mjs` at the file-size budget, along the seam the phase drew.
 * Everything here is a shape that did not exist before approval groups and parallel branches did,
 * and everything next door predates them.
 *
 * Written straight to the tables like the rest of the fixture, and refused by the same constraints:
 * a code is unique per tenant, a membership appears at most once on a list, and a member row carries
 * its group's tenant so the composite foreign key can be satisfied at all.
 */

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * The approval groups a tenant keeps, and how many memberships each holds.
 *
 * Fixed rather than scaled, for the reason the definitions are: a company does not keep one list of
 * approvers per employee. Forty is enough that a group listing is a real page rather than a single
 * row, and enough that `membersOfAll` over every one of them would show as forty statements if it
 * were written per group.
 *
 * The membership on a list is drawn from the same two hundred approvers the steps are, so a
 * membership genuinely appears both on a list and on somebody's queue — a fixture whose group
 * members were nobody's approvers would never notice a join that lost them.
 */
const GROUPS = 40;
const MEMBERS_PER_GROUP = 5;
const APPROVERS = 200;

/**
 * How many approvals are raised at a branch rather than at one named person.
 *
 * One in ten, so a branch is a real proportion of a tenant's work without being all of it: the
 * awaiting index has to serve both shapes, and a fixture where every approval was a branch would
 * measure a table where "several steps awaiting on one approval" is the only case.
 */
const BRANCHED = 10;

/** The number in `SUBJ-00000042`, as an integer — the fixture's one deterministic hash. */
const NUMBER_OF = `substring(i.subject_id from 6)::int`;

/** Forty lists, five memberships on each. */
export const seedGroups = async (admin, tenant, membership) => {
  await admin.query(
    `insert into workflow_approval_group
       (id, tenant_id, code, name, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'list-' || lpad(n::text, 4, '0'),
            jsonb_build_object('en', 'Approvers ' || n, 'ar', 'معتمدون ' || n),
            '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${String(GROUPS)}) as n`,
    [tenant],
  );
  await admin.query(
    `insert into workflow_approval_group_member
       (id, tenant_id, approval_group_id, membership_id, added_at,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, g.id,
            ${membership(tenant, `1 + ((substring(g.code from 6)::int * ${String(MEMBERS_PER_GROUP)} + m) % ${String(APPROVERS)})`)},
            now(), '{}'::jsonb, ${AUDIT}
       from workflow_approval_group g
       cross join generate_series(1, ${String(MEMBERS_PER_GROUP)}) as m
      where g.tenant_id = $1`,
    [tenant],
  );
};

/**
 * The branches: two more approvers at the position a running approval is waiting on.
 *
 * One approval in ten becomes a branch of three at ordinal 2 — the extra rows carry the same rule
 * and the same quorum as each other, because the domain refuses a position whose approvers disagree
 * about how it ends, and they carry the `source_group_id` of the list they were taken from.
 *
 * **The original row is updated to carry the branch's rule too**, for that same reason: a fixture
 * where one of three steps at a position said `majority` and the other two said nothing would be a
 * shape the application would never have written.
 *
 * Only running approvals are branched. A branch on a finished one would need decisions on every
 * extra step to be consistent with the outcome already recorded, and the fixture writes decisions
 * from the step status rather than the other way round.
 */
export const seedBranches = async (admin, tenant, membership) => {
  const branch = `${NUMBER_OF} % ${String(BRANCHED)} = 0 and i.status = 'running'`;

  await admin.query(
    `insert into workflow_step
       (id, tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
        source_group_id, branch_rule, quorum, condition,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, i.id, 2, 'membership',
            ${membership(tenant, `1 + ((${NUMBER_OF} + 10 + extra) % ${String(APPROVERS)})`)},
            'awaiting', g.id, 'majority', 2,
            jsonb_build_array(jsonb_build_object('key', 'amount', 'operator', 'greater-than',
                                                 'value', 4000)),
            '{}'::jsonb, ${AUDIT}
       from workflow_instance i
       cross join generate_series(1, 2) as extra
       join lateral (select id from workflow_approval_group
                      where tenant_id = $1 order by code
                      offset (${NUMBER_OF} % ${String(GROUPS)}) limit 1) g on true
      where i.tenant_id = $1 and ${branch}`,
    [tenant],
  );
  await admin.query(
    `update workflow_step s
        set source_group_id = b.source_group_id, branch_rule = b.branch_rule,
            quorum = b.quorum, condition = b.condition
       from workflow_instance i,
            lateral (select source_group_id, branch_rule, quorum, condition
                       from workflow_step x
                      where x.instance_id = i.id and x.tenant_id = $1 and x.branch_rule is not null
                      limit 1) b
      where s.tenant_id = $1 and s.instance_id = i.id and s.ordinal = 2
        and s.branch_rule is null and i.tenant_id = $1 and ${branch}`,
    [tenant],
  );
};
