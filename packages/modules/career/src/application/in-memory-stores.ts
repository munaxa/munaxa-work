import { emptyTables, type Tables } from './in-memory-tables.js';
import { pathStore, planStore, poolStore, readinessLevelStore } from './in-memory-config-stores.js';
import {
  assessmentStore,
  developmentItemStore,
  developmentPlanStore,
  membershipStore,
  mobilityStore,
  successionPlanStore,
  successorStore,
} from './in-memory-record-stores.js';
import type { CareerStores } from './career-ports.js';

/**
 * The stores the application suites run against, assembled from the two halves.
 *
 * They are **not** a convenience layer over a Map. Each one keeps the guarantee its production
 * counterpart keeps — the optimistic version, the partial unique indexes with their `where` clauses
 * intact, and the absence of an update method where the table is insert-only — because a fake more
 * permissive than the database would let the suites pass on behaviour PostgreSQL will refuse, and a
 * fake stricter than it would refuse behaviour PostgreSQL permits. Both are expensive; the second is
 * worse, because nothing ever fails to reveal it.
 *
 * **What they do not claim.** They are a single process, so they prove the *rule* and not the
 * *race*. "Two managers nominating the same person at the same instant" is PostgreSQL's arbitration
 * and was tested across two real connections in Checkpoint 3. Nothing here re-proves it, and no
 * suite in this module says otherwise.
 *
 * `tables` is exposed so a suite can assert on what was actually written: "one row, not two" is the
 * assertion that makes a convergence claim mean something, and "the earlier assessment is still
 * there" is what makes an append-only claim mean something.
 */
export const inMemoryCareerStores = (
  tables: Tables = emptyTables(),
): CareerStores & { readonly tables: Tables } => ({
  tables,
  paths: pathStore(tables),
  plans: planStore(tables),
  pools: poolStore(tables),
  memberships: membershipStore(tables),
  successionPlans: successionPlanStore(tables),
  successors: successorStore(tables),
  readinessLevels: readinessLevelStore(tables),
  assessments: assessmentStore(tables),
  developmentPlans: developmentPlanStore(tables),
  developmentItems: developmentItemStore(tables),
  mobility: mobilityStore(tables),
});
