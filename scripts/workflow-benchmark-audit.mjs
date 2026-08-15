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
    if (row.roles !== '{0}') faults.push(`policy applies to roles ${String(row.roles)}, expected PUBLIC`);
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
  const leaving = rows.filter(
    (row) => !tables.includes(row.child) || !tables.includes(row.parent),
  );

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
    const found = [...rows[0].definition.matchAll(/'([a-z-]+)'::character varying/g)].map(
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
 * Neither tenant can reach the other's rows **or the other's totals**.
 *
 * The totals matter as much as the rows. A count computed without the tenant predicate discloses how
 * many approvals are waiting elsewhere even when no row comes back, and on an approvals screen that
 * number is itself a fact about another organization.
 *
 * The reads run through the **production repositories** in the neighbour's tenant context, asking
 * for identifiers that belong to this one — which is the shape a real cross-tenant attempt takes.
 */
export const assertIsolation = async (stores, asTenant, other, mine) => {
  const found = await asTenant(other, async (transaction) => ({
    definition: await stores.definitions.byId(transaction, mine.definition),
    version: await stores.versions.byId(transaction, mine.version),
    instance: await stores.instances.byId(transaction, mine.running),
    open: await stores.instances.openForSubject(transaction, mine.subjecttype, mine.subject),
    steps: await stores.steps.forInstance(transaction, mine.running),
    decisions: await stores.decisions.forInstance(transaction, mine.finished),
    history: await stores.history.forInstance(transaction, mine.running, PAGE),
    templates: await stores.versions.templatesFor(transaction, mine.version),
    bySubject: await stores.instances.search(
      transaction,
      { subjectType: mine.subjecttype, subjectId: mine.subject },
      PAGE,
    ),
  }));
  const leaks = [];

  // A uuid belongs to one tenant, so reading one of A's by identifier from B must find nothing.
  for (const key of ['definition', 'version', 'instance']) {
    if (found[key] !== undefined) leaks.push(`${key} readable by exact identifier`);
  }
  for (const key of ['steps', 'decisions', 'templates']) {
    if (found[key].length > 0) leaks.push(`${key}: ${String(found[key].length)} rows`);
  }
  if (found.history.total !== 0) leaks.push(`history total ${String(found.history.total)}`);

  /**
   * The subject is the harder case, and the assertion is different in kind.
   *
   * Both tenants raise approvals about `SUBJ-00000001`, because a subject identifier belongs to the
   * business module rather than to Workflow and two organizations numbering their own records from
   * one is the ordinary situation. So the honest question is not "does B find nothing" — B has its
   * own approval about that subject and should find it — but **"does B find its own, and never A's"**.
   * An assertion expecting nothing would have been satisfied by a boundary that simply had no rows
   * on the other side of it.
   */
  if (found.open === undefined) leaks.push('the neighbour cannot see its own approval by subject');
  if (found.open?.instanceId === mine.running) leaks.push(`open-for-subject returned A's approval`);
  if (found.bySubject.total !== 1) {
    leaks.push(`subject search returned ${String(found.bySubject.total)} rows, expected B's one`);
  }
  if (found.bySubject.items.some((row) => row.instanceId === mine.running)) {
    leaks.push(`subject search returned A's approval`);
  }

  if (leaks.length > 0) throw new Error(`Tenant isolation broken: ${leaks.join('; ')}.`);

  // And the neighbour's own queue, for the membership identifier the two tenants share, returns
  // only the neighbour's steps — the case a benchmark with disjoint identifiers cannot test at all.
  const theirs = await asTenant(other, (transaction) =>
    stores.steps.awaitingFor(transaction, mine.approver, PAGE),
  );
  const ours = await asTenant(other, (transaction) =>
    stores.decisions.decidedBy(transaction, mine.decider, PAGE),
  );

  console.log(
    `Isolation: no definition, version, instance, step, decision, template or history row of ` +
      `tenant A is reachable from tenant B by identifier, and its history total is 0. The subject ` +
      `both tenants share resolves to B's own approval and never A's. The approver identifier both ` +
      `tenants share returns ${String(theirs.total)} of B's own awaiting steps and ` +
      `${String(ours.total)} of B's own decisions.`,
  );
};

/**
 * The values Workflow must carry back unchanged, read through the production repositories.
 *
 * Identifiers stay strings, whole numbers stay whole, the localized description round-trips as an
 * object rather than as the string somebody stored it with, and an instant is a `Date` the mapper
 * produced rather than a string a consumer must parse.
 */
export const assertExactValues = async (stores, asTenant, tenant, mine) => {
  const read = await asTenant(tenant, async (transaction) => ({
    definition: await stores.definitions.byId(transaction, mine.definition),
    version: await stores.versions.byId(transaction, mine.version),
    instance: await stores.instances.byId(transaction, mine.running),
    steps: await stores.steps.forInstance(transaction, mine.running),
  }));
  const faults = [];

  if (typeof read.definition?.definitionId !== 'string') faults.push('definitionId is not a string');
  if (read.definition?.definitionId !== mine.definition) faults.push('definitionId changed');
  if (typeof read.definition?.description?.en !== 'string') {
    faults.push('description did not round-trip as localized text');
  }
  if (!Number.isInteger(read.version?.versionNumber)) faults.push('versionNumber is not an integer');
  if (!Number.isInteger(read.instance?.version)) faults.push('row version is not an integer');
  if (!(read.instance?.startedAt instanceof Date)) faults.push('startedAt is not a Date');
  if (read.instance?.completedAt !== undefined) faults.push('a running approval carries a completion');
  for (const step of read.steps) {
    if (!Number.isInteger(step.ordinal)) faults.push(`ordinal ${String(step.ordinal)} is not whole`);
  }
  const ordinals = read.steps.map((step) => step.ordinal);

  if (ordinals.join(',') !== [...ordinals].sort((a, b) => a - b).join(',')) {
    faults.push('steps are not returned in ordinal order');
  }
  if (faults.length > 0) throw new Error(`Exactness broken: ${faults.join('; ')}.`);
  console.log(
    `Exactness: identifiers are strings, ordinals and versions are whole, the localized ` +
      `description round-trips as an object, and instants arrive as dates.`,
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
  ['pending queue for one member', (tx) => stores.steps.awaitingFor(tx, mine.approver, PAGE)],
  ['decided approvals for one member', (tx) => stores.decisions.decidedBy(tx, mine.decider, PAGE)],
  [
    'instances by subject',
    (tx) => stores.instances.search(tx, { subjectType: mine.subjecttype, subjectId: mine.subject }, PAGE),
  ],
  ['running instances', (tx) => stores.instances.search(tx, { status: 'running' }, PAGE)],
  [
    'open approval for a subject (uniqueness probe)',
    (tx) => stores.instances.openForSubject(tx, mine.subjecttype, mine.subject),
  ],
  ['timeline for one approval', (tx) => stores.history.forInstance(tx, mine.running, PAGE)],
  ['current published version', (tx) => stores.versions.currentPublished(tx, mine.definition)],
  ['definition listing (active)', (tx) => stores.definitions.search(tx, { status: 'active' }, PAGE)],
];
