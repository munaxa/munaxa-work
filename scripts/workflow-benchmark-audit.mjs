/**
 * What the Workflow benchmark asserts rather than measures.
 *
 * Split from `measure-workflow-performance.mjs` at the file-size budget, along a real seam: next
 * door answers "how fast", and this answers "and was it measuring what it claimed to". A benchmark
 * run as a superuser, or against a database holding one tenant, produces plausible figures for a
 * configuration production does not have — these are the checks that stop it.
 *
 * Every one of them **throws**. A benchmark that printed a warning and carried on would leave
 * numbers in a report with nothing behind them.
 *
 * Everything the caller owns — the pool, the role, the tenants, the page — arrives as a parameter
 * rather than being closed over, which is what lets these run against a different fixture without
 * the two files having to agree on a module-level variable neither of them names.
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
 * Row-level security enabled **and forced**, with exactly one policy per table.
 *
 * `relforcerowsecurity` matters as much as `relrowsecurity`: without it a table's owner is exempt
 * from its own policies. And the policy count matters because PostgreSQL **ORs** permissive policies
 * together — a second permissive policy on any of these tables would widen access rather than narrow
 * it, so "one policy" is a security property and not tidiness.
 */
export const assertRowLevelSecurityForced = async (admin, tables) => {
  const { rows } = await admin.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
            p.polname, p.polcmd, p.polpermissive,
            pg_get_expr(p.polqual, p.polrelid) as using_expr,
            pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
            (select count(*) from pg_policy x where x.polrelid = c.oid) as policies,
            p.polroles::text as roles
       from pg_class c
       left join pg_policy p on p.polrelid = c.oid
      where c.relname = any($1::text[]) and c.relkind = 'r' order by c.relname`,
    [tables],
  );

  if (rows.length !== tables.length) {
    throw new Error(`Expected ${String(tables.length)} tables, found ${String(rows.length)}.`);
  }
  const expected = '(tenant_id = app_current_tenant())';

  for (const row of rows) {
    const faults = [];

    if (!row.relrowsecurity) faults.push('row security not enabled');
    if (!row.relforcerowsecurity) faults.push('row security not forced');
    if (Number(row.policies) !== 1) faults.push(`${String(row.policies)} policies, expected 1`);
    if (row.polname !== 'tenant_isolation') faults.push(`policy named ${String(row.polname)}`);
    // `*` is `ALL`. A policy scoped to `SELECT` alone would leave writes unconstrained.
    if (row.polcmd !== '*') faults.push(`policy is ${String(row.polcmd)}, expected ALL`);
    if (!row.polpermissive) faults.push('policy is restrictive');
    // PostgreSQL stores `PUBLIC` as the pseudo-role oid 0, so `{0}` is the whole-world grant and
    // anything else is a policy scoped to named roles — which somebody could sidestep by connecting
    // as a different one.
    if (row.roles !== '{0}')
      faults.push(`policy applies to roles ${String(row.roles)}, expected PUBLIC`);
    if (row.using_expr !== expected) faults.push(`using ${String(row.using_expr)}`);
    if (row.check_expr !== expected) faults.push(`with check ${String(row.check_expr)}`);

    if (faults.length > 0) throw new Error(`${row.relname}: ${faults.join('; ')}.`);
  }
  console.log(
    `Row-level security enabled and forced on all ${String(rows.length)} Workflow tables, ` +
      `one permissive ALL policy each, PUBLIC, on (tenant_id = app_current_tenant()).`,
  );
};

/**
 * No Workflow table reaches into another module through a foreign key.
 *
 * Workflow stores a membership and a subject as **bare identifiers** with no constraint behind them
 * (ADR-0023, AD-001): a foreign key across a module boundary is the coupling the modular monolith
 * exists to prevent, and here it would additionally mean Workflow knew what a requisition was.
 */
export const assertNoCrossModuleForeignKeys = async (admin, tables) => {
  const { rows } = await admin.query(
    `select t.relname as child, p.relname as parent, c.conname as name
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class p on p.oid = c.confrelid
      where c.contype = 'f' and (t.relname = any($1::text[]) or p.relname = any($1::text[]))
      order by 1, 3`,
    [tables],
  );
  const leaving = rows.filter((row) => !tables.includes(row.child) || !tables.includes(row.parent));

  if (leaving.length > 0) {
    throw new Error(
      `Foreign keys cross the Workflow boundary: ${leaving
        .map((row) => `${row.child}→${row.parent} (${row.name})`)
        .join(', ')}.`,
    );
  }
  console.log(
    `${String(rows.length)} foreign keys, all of them inside Workflow; none leaves the module.`,
  );
};

/**
 * Every closed vocabulary the domain declares is the set the database enforces.
 *
 * The domain refusing a value the column would accept is a gap somebody reaches through a repair
 * script; the column refusing one the domain allows is an outage the first time that state is
 * reached. Checked by parsing the check constraint rather than by trusting a comment.
 */
export const assertVocabularyParity = async (admin, vocabularies) => {
  for (const [constraint, label, expected] of vocabularies) {
    // Named rather than pattern-matched. `workflow_version` carries two check constraints that
    // mention `status`, and a search would have found the publication-origin rule as well as the
    // vocabulary — then compared the domain's list against the wrong one.
    const { rows } = await admin.query(
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c where c.contype = 'c' and c.conname = $1`,
      [constraint],
    );

    if (rows.length !== 1) {
      throw new Error(`${constraint}: expected exactly one check constraint by that name.`);
    }
    /**
     * The literals in the constraint, in **both** of the shapes PostgreSQL renders.
     *
     * A vocabulary of several values comes back as `= ANY (ARRAY['a'::character varying, …])`, and
     * one of a single value comes back as `= 'a'::text` — no array and no cast to the column's own
     * type. A pattern that knew only the first found nothing in the second and reported the domain's
     * only value as missing, which is what `workflow_step_approver_kind_check` did: a running step
     * names a person and never a list, so its vocabulary is one word long.
     */
    const found = [...rows[0].definition.matchAll(/'([a-z-]+)'::(?:character varying|text)/g)].map(
      (match) => match[1],
    );
    const missing = expected.filter((value) => !found.includes(value));
    const extra = found.filter((value) => !expected.includes(value));

    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `${label} disagrees with the domain (${constraint}): missing ${missing.join(',') || 'none'}, ` +
          `extra ${extra.join(',') || 'none'}.`,
      );
    }
  }
  console.log(
    `${String(vocabularies.length)} closed vocabularies match their database check constraints exactly.`,
  );
};

