/**
 * What another module may import from Learning.
 *
 * Views only. No handler, no store, no dependency type and no domain aggregate: a consumer that
 * could reach a handler could bypass this module's permission checks, and one that could reach a
 * store would be querying Learning's tables from outside Learning.
 *
 * **Nothing in Learning is pushed anywhere.** Performance, Career and Compensation pull a
 * certification or a completion when they want one; Learning modifies nothing outside itself
 * (AD-005). In particular Learning writes no capability to People: what somebody *claims* is
 * People's record, what they *attained* is this one, and AD-002 says the second does not imply a
 * competency.
 */
export type {
  AssessmentResultView,
  AssessmentView,
  AssignmentView,
  CertificationView,
  CourseCategoryView,
  CourseVersionView,
  CourseView,
  EnrolmentView,
  InstructorView,
  LearningHistoryView,
  LocalizedTextView,
  MandatoryRuleView,
  PathDetailView,
  PathStepView,
  PathView,
  ReconciliationView,
} from './views.js';
