import { seedBranches, seedGroups } from './workflow-benchmark-groups.mjs';

/**
 * Seeding one tenant's whole approval position, for `measure-workflow-performance.mjs`.
 *
 * Split from the measurements for the reason the file-size budget exists: what a benchmark *reads*
 * and how its fixture was *built* are two different concerns, and a reader checking whether the
 * approval queue is measured honestly should not have to scroll past two hundred lines of inserts to
 * find it.
 *
 * Deliberately **not** through the command handlers: raising a hundred thousand approvals through
 * the dispatcher would measure the seeding rather than the reads, and the reads are the point. The
 * rows written here are the rows the handlers write — same columns, same check constraints, same
 * partial unique indexes, same immutability triggers. Anything the domain would have refused,
 * PostgreSQL refuses here too: a decision whose author is `system:auto-approval`, a delegated
 * decision naming nobody, a delegated decision naming its own actor, a running approval carrying a
 * completion time, a second awaiting step on one approval, or a second running approval about one
 * subject.
 *
 * **The proportions are the ones a real organization has**, because selectivity is what a query plan
 * turns on. A tenant where every approval is still running measures a different index from one where
 * a fifth are, and the second is the case somebody opens a queue to see. So: **a fifth of approvals
 * are running** and the rest have ended — most by approval, the remainder rejected or cancelled.
 *
 * **Two hundred approvers share the work**, which is what makes a queue read selective rather than a
 * scan of everything awaiting in the tenant. At tier C that is a hundred approvals waiting on each
 * of them — a plausible morning, and enough that a queue read touching every running instance would
 * show as a slope rather than as noise.
 *
 * **Both tenants use the same membership identifiers**, deliberately. The two tenant identifiers
 * share their first twenty-four characters, so approver 7 of tenant A and approver 7 of tenant B are
 * the *same* uuid. A benchmark whose tenants held disjoint identifiers would pass its isolation
 * assertions whether or not row-level security worked, because every read would be separated by the
 * value rather than by the policy.
 *
 * **One decision in twelve is delegated**, so the actor and the authority differ on a real
 * proportion of rows rather than on a single hand-placed one.
 */

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * The configuration every tier shares.
 *
 * Fixed rather than scaled, because a tenant's approval configuration does not grow with its
 * headcount: a company of a hundred thousand runs the same handful of approval processes as one of
 * five hundred, and what scales is the number of approvals raised against them.
 *
 * Each definition carries three versions — archived, published, draft — because `currentPublished`
 * has to choose among them, and a fixture with one version per definition would measure a lookup
 * that never had to discriminate.
 */
const DEFINITIONS = 6;
const VERSIONS_PER_DEFINITION = 3;
const STEPS_PER_VERSION = 2;

/** How many people share the approving. See the file note on selectivity. */
export const APPROVERS = 200;


/** The subject types the fixture raises approvals about. Opaque strings; Workflow reads neither. */
const SUBJECT_TYPES = ['recruitment.requisition', 'leave.request', 'compensation.change'];

/**
 * A membership identifier built from a tenant's prefix and an ordinal.
 *
 * Deterministic so a measurement can ask for *a named approver's* queue rather than discovering one
 * first and timing the discovery. The prefix is the tenant's own first twenty-four characters, which
 * for the two tenants this benchmark uses are identical — see the file note.
 */
const membership = (tenant, expression) =>
  `('${tenant.slice(0, 24)}' || lpad((${expression})::text, 12, '0'))::uuid`;

/** The number in `SUBJ-00000042`, as an integer — the fixture's one deterministic hash. */
const NUMBER_OF = `substring(i.subject_id from 6)::int`;

/**
 * One tenant, at one tier.
 *
 * Returns the handful of identifiers the measurements need — a definition, a published version, a
 * running approval, a finished one, a subject, an approver, a decider and a cohort — so that no
 * measurement has to go looking for a row first and accidentally time that instead.
 */
export const seedTenant = async (admin, tenant, approvals) => {
  await seedGroups(admin, tenant, membership);
  await seedConfiguration(admin, tenant);
  await seedInstances(admin, tenant, approvals);
  await seedSteps(admin, tenant);
  await seedBranches(admin, tenant, membership);
  await seedRecords(admin, tenant);

  return handles(admin, tenant);
};

