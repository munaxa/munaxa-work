import { PostgresDefinitionRepository } from './definition.repository.js';
import { PostgresVersionRepository } from './version.repository.js';
import { PostgresInstanceRepository, PostgresStepRepository } from './instance.repository.js';
import { PostgresDecisionRepository, PostgresHistoryRepository } from './record.repository.js';
import { PostgresApprovalGroupRepository } from './group.repository.js';
import type { WorkflowStores } from '../application/workflow-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to. **Every store in `WorkflowStores` has an
 * implementation here, and the return type is the whole interface rather than a partial** — so a
 * missing repository is a compile error rather than a runtime surprise, and there is no shape in
 * which this function could return an in-memory fallback for one table and real persistence for the
 * rest.
 *
 * Seven repositories over the nine tables the module owns, and the counts differ by two for the
 * same reason twice. `workflow_step_template` has no life outside its version — a template is
 * created only while the version is a draft, frozen when it publishes, and **copied** rather than
 * referenced when an instance starts — so `PostgresVersionRepository` owns both tables and there is
 * no separate template store a handler could use to reach past the version. A group member has no
 * life outside its group for the same reason, and `PostgresApprovalGroupRepository` owns both.
 *
 * **Nothing here opens a transaction.** Each repository takes the `Transaction` the application
 * layer's unit of work established, so a command that writes an instance, its steps and its history
 * does all of it or none of it.
 */
export const postgresWorkflowStores = (): WorkflowStores => ({
  definitions: new PostgresDefinitionRepository(),
  versions: new PostgresVersionRepository(),
  instances: new PostgresInstanceRepository(),
  steps: new PostgresStepRepository(),
  decisions: new PostgresDecisionRepository(),
  history: new PostgresHistoryRepository(),
  groups: new PostgresApprovalGroupRepository(),
});
