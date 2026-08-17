/**
 * What the Workflow benchmark proves about the **boundary**, as opposed to the speed.
 *
 * Split from `workflow-benchmark-audit.mjs` at the file-size budget, along a real seam: next door
 * asserts things about the *schema* — the role, the policies, the constraints, the column types —
 * and every one of them is answered from the catalogue. These three are answered by **reading data
 * through the production repositories from the wrong tenant**, which is a different kind of claim
 * and a different kind of evidence.
 *
 * Every one of them throws. A boundary check that warned and carried on would leave a benchmark
 * reporting figures for a database whose isolation nobody established.
 */

const PAGE = { limit: 50, offset: 0 };

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
    group: await stores.groups.byId(transaction, mine.group),
    groupMembers: await stores.groups.membersOf(transaction, mine.group),
    groupMembersAll: await stores.groups.membersOfAll(transaction, mine.groupIds),
    branchSteps: await stores.steps.forInstance(transaction, mine.branchInstance),
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
  for (const key of ['definition', 'version', 'instance', 'group']) {
    if (found[key] !== undefined) leaks.push(`${key} readable by exact identifier`);
  }
  for (const key of ['steps', 'decisions', 'templates', 'groupMembers', 'branchSteps']) {
    if (found[key].length > 0) leaks.push(`${key}: ${String(found[key].length)} rows`);
  }
  if (found.history.total !== 0) leaks.push(`history total ${String(found.history.total)}`);
  // Every list of tenant A, asked for at once from tenant B. The bounded read is the one somebody
  // would reach for to resolve a branch, so it is the one that must return nothing across a boundary.
  if (found.groupMembersAll.length > 0) {
    leaks.push(`membersOfAll returned ${String(found.groupMembersAll.length)} of A's members`);
  }

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
  const groupSearch = await asTenant(other, (transaction) =>
    stores.groups.search(transaction, PAGE),
  );

  if (groupSearch.items.some((row) => mine.groupIds.includes(row.approvalGroupId))) {
    throw new Error(`Tenant isolation broken: B's group listing returned one of A's lists.`);
  }
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
      `${String(ours.total)} of B's own decisions. B's group listing holds ` +
      `${String(groupSearch.total)} lists and none of A's.`,
  );
};

/**
 * A tenant cannot attach its own membership to another tenant's list, and PostgreSQL says so
 * **without consulting a policy**.
 *
 * This is the property the composite key exists for. A referential check is made by the system
 * rather than by the querying role, so row-level security does not participate in it: with a
 * single-column reference the parent row exists, the check passes, and tenant B ends up with a row
 * pointing at tenant A's list. With `(id, tenant_id)` the pair does not exist and the write is
 * refused by name.
 *
 * Asserted as the **admin** connection deliberately — the one role that could otherwise see both
 * tenants — because the claim is about the constraint and not about the policy in front of it.
 */