/** Six definitions, eighteen versions, thirty-six step templates. Flat at every tier. */
const seedConfiguration = async (admin, tenant) => {
  await admin.query(
    `insert into workflow_definition
       (id, tenant_id, code, name, description, subject_type, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'approval-' || lpad(n::text, 4, '0'),
            jsonb_build_object('en', 'Approval ' || n, 'ar', 'اعتماد ' || n),
            jsonb_build_object('en', 'Two approvers, in order', 'ar', 'معتمدان بالترتيب'),
            (array[${SUBJECT_TYPES.map((type) => `'${type}'`).join(',')}])[1 + (n % ${String(SUBJECT_TYPES.length)})],
            'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${String(DEFINITIONS)}) as n`,
    [tenant],
  );
  // Archived, published, draft — in that order, so `currentPublished` cannot be right by simply
  // taking the highest-numbered version.
  await admin.query(
    `insert into workflow_version
       (id, tenant_id, definition_id, version_number, status, published_at, published_by,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, d.id, v,
            (array['archived','published','draft'])[v],
            case when v <= 2 then now() end,
            case when v <= 2 then 'user:benchmark' end,
            '{}'::jsonb, ${AUDIT}
       from workflow_definition d
       cross join generate_series(1, ${String(VERSIONS_PER_DEFINITION)}) as v
      where d.tenant_id = $1`,
    [tenant],
  );
  await admin.query(
    `insert into workflow_step_template
       (id, tenant_id, workflow_version_id, ordinal, name, approver_kind, approver_membership_id,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, v.id, s,
            jsonb_build_object('en', 'Step ' || s, 'ar', 'خطوة ' || s),
            'membership', ${membership(tenant, 's')},
            '{}'::jsonb, ${AUDIT}
       from workflow_version v
       cross join generate_series(1, ${String(STEPS_PER_VERSION)}) as s
      where v.tenant_id = $1`,
    [tenant],
  );
};

/**
 * The approvals themselves — a fifth running, the rest ended.
 *
 * The subject identifier is unique per approval, so the partial unique index over running approvals
 * is satisfied without the fixture needing to know in advance which rows become running. The start
 * times fan out over four hundred hours so the ordered status index has something to order.
 */
const seedInstances = async (admin, tenant, approvals) => {
  await admin.query(
    `insert into workflow_instance
       (id, tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
        requested_by_membership_id, status, started_at, completed_at, cancelled_by,
        cancellation_reason, correlation_id, context, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, v.definition_id, v.id, d.subject_type,
            'SUBJ-' || lpad(n::text, 8, '0'),
            ${membership(tenant, `1 + (n % ${String(APPROVERS)})`)},
            s.status,
            now() - (n % 400) * interval '1 hour',
            case when s.status <> 'running'
                 then now() - (n % 400) * interval '1 hour' + interval '2 hours' end,
            case when s.status = 'cancelled' then 'user:benchmark' end,
            case when s.status = 'cancelled' then 'Withdrawn by the requester' end,
            app_uuid_v7(), '{}'::jsonb, '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${String(approvals)}) as n
       cross join lateral (select (array['running','completed','completed','completed',
                                         'completed','completed','rejected','rejected',
                                         'cancelled','running'])[1 + (n % 10)] as status) s
       join lateral (select v.id, v.definition_id from workflow_version v
                      join workflow_definition wd on wd.id = v.definition_id
                     where v.tenant_id = $1 and v.status = 'published'
                     order by wd.code offset (n % ${String(DEFINITIONS)}) limit 1) v on true
       join workflow_definition d on d.id = v.definition_id`,
    [tenant],
  );
};

/**
 * Two steps per approval, as an instance's steps are copied from its version.
 *
 * A running approval has its first step approved and its second awaiting — the shape the queue read
 * is about, and the shape the partial unique index constrains to exactly one per approval. A
 * cancelled approval's steps are skipped rather than left pending, because a step still reading
 * "pending" on a finished approval is a queue entry waiting to be misread as work somebody owes.
 */
const seedSteps = async (admin, tenant) => {
  await admin.query(
    `insert into workflow_step
       (id, tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, i.id, t.ordinal, 'membership',
            ${membership(tenant, `1 + ((${NUMBER_OF} + t.ordinal) % ${String(APPROVERS)})`)},
            case
              when i.status = 'cancelled' then 'skipped'
              when i.status = 'running' and t.ordinal = 1 then 'approved'
              when i.status = 'running' then 'awaiting'
              when i.status = 'rejected' and t.ordinal = 2 then 'skipped'
              when i.status = 'rejected' then 'rejected'
              else 'approved'
            end,
            '{}'::jsonb, ${AUDIT}
       from workflow_instance i
       cross join generate_series(1, ${String(STEPS_PER_VERSION)}) as t(ordinal)
      where i.tenant_id = $1`,
    [tenant],
  );
};

/**
 * A decision for every step somebody actually answered, and a timeline entry for every event.
 *
 * A skipped step gets no decision, because nobody answered it — a fixture that wrote one would make
 * the decision table say a cancelled approval was decided. One decision in twelve is delegated and
 * carries a second membership that is genuinely a different person: the self-delegation constraint
 * refuses a row where the two are equal, here exactly as in production.
 */
