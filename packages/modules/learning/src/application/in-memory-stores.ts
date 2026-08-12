import { emptyTables, type Tables } from './in-memory-tables.js';
import {
  assessmentStore,
  categoryStore,
  courseStore,
  pathStore,
  resultStore,
  versionStore,
} from './in-memory-catalogue-stores.js';
import {
  assignmentStore,
  certificationStore,
  enrolmentStore,
  instructorStore,
  ruleStore,
} from './in-memory-learner-stores.js';
import type { LearningStores } from './learning-ports.js';

/**
 * The stores the application suites run against, assembled from the two halves.
 *
 * They are **not** a convenience layer over a Map. Each one keeps the guarantee its production
 * counterpart keeps — the optimistic version, the unique indexes, and the absence of an update
 * method where the table is insert-only — because a fake more permissive than the database would let
 * the suites pass on behaviour PostgreSQL will refuse, which is the most expensive kind of green.
 *
 * `tables` is exposed so a suite can assert on what was actually written: "one row, not two" is the
 * assertion that makes an idempotency claim mean something.
 */
export const inMemoryLearningStores = (
  tables: Tables = emptyTables(),
): LearningStores & { readonly tables: Tables } => ({
  tables,
  categories: categoryStore(tables),
  courses: courseStore(tables),
  versions: versionStore(tables),
  assessments: assessmentStore(tables),
  results: resultStore(tables),
  paths: pathStore(tables),
  rules: ruleStore(tables),
  assignments: assignmentStore(tables),
  enrolments: enrolmentStore(tables),
  certifications: certificationStore(tables),
  instructors: instructorStore(tables),
});
