import { PostgresPathRepository } from './path.repository.js';
import { PostgresPlanRepository } from './plan.repository.js';
import { PostgresMembershipRepository, PostgresPoolRepository } from './pool.repository.js';
import { PostgresSuccessionPlanRepository } from './succession.repository.js';
import { PostgresSuccessorRepository } from './successor.repository.js';
import {
  PostgresAssessmentRepository,
  PostgresReadinessLevelRepository,
} from './readiness.repository.js';
import { PostgresDevelopmentPlanRepository } from './development.repository.js';
import { PostgresDevelopmentItemRepository } from './development-item.repository.js';
import { PostgresMobilityRepository } from './mobility.repository.js';
import type { CareerStores } from '../application/career-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to. **Every store in `CareerStores` has an implementation
 * here, and the return type is the whole interface rather than a partial** — so a missing repository
 * is a compile error rather than a runtime surprise, and there is no shape in which this function
 * could return an in-memory fallback for one table and real persistence for the rest.
 *
 * Eleven repositories over the twelve tables Checkpoint 3 created. The counts differ by one because
 * `career_stage` has no life outside its path: a stage is an entity of the `CareerPath` aggregate
 * (§6), so `PostgresPathRepository` owns both tables and there is no separate stage store a handler
 * could use to reach past the path.
 *
 * **Nothing here opens a transaction.** Each repository takes the `Transaction` the application
 * layer's unit of work established, so a command that writes a succession plan and its first
 * nomination does both or neither.
 */
export const postgresCareerStores = (): CareerStores => ({
  paths: new PostgresPathRepository(),
  plans: new PostgresPlanRepository(),
  pools: new PostgresPoolRepository(),
  memberships: new PostgresMembershipRepository(),
  successionPlans: new PostgresSuccessionPlanRepository(),
  successors: new PostgresSuccessorRepository(),
  readinessLevels: new PostgresReadinessLevelRepository(),
  assessments: new PostgresAssessmentRepository(),
  developmentPlans: new PostgresDevelopmentPlanRepository(),
  developmentItems: new PostgresDevelopmentItemRepository(),
  mobility: new PostgresMobilityRepository(),
});