/** Workflow stores no inexact number and no civil date. Asserted against the catalogue, not a memo. */
export const assertNoInexactColumns = async (admin, tables) => {
  const { rows } = await admin.query(
    `select table_name, column_name, data_type from information_schema.columns
      where table_name = any($1::text[])
        and data_type in ('numeric','real','double precision','bigint','money','date')`,
    [tables],
  );

  if (rows.length > 0) {
    throw new Error(
      `Inexact or civil-date columns present: ${rows
        .map((row) => `${row.table_name}.${row.column_name} ${row.data_type}`)
        .join(', ')}.`,
    );
  }
  const { rows: kinds } = await admin.query(
    `select distinct data_type from information_schema.columns
      where table_name = any($1::text[]) order by 1`,
    [tables],
  );

  console.log(
    `No numeric, real, double precision, bigint, money or date column in Workflow. ` +
      `Types used: ${kinds.map((row) => row.data_type).join(', ')}.`,
  );
};

/**
 * The reads whose plans matter, each run once with its statements recorded.
 *
 * Captured from the **production repositories** by wrapping the transaction's `execute`, so what is
 * explained is the SQL the repository actually issued — parameters and all. Retyping the query next
 * to the benchmark would explain a statement nobody runs, which is the failure mode this exists to
 * avoid.
 */
