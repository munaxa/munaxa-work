/**
 * How the Workflow benchmark prints what it measured.
 *
 * Split from the measurements at the file-size budget. The division is a real one: next door decides
 * *what* to time, and this decides how a reader is told — including, deliberately, how a miss is
 * shown. Every line carries its budget and says plainly whether it was met, because a benchmark that
 * printed only the numbers would leave the reader to do the comparison the report exists to make.
 *
 * `sizeOf` reports the **server's total** where a page carries one, not the number of rows returned.
 * A line reading "50 rows" for a page of fifty out of ten thousand would be true and useless.
 */

const verdict = (ms, budget) => (ms <= budget ? 'within budget' : `MISSED (budget ${budget}ms)`);

const sizeOf = (value) => {
  if (value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  return value.total ?? 1;
};

export const report = (dataset, seeded, measured, rowCounts) => {
  const missed = [];
  const line = (name, result, budget) => {
    if (result.ms > budget) missed.push(`${dataset.key}/${name}`);
    console.log(
      `  ${name.padEnd(38)} ${result.ms.toFixed(1).padStart(9)} ms  ` +
        `${String(sizeOf(result.value)).padStart(8)} rows  ${verdict(result.ms, budget)}`,
    );
  };
  const { queue, detail, cohort } = dataset.budgetMs;

  console.log(
    `\nDataset ${dataset.key}: ${String(dataset.approvals)} approvals per tenant, two tenants ` +
      `(seeded in ${(seeded.ms / 1000).toFixed(1)}s)`,
  );
  console.log(
    `  rows per tenant: ${rowCounts
      .map((row) => `${row.name.replace('workflow_', '')}=${String(row.rows)}`)
      .join(', ')}`,
  );

  // Configuration — flat at every tier, and the reads a process designer makes.
  line('definition listing (active)', measured.definitionList, queue);
  line('definition lookup by id', measured.definitionRead, detail);
  line('definition lookup by code', measured.definitionByCode, detail);
  line('versions for one definition', measured.versionList, detail);
  line('current published version', measured.publishedVersion, detail);
  line('step templates for one version', measured.templates, detail);

  // Approvals — what is running, and one of them in full.
  line('instance listing (all)', measured.instanceList, queue);
  line('instance listing (running)', measured.runningList, queue);
  line('instances by subject', measured.bySubject, detail);
  line('open approval for a subject', measured.openForSubject, detail);
  line('instance lookup by id', measured.instanceRead, detail);
  line('instance detail (4 reads)', measured.instanceDetail, detail);
  line('steps for one approval', measured.stepChain, detail);
  line('timeline for one approval', measured.timeline, detail);

  // The two queues — the reads resolved from the caller's own membership.
  line('pending queue for one member', measured.pendingQueue, queue);
  line('decided approvals for one member', measured.decidedQueue, queue);
  line('approval status (3 reads)', measured.approvalStatus, detail);

  // The cohort shape, measured as the repository can actually answer it.
  //
  // The plan's §14 proposes "open instances for 200 subjects — one query for 200, never one per
  // subject". `InstanceStore.search` accepts a single `subjectId` and no `subjectIdsIn`, so that
  // query does not exist and adding one is a new capability rather than an audit. What is measured
  // instead is what an adopting module asking about two hundred records would actually pay today:
  // two hundred bounded lookups, one per subject. Reported under the cohort budget and named for
  // what it is, because a fast number against a workload nobody can run would be worse than a gap.
  line('cohort: 200 subjects, one lookup each', measured.cohort, cohort);

  return missed;
};
