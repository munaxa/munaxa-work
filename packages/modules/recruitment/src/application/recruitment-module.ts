import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendCandidateHandler,
  createCandidateHandler,
  linkCandidateToPersonHandler,
} from './candidate.use-case.js';
import {
  anonymizeCandidateHandler,
  recordProfileEntryHandler,
} from './candidate-record.use-case.js';
import {
  createRequisitionHandler,
  decideRequisitionHandler,
  reverseRequisitionDecisionHandler,
  submitRequisitionHandler,
} from './requisition.use-case.js';
import {
  closeRequisitionHandler,
  openRequisitionHandler,
} from './requisition-lifecycle.use-case.js';
import { moveApplicationHandler, submitApplicationHandler } from './application.use-case.js';
import { closeApplicationHandler, recordScreeningHandler } from './application-outcome.use-case.js';
import {
  closeVacancyHandler,
  openVacancyHandler,
  publishVacancyHandler,
} from './vacancy.use-case.js';
import {
  concludeInterviewHandler,
  rescheduleInterviewHandler,
  scheduleInterviewHandler,
  submitFeedbackHandler,
} from './interview.use-case.js';
import { decideOfferHandler, draftOfferHandler, submitOfferHandler } from './offer.use-case.js';
import {
  closeOfferHandler,
  issueOfferHandler,
  recordOfferResponseHandler,
} from './offer-response.use-case.js';
import { hireCandidateHandler } from './hire.use-case.js';
import {
  matchCandidateHandler,
  readCandidateHandler,
  readRequisitionHandler,
  searchCandidatesHandler,
  searchRequisitionsHandler,
  searchVacanciesHandler,
} from './recruitment-queries.js';
import {
  readApplicationHandler,
  readFeedbackHandler,
  readInterviewsHandler,
  readPipelineHandler,
  searchApplicationsHandler,
} from './pipeline-queries.js';
import { exportRecruitmentHandler, importCandidatesHandler } from './transfer.use-case.js';
import { ALL_RECRUITMENT_PERMISSIONS, RecruitmentPermissions } from './recruitment-permissions.js';
import type { CommandSender } from './transfer.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * The module's declaration: what Recruitment offers, in one place, so the registry can derive
 * everything else — permissions, navigation, health.
 *
 * The `sender` parameter is what import needs, and it is a parameter rather than something taken
 * from a container because the dispatcher it will use is built *from this list*. Passing a deferred
 * sender keeps the module a plain declaration instead of a graph with a cycle in it.
 */
export const recruitmentModule = (
  dependencies: RecruitmentDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'recruitment',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'recruitment.hiring',
      path: '/recruitment',
      permission: RecruitmentPermissions.requisitionRead,
      order: 30,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_RECRUITMENT_PERMISSIONS,
});

const commandsOf = (
  dependencies: RecruitmentDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createRequisitionHandler(dependencies),
    submitRequisitionHandler(dependencies),
    decideRequisitionHandler(dependencies),
    reverseRequisitionDecisionHandler(dependencies),
    openRequisitionHandler(dependencies),
    closeRequisitionHandler(dependencies),

    openVacancyHandler(dependencies),
    publishVacancyHandler(dependencies),
    closeVacancyHandler(dependencies),

    createCandidateHandler(dependencies),
    amendCandidateHandler(dependencies),
    linkCandidateToPersonHandler(dependencies),
    recordProfileEntryHandler(dependencies),
    anonymizeCandidateHandler(dependencies),

    submitApplicationHandler(dependencies),
    moveApplicationHandler(dependencies),
    recordScreeningHandler(dependencies),
    closeApplicationHandler(dependencies),

    scheduleInterviewHandler(dependencies),
    rescheduleInterviewHandler(dependencies),
    concludeInterviewHandler(dependencies),
    submitFeedbackHandler(dependencies),

    draftOfferHandler(dependencies),
    submitOfferHandler(dependencies),
    decideOfferHandler(dependencies),
    issueOfferHandler(dependencies),
    recordOfferResponseHandler(dependencies),
    closeOfferHandler(dependencies),

    hireCandidateHandler(dependencies),

    importCandidatesHandler(sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (
  dependencies: RecruitmentDependencies,
): readonly QueryHandler<Query, unknown>[] =>
  [
    searchRequisitionsHandler(dependencies),
    readRequisitionHandler(dependencies),
    searchVacanciesHandler(dependencies),
    searchCandidatesHandler(dependencies),
    readCandidateHandler(dependencies),
    matchCandidateHandler(dependencies),
    searchApplicationsHandler(dependencies),
    readApplicationHandler(dependencies),
    readPipelineHandler(dependencies),
    readInterviewsHandler(dependencies),
    readFeedbackHandler(dependencies),
    exportRecruitmentHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
