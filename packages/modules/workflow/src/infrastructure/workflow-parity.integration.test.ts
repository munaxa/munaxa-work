import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVAL_DECISIONS,
  APPROVER_KINDS,
  DECISION_AUTHORITIES,
  WORKFLOW_DEFINITION_STATUSES,
  WORKFLOW_HISTORY_EVENTS,
  WORKFLOW_INSTANCE_STATUSES,
  WORKFLOW_INSTANCE_TRANSITIONS,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_STEP_TRANSITIONS,
  WORKFLOW_VERSION_STATUSES,
  isPositiveWhole,
  isSubjectType,
} from '../domain/workflow-vocabulary.js';
import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The domain and the database, checked against each other by machine.
 *
 * Two lifecycle definitions are one too many. The domain's transition tables and the schema's check
 * constraints are written in different languages by different hands, and the failure they produce
 * when they drift is the worst kind: a state the application believes is legal and the database
 * refuses, discovered by a customer rather than by a test.
 *
 * So the constraint text is **parsed out of `pg_constraint` and compared to the exported
 * vocabulary**, rather than a second list of strings being typed here. A value added to one side and
 * not the other fails this suite, which is the only place that comparison is made.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's parity suite");

/**
 * The literals a check constraint enumerates, in the order PostgreSQL prints them.
 *
 * Both renderings are matched, because PostgreSQL uses two. A multi-value `in (...)` becomes
 * `= ANY (ARRAY['a'::character varying, ...])`, and a **single**-value one collapses to
 * `= 'a'::text` — so a parser that only knew the array form would read the one-value vocabularies
 * (`approver_kind`, today) as empty and report parity with a list that has nothing in it.
 */
const enumerated = (definition: string): string[] =>
  [...definition.matchAll(/'([^']+)'::(?:character varying|text)/g)].map((match) => match[1] ?? '');

