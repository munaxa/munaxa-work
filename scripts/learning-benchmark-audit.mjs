/**
 * What the benchmark asserts rather than measures: that the role is unprivileged, that row-level
 * security is on and forced, that neither tenant can reach the other, and that an exact mark
 * survives the production repository.
 *
 * Split from `measure-learning-performance.mjs` at the file-size budget. The division is a real one:
 * next door answers "how fast", and this answers "and was it measuring what it claimed to". A
 * benchmark run as a superuser, or against a database holding one tenant, produces plausible figures
 * for a configuration production does not have — these are the checks that stop it.
 *
 * Every one of them **throws**. A benchmark that printed a warning and carried on would leave
 * numbers in a report with nothing behind them.
 *
 * Everything the caller owns — the pool, the role, the two tenant identifiers, the page — arrives as
 * a parameter rather than being closed over. That is what lets these run against a different fixture
 * without the two files having to agree on a module-level variable neither of them names.
 */

const PAGE = { limit: 50, offset: 0 };

/**
 * The role this benchmark reads as, checked rather than assumed.
 *
 * A superuser bypasses every policy silently. A run that had quietly acquired one would print
 * plausible figures for a database with no row-level security in it at all, and the isolation
 * assertions below would pass for the wrong reason.
 */
export const assertRoleUnprivileged = async (admin, role) => {
  const { rows } = await admin.query(
    `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
    [role],
  );

  if (rows[0] === undefined) throw new Error(`The role ${role} does not exist.`);
  if (rows[0].rolsuper || rows[0].rolbypassrls) {
    throw new Error(
      `${role} is privileged: rolsuper=${rows[0].rolsuper}, rolbypassrls=${rows[0].rolbypassrls}.`,
    );
  }
  console.log(`Role ${role}: rolsuper=false, rolbypassrls=false.`);
};

/**
 * Row-level security **enabled and forced** on every Learning table.
 *
 * `relforcerowsecurity` matters as much as `relrowsecurity`: without it a table's owner is exempt
 * from its own policies, and a migration that enabled security without forcing it would leave the
 * one role most likely to be misconfigured in production reading everything.
 */
export const assertRowLevelSecurityForced = async (admin, tables) => {
  const { rows } = await admin.query(
    `select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname = any($1::text[]) and relkind = 'r' order by relname`,
    [tables],
  );
  const unprotected = rows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity);

  if (unprotected.length > 0) {
    throw new Error(
      `RLS not enabled and forced on: ${unprotected.map((row) => row.relname).join(', ')}.`,
    );
  }
  console.log(`Row-level security enabled and forced on all ${rows.length} Learning tables.`);
};

/**
 * Neither tenant sees the other's rows **or the other's totals**, at every tier.
 *
 * Asserted rather than described, and asserted on the counts as well as the pages: a count computed
 * without the tenant predicate discloses how many people are out of compliance elsewhere even when
 * no row comes back, which is a disclosure a competitor would pay for.
 *
 * The neighbour holds the same volume of the same shapes, so a policy that silently stopped applying
 * would show up here as doubled totals rather than as nothing at all.
 */
export const assertIsolation = async (stores, asTenant, other, seeded) => {
  const mine = seeded.people[0].employmentId;
  const failures = [];
  const check = (name, actual, expected) => {
    if (actual !== expected) failures.push(`${name}: expected ${expected}, saw ${actual}`);
  };

  await asTenant(other, async (tx) => {
    // The *same* employment identifier, real in this tenant's world only. A neighbour must see
    // nothing of it — not a row, and not a count.
    const assignments = await stores.assignments.search(tx, { employmentId: mine }, PAGE);
    const enrolments = await stores.enrolments.search(tx, { employmentId: mine }, PAGE);
    const certifications = await stores.certifications.search(tx, { employmentId: mine }, PAGE);

    check('neighbour assignment rows', assignments.items.length, 0);
    check('neighbour assignment total', assignments.total, 0);
    check('neighbour enrolment rows', enrolments.items.length, 0);
    check('neighbour enrolment total', enrolments.total, 0);
    check('neighbour certification rows', certifications.items.length, 0);
    check('neighbour certification total', certifications.total, 0);
    // Detail reads by identifier, which no policy predicate on a list can protect.
    check(
      'neighbour course detail',
      await stores.courses.byId(tx, seeded.courses[0].courseId),
      undefined,
    );
    check(
      'neighbour enrolment detail',
      await stores.enrolments.byId(tx, seeded.enrolments[0].enrolmentId),
      undefined,
    );
    check(
      'neighbour assessment results',
      (await stores.results.forEnrolment(tx, seeded.enrolments[0].enrolmentId)).length,
      0,
    );
    check(
      'neighbour last completion',
      await stores.enrolments.lastCompletionOf(tx, mine, seeded.courses[0].courseId),
      undefined,
    );
  });

  if (failures.length > 0) throw new Error(`Tenant isolation failed:\n  ${failures.join('\n  ')}`);
  console.log('  tenant isolation: rows, detail reads and totals all zero across the boundary.');
};

/**
 * The marks the fixture wrote, read back through the production repository.
 *
 * The end of the exactness chain the API and Admin suites cover above it. A repository that mapped
 * `raw_mark` through a number would return `18.5` here, and `999999999999.0000` would lose four
 * characters and a decimal point — each a different mark on a transcript.
 */
export const assertExactMarks = async (stores, asTenant, tenantId, seeded) => {
  const seen = new Set();

  await asTenant(tenantId, async (tx) => {
    for (const enrolment of seeded.enrolments.slice(0, 8)) {
      for (const result of await stores.results.forEnrolment(tx, enrolment.enrolmentId)) {
        if (result.rawMark !== undefined) seen.add(result.rawMark);
      }
    }
  });

  for (const exact of ['18.50', '20.00', '999999999999.0000']) {
    if (!seen.has(exact)) {
      throw new Error(`Mark ${exact} did not survive the repository. Saw: ${[...seen].join(', ')}`);
    }
  }
  console.log(
    `  exact marks: ${[...seen].sort().join(', ')} — all returned character for character.`,
  );
};

/**
 * The plans behind the reads that decide whether this module scales.
 *
 * Run as the unprivileged role with the tenant set, so the policy predicate appears in the plan
 * where production would put it. A plan captured as the owner would show a different access path.
 */
export const explain = async (application, tenantId, asOf, seeded) => {
  const client = await application.connect();

  await client.query(`select set_config('app.tenant_id', '${tenantId}', false)`);
  console.log('\n  Query plans (unprivileged role, RLS on):');

  for (const [name, sql] of plansFor(asOf, seeded)) {
    const { rows } = await client.query(`explain (analyze, costs off) ${sql}`);

    console.log(`\n  ${name}`);
    for (const row of rows) console.log(`    ${row['QUERY PLAN']}`);
  }
  client.release();
};

const plansFor = (asOf, seeded) => {
  const tenant = `tenant_id = current_setting('app.tenant_id')::uuid`;
  const person = seeded.people[0].employmentId;
  const enrolment = seeded.enrolments[0];

  return [
    [
      'compliance queue',
      `select * from learning_assignment where ${tenant} and deleted_at is null
         and status = 'assigned' order by due_on asc nulls last, id asc limit 50`,
    ],
    [
      'compliance queue count',
      `select count(*) from learning_assignment where ${tenant} and deleted_at is null
         and status = 'assigned'`,
    ],
    [
      'overdue queue',
      `select * from learning_assignment where ${tenant} and deleted_at is null
         and status = 'assigned' and due_on <= date '${asOf}'
       order by due_on asc nulls last, id asc limit 50`,
    ],
    [
      'assignments by employment',
      `select * from learning_assignment where ${tenant} and deleted_at is null
         and employment_id = '${person}' order by due_on asc nulls last, id asc limit 50`,
    ],
    [
      'expiring certificates',
      `select * from learning_certification where ${tenant} and deleted_at is null
         and status = 'active' and valid_until <= date '2026-09-30'
       order by valid_until asc nulls last, id asc limit 50`,
    ],
    [
      'last completion of a course',
      `select completed_on from learning_enrolment where ${tenant} and deleted_at is null
         and employment_id = '${enrolment.employmentId}'
         and course_id = '${enrolment.rule.courseId}' and status = 'completed'
       order by completed_on desc limit 1`,
    ],
    [
      'assessment results for one enrolment',
      `select * from learning_assessment_result where ${tenant} and deleted_at is null
         and enrolment_id = '${enrolment.enrolmentId}' order by assessed_on desc`,
    ],
  ];
};
