import { PostgresDefinitionRepository } from './definition.repository.js';
import { PostgresVersionRepository } from './version.repository.js';
import { PostgresInstanceRepository, PostgresStepRepository } from './instance.repository.js';
import { PostgresDecisionRepository, PostgresHistoryRepository } from './record.repository.js';
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
 * Six repositories over the seven tables Checkpoint 3 created. The counts differ by one because
 * `workflow_step_template` has no life outside its version: a template is created only while the
 * version is a draft, frozen when it publishes, and **copied** rather than referenced when an
 * instance starts. It is an entity of the version aggregate, so `PostgresVersionRepository` owns
 * both tables and there is no separate template store a handler could use to reach past the version.
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
  groups: notYetPersisted(),
});

/**
 * The approval-group store, **declared and not yet written**.
 *
 * The two group tables exist and hold their invariants; the repository that reads and writes them is
 * the next checkpoint's, and the application layer that needs it is this one's. That gap is real for
 * exactly one checkpoint, and there are three ways to represent it. Leaving `groups` off this object
 * would make the composition root stop compiling and take the whole module out of the API with it.
 * Returning an in-memory store would be worse than either: the API would serve group reads and writes
 * from process memory, one server would disagree with the next, and every test would pass.
 *
 * So it throws, by name, on every method. A call fails loudly at the one place the capability is
 * missing rather than quietly succeeding somewhere it should not, and the failure names the
 * checkpoint that closes it. Every other Workflow capability is unaffected: nothing else in the
 * module reaches this store unless a version actually names a group.
 */
const notYetPersisted = (): WorkflowStores['groups'] => {
  const absent = (): never => {
    throw new Error(
      'Workflow approval groups have no PostgreSQL repository yet — the schema exists and the ' +
        'repository is Phase 16B Checkpoint 5. Nothing may read or write a group through this ' +
        'store until then.',
    );
  };

  return {
    byId: absent,
    byCode: absent,
    search: absent,
    insert: absent,
    membersOf: absent,
    membersOfAll: absent,
    insertMember: absent,
    memberById: absent,
    removeMember: absent,
  };
};
