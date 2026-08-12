import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  archiveCourseHandler,
  createCategoryHandler,
  createCourseHandler,
  defineAssessmentHandler,
  publishCourseVersionHandler,
  updateCourseHandler,
} from './catalogue.use-case.js';
import {
  addPathStepHandler,
  archivePathHandler,
  createPathHandler,
  publishPathHandler,
  removePathStepHandler,
} from './path.use-case.js';
import {
  defineMandatoryRuleHandler,
  retireMandatoryRuleHandler,
} from './mandatory-rule.use-case.js';
import {
  assignLearningHandler,
  cancelAssignmentHandler,
  waiveAssignmentHandler,
} from './assignment.use-case.js';
import {
  completeEnrolmentHandler,
  enrolHandler,
  startEnrolmentHandler,
} from './enrolment.use-case.js';
import { failEnrolmentHandler, withdrawEnrolmentHandler } from './enrolment-ending.use-case.js';
import { recordAssessmentResultHandler } from './assessment.use-case.js';
import { issueCertificationHandler, revokeCertificationHandler } from './certification.use-case.js';
import { deactivateInstructorHandler, registerInstructorHandler } from './instructor.use-case.js';
import { reconcileRequirementsHandler } from './reconcile.use-case.js';
import {
  listInstructorsHandler,
  listMandatoryRulesHandler,
  listPathsHandler,
  readCourseHandler,
  readPathHandler,
  searchCoursesHandler,
} from './learning-queries.js';
import {
  readAssessmentResultsHandler,
  searchAssignmentsHandler,
  searchCertificationsHandler,
  searchEnrolmentsHandler,
} from './learning-record-queries.js';
import { readLearningHistoryHandler } from './learning-history.js';
import { ALL_LEARNING_PERMISSIONS, LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Learning's module declaration: twenty-one commands, eleven queries, four navigation entries.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event.**
 * The dispatch is at-most-once with no outbox (ADR-0064), so a module whose correctness depended on
 * delivery would be wrong the first time a process restarted mid-dispatch. Every cross-module fact
 * this module needs is pulled at the moment it is needed.
 *
 * **Nothing here is scheduled.** Recurring training does not generate itself, an expiry does not
 * notice itself and a reminder is not sent — `JobPort` has no adapter, so due-ness and expiry are
 * questions a query answers when asked, and `learning.reconcile-requirements` is a command an
 * administrator runs (ADR-0071). Scheduled execution is `NOT VERIFIED`.
 *
 * **`learning.reconcile-requirements` is a command, not a query**, though it mostly reports. It
 * writes the assignments the rule currently implies, and a read that writes is a command; routing it
 * as a query would put a write on the read path.
 */
export const learningModule = (dependencies: LearningDependencies): WorkModule => ({
  name: 'learning',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'learning.catalogue',
      path: '/learning/catalogue',
      permission: LearningPermissions.catalogueRead,
      order: 80,
    },
    {
      key: 'learning.assignments',
      path: '/learning/assignments',
      permission: LearningPermissions.assignmentRead,
      order: 81,
    },
    {
      key: 'learning.certifications',
      path: '/learning/certifications',
      permission: LearningPermissions.certificationRead,
      order: 82,
    },
    {
      key: 'learning.compliance',
      path: '/learning/compliance',
      permission: LearningPermissions.mandatoryRead,
      order: 83,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration — including the two that are declared and route
  // nowhere, which the checkpoint report lists as `NOT VERIFIED` rather than as features.
  permissions: ALL_LEARNING_PERMISSIONS,
});

const commandsOf = (
  dependencies: LearningDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createCategoryHandler(dependencies),
    createCourseHandler(dependencies),
    updateCourseHandler(dependencies),
    publishCourseVersionHandler(dependencies),
    archiveCourseHandler(dependencies),
    defineAssessmentHandler(dependencies),

    createPathHandler(dependencies),
    addPathStepHandler(dependencies),
    removePathStepHandler(dependencies),
    publishPathHandler(dependencies),
    archivePathHandler(dependencies),

    defineMandatoryRuleHandler(dependencies),
    retireMandatoryRuleHandler(dependencies),
    reconcileRequirementsHandler(dependencies),

    assignLearningHandler(dependencies),
    waiveAssignmentHandler(dependencies),
    cancelAssignmentHandler(dependencies),

    enrolHandler(dependencies),
    startEnrolmentHandler(dependencies),
    completeEnrolmentHandler(dependencies),
    failEnrolmentHandler(dependencies),
    withdrawEnrolmentHandler(dependencies),

    recordAssessmentResultHandler(dependencies),

    issueCertificationHandler(dependencies),
    revokeCertificationHandler(dependencies),

    registerInstructorHandler(dependencies),
    deactivateInstructorHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: LearningDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchCoursesHandler(dependencies),
    readCourseHandler(dependencies),
    listPathsHandler(dependencies),
    readPathHandler(dependencies),
    listMandatoryRulesHandler(dependencies),

    searchAssignmentsHandler(dependencies),
    searchEnrolmentsHandler(dependencies),
    readAssessmentResultsHandler(dependencies),
    searchCertificationsHandler(dependencies),
    readLearningHistoryHandler(dependencies),

    listInstructorsHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
