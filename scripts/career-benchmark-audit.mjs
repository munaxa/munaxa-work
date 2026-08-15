/**
 * What the benchmark asserts rather than measures: that the role is unprivileged, that row-level
 * security is on and forced on all twelve tables, that neither tenant can reach the other's rows
 * *or* their totals, and that Career's exact values survive the production repository.
 *
 * Split from `measure-career-performance.mjs` at the file-size budget. The division is a real one:
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
 * Row-level security **enabled and forced** on every Career table.
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

  if (rows.length !== tables.length) {
    throw new Error(`Expected ${String(tables.length)} tables, found ${String(rows.length)}.`);
  }
  if (unprotected.length > 0) {
    throw new Error(
      `RLS not enabled and forced on: ${unprotected.map((row) => row.relname).join(', ')}.`,
    );
  }
  console.log(`Row-level security enabled and forced on all ${String(rows.length)} Career tables.`);
};

/**
 * No Career table reaches into another module through a foreign key.
 *
 * Career stores an employment, a position, a unit and a learning assignment as **bare identifiers**
 * with no constraint behind them (ADR-0023): a foreign key across a module boundary is a coupling
 * the modular monolith exists to prevent, and it would make one module's migration another's
 * outage. Asserted here because it is exactly the kind of thing an ORM adds back helpfully.
 */
export const assertNoCrossModuleForeignKeys = async (admin, tables) => {
  const { rows } = await admin.query(
    `select tc.table_name as child, ccu.table_name as parent, tc.constraint_name as name
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_name = any($1::text[])`,
    [tables],
  );
  const escaping = rows.filter((row) => !row.parent.startsWith('career_'));

  if (escaping.length > 0) {
    throw new Error(
      `Career foreign keys reach outside the module: ${escaping
        .map((row) => `${row.child}.${row.name} → ${row.parent}`)
        .join(', ')}.`,
    );
  }
  console.log(
    `Foreign keys: ${String(rows.length)} within Career, 0 crossing into another module.`,
  );
};

/**
 * Neither tenant sees the other's rows **or the other's totals**, at every tier.
 *
 * Asserted on the counts as well as the pages: a count computed without the tenant predicate
 * discloses how many people sit on a succession bench elsewhere even when no row comes back, and in
 * this module that number is itself the sensitive fact.
 *
 * The neighbour is seeded at the same volume, so an empty answer here is a policy excluding a
 * hundred thousand rows rather than a database that had nothing to exclude.
 */
export const assertIsolation = async (stores, asTenant, other, seeded) => {
  const mine = seeded.people[0];
  const bench = seeded.succession.find((plan) => plan.status === 'active');
  const checks = await asTenant(other, async (transaction) => ({
    plans: await stores.plans.search(transaction, { employmentId: mine }, PAGE),
    memberships: await stores.memberships.search(transaction, { employmentId: mine }, PAGE),
    successors: await stores.successors.search(transaction, { employmentId: mine }, PAGE),
    assessments: await stores.assessments.search(transaction, { employmentId: mine }, PAGE),
    development: await stores.developmentPlans.search(transaction, { employmentId: mine }, PAGE),
    mobility: await stores.mobility.search(transaction, { employmentId: mine }, PAGE),
    // The exact identifier, which is the read a caller who guessed one would make.
    benchById: await stores.successionPlans.byId(transaction, bench.successionPlanId),
    // And the counts on that bench, which must not answer for somebody else's plan.
    benchCounts: await stores.successors.benchCountsOf(transaction, bench.successionPlanId),
  }));

  for (const [name, page] of Object.entries(checks)) {
    if (name === 'benchById') {
      if (page !== undefined) throw new Error(`Tenant isolation broken: ${other} read a bench.`);
      continue;
    }
    if (name === 'benchCounts') {
      if (page.nominated !== 0 || page.confirmed !== 0) {
        throw new Error(
          `Tenant isolation broken: bench counts leaked ${String(page.nominated)}/${String(page.confirmed)}.`,
        );
      }
      continue;
    }
    if (page.items.length !== 0 || page.total !== 0) {
      throw new Error(
        `Tenant isolation broken: ${other} saw ${String(page.items.length)} ${name} ` +
          `and a total of ${String(page.total)}.`,
      );
    }
  }
  console.log(`Isolation: ${other} sees 0 rows and a total of 0 across all six searches.`);
};

/**
 * Career's exact values survive the production repository, at every tier.
 *
 * There is no decimal in this module to lose a trailing zero from — no `numeric`, no `double
 * precision`, no money column (ADR-0074). What is at risk is the pair of properties Career actually
 * has: a **small ordered integer** a human chose, and a **civil date** that is the same day in every
 * time zone. Both are read back through the real row mappers rather than through raw SQL, because
 * the mapper is where a `Number()` or a `new Date()` would be introduced.
 */
