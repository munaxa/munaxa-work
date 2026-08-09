/**
 * Recruitment — the hiring process, and the candidates who are not yet people.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * The three cross-module ports are exported as **types only**. The composition root implements them
 * against People, Organization and Employment under a bounded service grant (ADR-0043), which is
 * what keeps `people.person.manage` off every recruiter's role — and what stops this module from
 * ever importing another module's internals.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { recruitmentModule } from './application/recruitment-module.js';
export {
  RecruitmentPermissions,
  ALL_RECRUITMENT_PERMISSIONS,
} from './application/recruitment-permissions.js';
export type { RecruitmentPermission } from './application/recruitment-permissions.js';
export { systemClock } from './application/recruitment-ports.js';
export type {
  Clock,
  CreateEmploymentForHire,
  CreatePersonForHire,
  EmploymentDirectoryPort,
  MatchedPerson,
  OrganizationDirectoryPort,
  PeopleDirectoryPort,
  RecruitmentStores,
} from './application/recruitment-ports.js';
export type { RecruitmentDependencies } from './application/recruitment-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { EXPORT_LIMIT, IMPORT_LIMIT } from './application/transfer.use-case.js';
export { postgresRecruitmentStores } from './infrastructure/recruitment-stores.js';

// Transport — the controllers the API mounts.
export { RecruitmentDispatcher } from './api/recruitment-dispatcher.js';
export { RequisitionsController } from './api/requisitions.controller.js';
export { RequisitionDecisionsController } from './api/requisition-decisions.controller.js';
export { VacanciesController } from './api/vacancies.controller.js';
export { CandidatesController } from './api/candidates.controller.js';
export { CandidateRecordsController } from './api/candidate-records.controller.js';
export { ApplicationsController } from './api/applications.controller.js';
export { InterviewsController } from './api/interviews.controller.js';
export { OffersController } from './api/offers.controller.js';
export { HireController } from './api/hire.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a fake
 * duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryRecruitmentStores } from './application/in-memory-stores.js';
export {
  FakeEmployment,
  FakeOrganization,
  FakePeople,
} from './application/recruitment-test-harness.js';