suite('domain and schema parity', () => {
  let fixture: WorkflowFixture;
  let constraints: Record<string, string>;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_parity_role');

    const { rows } = await fixture.admin.query<{ conname: string; definition: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as definition
         from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname like 'workflow%' and c.contype = 'c'`,
    );

    constraints = Object.fromEntries(rows.map((row) => [row.conname, row.definition]));
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const parity = [
    ['workflow_definition_status_check', WORKFLOW_DEFINITION_STATUSES],
    ['workflow_version_status_check', WORKFLOW_VERSION_STATUSES],
    ['workflow_instance_status_check', WORKFLOW_INSTANCE_STATUSES],
    ['workflow_step_status_check', WORKFLOW_STEP_STATUSES],
    ['workflow_decision_kind_check', APPROVAL_DECISIONS],
    ['workflow_decision_authority_check', DECISION_AUTHORITIES],
    /**
     * **The two approver-kind constraints are deliberately different, and that is the design.**
     *
     * A *template* may name either kind: a person, or a group. A *step* of a running instance never
     * names a group, because the group was resolved into its members before the row existed — so at
     * the moment somebody is actually asked there is only ever a person, and the step's constraint
     * stays at the single value it has had since 16A.
     *
     * Comparing the step's constraint against the whole vocabulary would demand it widen to admit a
     * kind no step can ever hold, which is how a parity check turns into pressure to weaken a
     * constraint. It is compared against what it is supposed to enumerate instead.
     */
    ['workflow_step_approver_kind_check', ['membership']],
    ['workflow_step_template_approver_kind_check', APPROVER_KINDS],
    ['workflow_history_event_check', WORKFLOW_HISTORY_EVENTS],
  ] as const;

  for (const [constraint, vocabulary] of parity) {
    it(`${constraint} enumerates exactly the domain's vocabulary`, () => {
      const definition = constraints[constraint];

      expect([constraint, definition === undefined]).toStrictEqual([constraint, false]);
      expect(enumerated(definition ?? '').sort()).toStrictEqual([...vocabulary].sort());
    });
  }

  it('accepts every state the domain declares and refuses one it does not', async () => {
    const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);
      const set = (status: string): Promise<string> =>
        probe(client, `update workflow_step set status = $1 where id = $2`, [
          status,
          seeded.stepIds[0],
        ]);
      const accepted: string[] = [];

      for (const status of WORKFLOW_STEP_STATUSES) accepted.push(await set(status));
      return { accepted, invented: await set('deferred') };
    });

    expect(outcomes.accepted).toStrictEqual(WORKFLOW_STEP_STATUSES.map(() => 'accepted'));
    expect(outcomes.invented).toContain('workflow_step_status_check');
  });

  it('leaves every transition the domain permits representable', () => {
    // The schema stores a state and does not police the path between two of them: enforcing a
    // transition table in SQL would be a second lifecycle definition, which is the drift this suite
    // exists to prevent. What is asserted is that each *target* is a state the column accepts.
    const targets = new Set(
      [...Object.values(WORKFLOW_STEP_TRANSITIONS), ...Object.values(WORKFLOW_INSTANCE_TRANSITIONS)]
        .flat()
        .map(String),
    );
    const permitted = [
      ...enumerated(constraints['workflow_step_status_check'] ?? ''),
      ...enumerated(constraints['workflow_instance_status_check'] ?? ''),
    ];

    expect([...targets].filter((target) => !permitted.includes(target))).toStrictEqual([]);
  });

  it('shares one subject-type rule with the domain, on both tables that carry one', async () => {
    const cases = [
      ['recruitment.requisition', true],
      ['a-module-nobody-has-written.a-subject', true],
      ['norealsubject', false],
      ['Recruitment.Requisition', false],
      ['recruitment..requisition', false],
    ] as const;

    for (const [value, legal] of cases) {
      expect([value, isSubjectType(value)]).toStrictEqual([value, legal]);

      const written = await fixture.asTenant(TENANT_A, (client) =>
        probe(
          client,
          `insert into workflow_definition (tenant_id, code, name, subject_type, status,
             ${AUDIT_COLUMNS})
           values ($1, 'probe', '{"en":"x","ar":"x"}'::jsonb, $2, 'active', ${AUDIT_VALUES})`,
          [TENANT_A, value],
        ),
      );

      expect([value, written === 'accepted']).toStrictEqual([value, legal]);
      await fixture.truncate();
    }
  });

  it('shares the ordinal rule with the domain: bounded below, and not above', async () => {
    expect([isPositiveWhole(0), isPositiveWhole(1), isPositiveWhole(2_147_483_000)]).toStrictEqual([
      false,
      true,
      true,
    ]);

    const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedDefinition(client, TENANT_A);
      const add = (ordinal: number): Promise<string> =>
        probe(
          client,
          `insert into workflow_step_template
             (tenant_id, workflow_version_id, ordinal, name, approver_kind,
              approver_membership_id, ${AUDIT_COLUMNS})
           values ($1, $2, $3, '{"en":"x","ar":"x"}'::jsonb, 'membership', $4, ${AUDIT_VALUES})`,
          [TENANT_A, seeded.workflowVersionId, ordinal, SECOND_APPROVER],
        );

      return { zero: await add(0), high: await add(2_147_483_000) };
    });

    expect(outcomes.zero).toContain('workflow_step_template_ordinal_check');
    // AD-004: no hardcoded approval limit. A `smallint` column would have refused this.
    expect(outcomes.high).toBe('accepted');
  });

  it('enforces the domain’s delegation coherence rule at the table too', async () => {
    // `authorityIsCoherent` refuses these three in the domain. The check constraint refuses the two
    // that are properties of one row; the third — naming an approver other than the step's — needs
    // another table and stays the application's, which this asserts rather than assumes.
    const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);
      const write = (authority: string, onBehalfOf: string | null, by: string): Promise<string> =>
        probe(
          client,
          `insert into workflow_decision
             (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
              on_behalf_of_membership_id, decided_at, ${AUDIT_COLUMNS})
           values ($1, $2, $3, 'approved', $4, $5, $6, now(), ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, seeded.stepIds[0], by, authority, onBehalfOf],
        );

      return {
        delegatedNamingNobody: await write('delegated', null, SECOND_APPROVER),
        assignedNamingSomebody: await write('assigned', APPROVER, APPROVER),
        delegatedToSelf: await write('delegated', APPROVER, APPROVER),
      };
    });

    expect(outcomes.delegatedNamingNobody).toContain('workflow_decision_delegation_check');
    expect(outcomes.assignedNamingSomebody).toContain('workflow_decision_delegation_check');
    expect(outcomes.delegatedToSelf).toContain('workflow_decision_self_delegation_check');
  });

  it('keeps the transition metadata nullable exactly where the domain says it is optional', async () => {
    const { rows } = await fixture.admin.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
    }>(
      `select table_name, column_name, is_nullable from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in
              (('workflow_definition', 'retired_at'), ('workflow_version', 'published_at'),
               ('workflow_instance', 'completed_at'), ('workflow_instance', 'cancelled_by'),
               ('workflow_decision', 'on_behalf_of_membership_id'),
               ('workflow_decision', 'comment'), ('workflow_history', 'step_id'),
               ('workflow_history', 'actor_membership_id'),
               ('workflow_instance', 'started_at'), ('workflow_decision', 'decided_at'))
        order by table_name, column_name`,
    );
    const nullable = Object.fromEntries(
      rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable === 'YES']),
    );

    // Optional in the domain, nullable here.
    for (const column of [
      'workflow_definition.retired_at',
      'workflow_version.published_at',
      'workflow_instance.completed_at',
      'workflow_instance.cancelled_by',
      'workflow_decision.on_behalf_of_membership_id',
      'workflow_decision.comment',
      'workflow_history.step_id',
      'workflow_history.actor_membership_id',
    ]) {
      expect([column, nullable[column]]).toStrictEqual([column, true]);
    }
    // Required in the domain, not nullable here.
    for (const column of ['workflow_instance.started_at', 'workflow_decision.decided_at']) {
      expect([column, nullable[column]]).toStrictEqual([column, false]);
    }
  });
});