const seedRecords = async (admin, tenant) => {
  await admin.query(
    `insert into workflow_decision
       (id, tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
        on_behalf_of_membership_id, decided_at, comment, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, s.instance_id, s.id,
            case when s.status = 'rejected' then 'rejected' else 'approved' end,
            case when g.delegated
                 then ${membership(tenant, `${String(APPROVERS)} + 1`)}
                 else s.approver_membership_id end,
            case when g.delegated then 'delegated' else 'assigned' end,
            case when g.delegated then s.approver_membership_id end,
            i.started_at + interval '1 hour',
            case when s.status = 'rejected' then 'Not budgeted this quarter' end,
            '{}'::jsonb, ${AUDIT}
       from workflow_step s
       join workflow_instance i on i.id = s.instance_id
       cross join lateral (select (${NUMBER_OF} % 12) = 0 as delegated) g
      where s.tenant_id = $1 and s.status in ('approved', 'rejected')`,
    [tenant],
  );
  await admin.query(
    `insert into workflow_history
       (id, tenant_id, instance_id, event, occurred_at, step_id, ordinal, actor_membership_id,
        on_behalf_of_membership_id, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, i.id, 'instance-started', i.started_at, null, null,
            i.requested_by_membership_id, null, '{}'::jsonb, ${AUDIT}
       from workflow_instance i where i.tenant_id = $1`,
    [tenant],
  );
  // One entry per step, half an hour after the approval began, so the timeline of one approval is
  // genuinely ordered rather than sharing a single instant across every row.
  await admin.query(
    `insert into workflow_history
       (id, tenant_id, instance_id, event, occurred_at, step_id, ordinal, actor_membership_id,
        on_behalf_of_membership_id, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, s.instance_id,
            case s.status
              when 'awaiting' then 'step-awaiting'
              when 'approved' then 'step-approved'
              when 'rejected' then 'step-rejected'
              else 'step-skipped'
            end,
            i.started_at + (s.ordinal * interval '30 minutes'), s.id, s.ordinal,
            case when s.status = 'awaiting' then null else s.approver_membership_id end,
            null, '{}'::jsonb, ${AUDIT}
       from workflow_step s
       join workflow_instance i on i.id = s.instance_id
      where s.tenant_id = $1`,
    [tenant],
  );
};

/** The identifiers the measurements read, chosen once so no measurement times a lookup first. */
const handles = async (admin, tenant) => {
  const { rows } = await admin.query(
    `select
       (select id from workflow_definition where tenant_id = $1 order by code limit 1) as definition,
       (select v.id from workflow_version v join workflow_definition d on d.id = v.definition_id
         where v.tenant_id = $1 and v.status = 'published' order by d.code limit 1) as version,
       (select id from workflow_instance where tenant_id = $1 and status = 'running'
         order by subject_id limit 1) as running,
       (select id from workflow_instance where tenant_id = $1 and status = 'completed'
         order by subject_id limit 1) as finished,
       (select subject_id from workflow_instance where tenant_id = $1 and status = 'running'
         order by subject_id limit 1) as subject,
       (select subject_type from workflow_instance where tenant_id = $1 and status = 'running'
         order by subject_id limit 1) as subjecttype`,
    [tenant],
  );
  const approver = await admin.query(
    `select approver_membership_id from workflow_step
      where tenant_id = $1 and status = 'awaiting'
      group by approver_membership_id order by count(*) desc, approver_membership_id limit 1`,
    [tenant],
  );
  const decider = await admin.query(
    `select decided_by_membership_id from workflow_decision
      where tenant_id = $1 and authority = 'assigned'
      group by decided_by_membership_id order by count(*) desc, decided_by_membership_id limit 1`,
    [tenant],
  );
  const cohort = await admin.query(
    `select subject_id from workflow_instance where tenant_id = $1 order by subject_id limit 200`,
    [tenant],
  );
  // Every group, so `membersOfAll` can be asked the question it exists for — all forty at once —
  // rather than a handful that would not tell one statement apart from a few.
  const groups = await admin.query(
    `select id, code from workflow_approval_group where tenant_id = $1 order by code`,
    [tenant],
  );
  // A branch: an approval with three steps awaiting at one position, and one of the three approvers.
  const branch = await admin.query(
    `select s.instance_id, s.approver_membership_id, s.source_group_id
       from workflow_step s
      where s.tenant_id = $1 and s.status = 'awaiting' and s.branch_rule is not null
      order by s.instance_id, s.approver_membership_id limit 1`,
    [tenant],
  );

  return {
    ...rows[0],
    approver: approver.rows[0]?.approver_membership_id,
    decider: decider.rows[0]?.decided_by_membership_id,
    cohort: cohort.rows.map((row) => row.subject_id),
    group: groups.rows[0]?.id,
    groupCode: groups.rows[0]?.code,
    groupIds: groups.rows.map((row) => row.id),
    branchInstance: branch.rows[0]?.instance_id,
    branchApprover: branch.rows[0]?.approver_membership_id,
  };
};