export const assertExactValues = async (stores, asTenant, tenantId, seeded) => {
  const [successor] = seeded.successors;
  const read = await asTenant(tenantId, async (transaction) => ({
    successor: await stores.successors.byId(transaction, successor.successorId),
    stages: await stores.paths.stagesFor(transaction, seeded.paths[0].pathId),
    level: await stores.readinessLevels.byId(transaction, seeded.levels[4].readinessLevelId),
  }));

  if (read.successor.rank !== successor.rank || !Number.isInteger(read.successor.rank)) {
    throw new Error(
      `Rank changed in the repository: wrote ${String(successor.rank)}, read ${String(read.successor.rank)}.`,
    );
  }
  if (read.level.ordinal !== 5 || !Number.isInteger(read.level.ordinal)) {
    throw new Error(`Ordinal changed in the repository: read ${String(read.level.ordinal)}.`);
  }
  for (const stage of read.stages) {
    if (!Number.isInteger(stage.sequence)) {
      throw new Error(`Stage sequence is not an integer: ${String(stage.sequence)}.`);
    }
  }
  // The civil date, byte for byte. `2026-02-28` is the case a `Date` round trip shifts west of UTC.
  if (read.successor.nominatedOn !== '2026-02-28') {
    throw new Error(`Civil date changed: read ${String(read.successor.nominatedOn)}.`);
  }
  if (typeof read.successor.nominatedOn !== 'string') {
    throw new Error('A civil date left the repository as something other than a string.');
  }
  console.log(
    `Exactness: rank ${String(read.successor.rank)}, ordinal 5 and the civil date 2026-02-28 all survived the repository.`,
  );
};

/**
 * The plan of every read the benchmark measured, printed rather than summarized.
 *
 * Run with `--plans`. **The statements are captured from the repositories rather than rewritten
 * here.** A hand-written equivalent would produce a plan for a query nobody runs — the wrong alias,
 * a missing tenant predicate, a different `order by` — which is how a benchmark comes to report an
 * index the real read cannot reach. So the transaction is wrapped, the repository is asked to do its
 * work, every statement it issues is recorded with its parameters, and each is then explained
 * exactly as issued.
 *
 * The wrapper records and forwards; it changes nothing. What is explained is what ran.
 */
export const explain = async (asTenant, stores, tenantId, asOf, seeded) => {
  const captured = await capture(asTenant, stores, tenantId, asOf, seeded);

  for (const [name, statements] of captured) {
    console.log(`\n  ${name} — ${String(statements.length)} statement(s)`);
    for (const { sql, parameters } of statements) {
      const { rows } = await explainOne(asTenant, tenantId, sql, parameters);

      console.log(`    ${sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
      for (const row of rows) console.log(`      ${row}`);
    }
  }
};

/**
 * The reads whose plans matter, each run once with its statements recorded.
 *
 * Chosen because each is a different shape: a status-filtered page, an as-of range, a page over a
 * foreign identifier, a counting aggregate, an ordered history and a cohort read. Between them they
 * reach every index the module declares, and each carries the count that accompanies its page —
 * which is the query most likely to differ from the listing it belongs to.
 */
const capture = async (asTenant, stores, tenantId, asOf, seeded) => {
  const active = seeded.succession.find((plan) => plan.status === 'active');
  const person = seeded.successors[0].employmentId;
  const reads = [
    [
      'succession listing (active)',
      (tx) => stores.successionPlans.search(tx, { status: 'active' }, PAGE),
    ],
    [
      'succession, review due by a day',
      (tx) => stores.successionPlans.search(tx, { status: 'active', reviewOnOrBefore: asOf }, PAGE),
    ],
    ['successors for one plan', (tx) => stores.successors.forPlan(tx, active.successionPlanId)],
    [
      'bench strength for one plan',
      (tx) => stores.successors.benchCountsOf(tx, active.successionPlanId),
    ],
    [
      'pool membership as-of a day',
      (tx) => stores.memberships.search(tx, { inForceOn: asOf }, PAGE),
    ],
    [
      'development items due by a day',
      (tx) =>
        stores.developmentItems.search(tx, { status: 'planned', targetOnOrBefore: asOf }, PAGE),
    ],
    ['readiness history, one person', (tx) => stores.assessments.historyFor(tx, person)],
    [
      'cohort: career plans (200)',
      (tx) => stores.plans.search(tx, { employmentIdsIn: seeded.people.slice(0, 200) }, PAGE),
    ],
  ];
  const captured = [];

  for (const [name, read] of reads) {
    const statements = [];

    await asTenant(tenantId, (transaction) =>
      read({
        tenantId: transaction.tenantId,
        collect: (events) => transaction.collect(events),
        execute: async (sql, parameters) => {
          statements.push({ sql, parameters: parameters ?? [] });
          return transaction.execute(sql, parameters);
        },
      }),
    );
    captured.push([name, statements]);
  }
  return captured;
};

/** One statement, explained inside a tenant's row-security context, exactly as the repository ran it. */
const explainOne = async (asTenant, tenantId, sql, parameters) =>
  asTenant(tenantId, async (transaction) => {
    const rows = await transaction.execute(
      `explain (analyze, buffers, format text) ${sql}`,
      parameters,
    );

    return { rows: rows.map((row) => row['QUERY PLAN']) };
  });