export const explain = async (asTenant, stores, tenant, mine) => {
  for (const [name, read] of planned(stores, mine)) {
    const statements = [];

    await asTenant(tenant, (transaction) =>
      read({
        tenantId: transaction.tenantId,
        collect: (events) => transaction.collect(events),
        execute: async (sql, parameters) => {
          statements.push({ sql, parameters: parameters ?? [] });
          return transaction.execute(sql, parameters);
        },
      }),
    );

    console.log(`\n  ${name} — ${String(statements.length)} statement(s)`);
    for (const { sql, parameters } of statements) {
      const rows = await asTenant(tenant, (transaction) =>
        transaction.execute(`explain (analyze, buffers, format text) ${sql}`, parameters),
      );

      console.log(`    ${sql.replace(/\s+/g, ' ').trim().slice(0, 150)}`);
      for (const row of rows) console.log(`      ${row['QUERY PLAN']}`);
    }
  }
};

/**
 * Eight shapes, chosen because each is a different one.
 *
 * A queue over a partial index, an ordered history, a status-filtered page, a subject lookup, a
 * uniqueness probe, a published-version choice, a decided listing and a definition page. Between
 * them they reach every index a critical read depends on, and each listing carries the count that
 * accompanies it — the query most likely to differ from the page it belongs to.
 */
const planned = (stores, mine) => [
  // Phase 16B. A group page ordered by code, the members of one list, and the single statement that
  // resolves every list at once — the read a branched approval start would otherwise make per group.
  ['approval group listing', (tx) => stores.groups.search(tx, PAGE)],
  ['members of one group', (tx) => stores.groups.membersOf(tx, mine.group)],
  ['members of every group at once', (tx) => stores.groups.membersOfAll(tx, mine.groupIds)],
  ['queue for a branch approver', (tx) => stores.steps.awaitingFor(tx, mine.branchApprover, PAGE)],
  ['pending queue for one member', (tx) => stores.steps.awaitingFor(tx, mine.approver, PAGE)],
  ['decided approvals for one member', (tx) => stores.decisions.decidedBy(tx, mine.decider, PAGE)],
  [
    'instances by subject',
    (tx) =>
      stores.instances.search(tx, { subjectType: mine.subjecttype, subjectId: mine.subject }, PAGE),
  ],
  ['running instances', (tx) => stores.instances.search(tx, { status: 'running' }, PAGE)],
  [
    'open approval for a subject (uniqueness probe)',
    (tx) => stores.instances.openForSubject(tx, mine.subjecttype, mine.subject),
  ],
  ['timeline for one approval', (tx) => stores.history.forInstance(tx, mine.running, PAGE)],
  ['current published version', (tx) => stores.versions.currentPublished(tx, mine.definition)],
  [
    'definition listing (active)',
    (tx) => stores.definitions.search(tx, { status: 'active' }, PAGE),
  ],
];

/**
 * And the **statistics** removed, which `truncate` and `vacuum analyze` between them do not do.
 *
 * `vacuum analyze` on an emptied table sets `reltuples` to zero and leaves the per-column histograms
 * in `pg_statistic` exactly as this fixture wrote them: an empty table gives `ANALYZE` nothing with
 * which to replace them. The repository's plan suite then plans a five-row fixture against a hundred
 * thousand rows' worth of selectivity and watches PostgreSQL choose a different — and equally
 * correct — index from the one it names.
 *
 * That is what happened during the Phase 16B audit, exactly as this file's header warned it would.
 * The header's remedy was to re-migrate a fresh database; deleting the nine tables' statistics is
 * the same restoration without dropping anything, so the benchmark now cleans up after itself.
 *
 * It needs a superuser and says so rather than failing when it is not one: the run's *figures* do
 * not depend on this, only the next suite's plans do.
 */
export const forgetStatistics = async (admin, tables) => {
  try {
    const relations = tables.map((table) => `'${table}'::regclass`).join(', ');

    await admin.query(`delete from pg_statistic where starelid in (${relations})`);
    return ' and its planner statistics with it';
  } catch {
    return ' — but its planner statistics remain; re-migrate a fresh database before the plan suites';
  }
};