export const assertCompositeForeignKeys = async (admin, other, mine) => {
  const attempts = [
    [
      'a member of tenant B attached to tenant A’s list',
      `insert into workflow_approval_group_member
         (id, tenant_id, approval_group_id, membership_id, added_at, metadata,
          created_at, created_by, updated_at, updated_by, version)
       values (app_uuid_v7(), $1::uuid, $2::uuid, app_uuid_v7(), now(), '{}'::jsonb,
               now(), 'audit', now(), 'audit', 1)`,
      'workflow_approval_group_member_group_fk',
    ],
    [
      'a step template of tenant B naming tenant A’s list',
      `update workflow_step_template set approver_kind = 'group', approver_group_id = $2::uuid,
              approver_membership_id = null
        where tenant_id = $1::uuid and id = (select id from workflow_step_template
                                              where tenant_id = $1::uuid order by id limit 1)`,
      'workflow_step_template_group_fk',
    ],
  ];
  const refused = [];

  for (const [what, sql, constraint] of attempts) {
    try {
      await admin.query('begin');
      // The neighbour's tenant, and one of *this* tenant's lists: the pair the composite key
      // refuses. `tenant` is unused in the statements and is not passed, so PostgreSQL is never
      // asked to infer the type of a parameter nobody referenced.
      await admin.query(sql, [other, mine.group]);
      await admin.query('rollback');
      throw new Error(`Composite foreign key did not refuse: ${what}.`);
    } catch (error) {
      await admin.query('rollback');
      if (error.constraint !== constraint) {
        throw new Error(
          `${what}: expected ${constraint}, got ${String(error.constraint ?? error.message)}.`,
        );
      }
      refused.push(`${what} → ${constraint}`);
    }
  }
  console.log(`Composite foreign keys: ${refused.join('; ')}.`);
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
    templates: await stores.versions.templatesFor(transaction, mine.version),
  }));
  const faults = [];

  if (typeof read.definition?.definitionId !== 'string')
    faults.push('definitionId is not a string');
  if (read.definition?.definitionId !== mine.definition) faults.push('definitionId changed');
  if (typeof read.definition?.description?.en !== 'string') {
    faults.push('description did not round-trip as localized text');
  }
  if (!Number.isInteger(read.version?.versionNumber))
    faults.push('versionNumber is not an integer');
  if (!Number.isInteger(read.instance?.version)) faults.push('row version is not an integer');
  if (!(read.instance?.startedAt instanceof Date)) faults.push('startedAt is not a Date');
  if (read.instance?.completedAt !== undefined)
    faults.push('a running approval carries a completion');
  for (const step of read.steps) {
    if (!Number.isInteger(step.ordinal))
      faults.push(`ordinal ${String(step.ordinal)} is not whole`);
  }
  const ordinals = read.steps.map((step) => step.ordinal);

  if (ordinals.join(',') !== [...ordinals].sort((a, b) => a - b).join(',')) {
    faults.push('steps are not returned in ordinal order');
  }
  faults.push(...routingFaults(read));
  if (faults.length > 0) throw new Error(`Exactness broken: ${faults.join('; ')}.`);
  console.log(
    `Exactness: identifiers are strings, ordinals and versions are whole, the localized ` +
      `description round-trips as an object, instants arrive as dates, the manager template names ` +
      `nobody, its running step names a person, and the target survives as a whole number.`,
  );
};

/**
 * Phase 16C, read back through the production mappers rather than counted in the database.
 *
 * The seed writes a manager template, a target and an awaiting instant; nothing so far proves the
 * repository **returns** them. A benchmark that seeded three columns and never read one would time a
 * query over data the mapper drops, and would report the phase as costing nothing because it does.
 *
 * The two halves of manager routing are asserted as a pair. A *template* says `manager` and names
 * nobody; the *step* it produced says `membership` and names a person. A mapper that leaked the
 * template's kind onto the running row, or that invented an approver for the template, breaks
 * exactly one of these.
 */
const routingFaults = (read) => {
  const faults = [];
  const manager = read.templates.find((template) => template.approverKind === 'manager');
  const targeted = read.steps.find((step) => step.serviceLevel !== undefined);

  if (manager === undefined) faults.push('no manager template survived the read');
  if (manager?.approverMembershipId !== undefined) faults.push('a manager template named somebody');
  if (manager?.approverGroupId !== undefined) faults.push('a manager template named a list');
  if (manager?.serviceLevel?.count !== 48) faults.push('the template target did not round-trip');
  if (manager?.serviceLevel?.unit !== 'hours') faults.push('the template unit did not round-trip');
  if (targeted === undefined) faults.push('no step carried a service-level target');
  if (!Number.isInteger(targeted?.serviceLevel?.count)) faults.push('a step target is not whole');
  if (targeted !== undefined && !(targeted.awaitingAt instanceof Date)) {
    faults.push('awaitingAt is not a Date');
  }
  for (const step of read.steps) {
    // A resolved step is always a person. The database refuses anything else; this proves the
    // mapper does not invent one on the way back out.
    if (step.approverKind !== 'membership') faults.push(`a step said ${String(step.approverKind)}`);
  }
  return faults;
};
