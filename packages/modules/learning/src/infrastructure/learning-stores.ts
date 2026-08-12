import {
  PostgresCategoryRepository,
  PostgresCourseRepository,
  PostgresCourseVersionRepository,
} from './catalogue.repository.js';
import {
  PostgresAssessmentRepository,
  PostgresAssessmentResultRepository,
} from './assessment.repository.js';
import { PostgresMandatoryRuleRepository, PostgresPathRepository } from './path.repository.js';
import { PostgresAssignmentRepository } from './assignment.repository.js';
import { PostgresEnrolmentRepository } from './enrolment.repository.js';
import {
  PostgresCertificationRepository,
  PostgresInstructorRepository,
} from './certification.repository.js';
import type { LearningStores } from '../application/learning-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to. Every application store in `LearningStores` has an
 * implementation here; the type would not compile if one were missing, which is the point of
 * returning the whole interface rather than a partial.
 *
 * **Nothing here opens a transaction.** Each repository takes the `Transaction` the application
 * layer's unit of work established, so a command that writes an enrolment and closes an assignment
 * does both or neither.
 */
export const postgresLearningStores = (): LearningStores => ({
  categories: new PostgresCategoryRepository(),
  courses: new PostgresCourseRepository(),
  versions: new PostgresCourseVersionRepository(),
  assessments: new PostgresAssessmentRepository(),
  results: new PostgresAssessmentResultRepository(),
  paths: new PostgresPathRepository(),
  rules: new PostgresMandatoryRuleRepository(),
  assignments: new PostgresAssignmentRepository(),
  enrolments: new PostgresEnrolmentRepository(),
  certifications: new PostgresCertificationRepository(),
  instructors: new PostgresInstructorRepository(),
});
