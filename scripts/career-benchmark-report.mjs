/**
 * How the Career benchmark prints what it measured.
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
  if (value instanceof Map) return value.size;
  return value.total ?? 1;
};

export const report = (dataset, seeded, measured, rowCounts) => {
  const line = (name, result, budget) =>
    console.log(
      `  ${name.padEnd(34)} ${result.ms.toFixed(1).padStart(9)} ms  ` +
        `${String(sizeOf(result.value)).padStart(8)} rows  ` +
        (budget === undefined ? '' : verdict(result.ms, budget)),
    );
  const { queue, detail, reconcile } = dataset.budgetMs;

  console.log(
    `\nDataset ${dataset.key}: ${String(dataset.employments)} employments per tenant, two tenants ` +
      `(seeded in ${(seeded.ms / 1000).toFixed(1)}s)`,
  );
  console.log(
    `  rows per tenant: ${rowCounts.map((row) => `${row.name.replace('career_', '')}=${String(row.rows)}`).join(', ')}`,
  );

  line('path list (published)', measured.pathList, queue);
  line('path stages', measured.pathStages, detail);
  line('pool list (active)', measured.poolList, queue);
  line('readiness levels', measured.levelList, detail);
  line('career plans by path', measured.plansByPath, queue);
  line('pool membership listing', measured.membershipList, queue);
  line('pool membership as-of a day', measured.membershipAsOf, queue);
  line('succession listing (active)', measured.successionList, queue);
  line('succession, review due by a day', measured.successionReviewDue, queue);
  line('succession plan read', measured.successionRead, detail);
  line('successors for one plan', measured.successorsForPlan, detail);
  line('bench strength, one position', measured.benchStrength, detail);
  line('bench strength, 40 positions', measured.benchAcrossPositions, reconcile);
  line('career plans by employment', measured.plansByEmployment, queue);
  line('readiness history, one person', measured.readinessHistory, detail);
  // The next three exercise repository capability that **no published query reaches**: the three
  // `search` methods on assessments, development plans and development items are declared, indexed
  // and unused. Measured because the plan's §19 names them; labelled because a reader would
  // otherwise take a fast number as evidence that a screen is fast.
  line('readiness by level (unrouted)', measured.readinessByLevel, queue);
  line('development plans by employment (unrouted)', measured.developmentByEmployment, queue);
  line('open development items due (unrouted)', measured.developmentDue, queue);
  line('mobility listing (proposed)', measured.mobilityList, queue);
  line('career summary (6 reads)', measured.summary, detail);
  line('cohort: career plans (200)', measured.cohortPlans, reconcile);
  line('cohort: memberships (200)', measured.cohortMemberships, reconcile);
  line('cohort: successors (200)', measured.cohortSuccessors, reconcile);
  line('cohort: assessments (200)', measured.cohortAssessments, reconcile);
  line('cohort: development plans (200)', measured.cohortDevelopment, reconcile);
  line('cohort: recommendations (200)', measured.cohortMobility, reconcile);
};
