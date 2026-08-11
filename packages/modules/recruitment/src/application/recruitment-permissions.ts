/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Four separations are deliberate, and each protects a different thing.**
 *
 * *Approving* a requisition is not managing one. A requisition authorizes headcount spending, and
 * the person who drafts the request is not automatically the person who may commit the budget.
 *
 * *Publishing* a vacancy is not editing one. Publication is the moment a posting becomes externally
 * visible, and in several of this product's markets a published advertisement carries obligations a
 * draft does not.
 *
 * *Writing feedback* is what an interviewer does; managing interviews is what a recruiter does.
 * Holding the second must not grant the first, or a recruiter could enter a score in an
 * interviewer's name.
 *
 * *Hiring* is the single act that reaches into the master registry of human identity and creates an
 * employment. It is held by fewest people, and — this is the point of ADR-0043 — it does **not**
 * require the holder to also hold `people.person.manage`.
 *
 * Reading an **offer** is separate from reading an application, because an offer carries proposed
 * pay. Reading **feedback** is separate for the same reason in the other direction: it carries an
 * interviewer's candid opinion of a person who does not work here.
 */
export const RecruitmentPermissions = {
  requisitionRead: 'recruitment.requisition.read',
  requisitionManage: 'recruitment.requisition.manage',
  /** Committing headcount. Separate from drafting the request. */
  requisitionApprove: 'recruitment.requisition.approve',

  vacancyRead: 'recruitment.vacancy.read',
  vacancyManage: 'recruitment.vacancy.manage',
  /** Making a posting externally visible. */
  vacancyPublish: 'recruitment.vacancy.publish',

  candidateRead: 'recruitment.candidate.read',
  candidateManage: 'recruitment.candidate.manage',
  /** Removing a candidate's personal data under a retention policy. Irreversible. */
  candidateAnonymize: 'recruitment.candidate.anonymize',

  applicationRead: 'recruitment.application.read',
  applicationManage: 'recruitment.application.manage',

  interviewRead: 'recruitment.interview.read',
  interviewManage: 'recruitment.interview.manage',
  /** What an interviewer does. Never granted by managing interviews. */
  feedbackWrite: 'recruitment.interview.feedback.write',
  /** An interviewer's candid opinion of somebody outside the company. */
  feedbackRead: 'recruitment.interview.feedback.read',

  /** An offer carries proposed pay, so reading one is not reading the application. */
  offerRead: 'recruitment.offer.read',
  offerManage: 'recruitment.offer.manage',
  offerApprove: 'recruitment.offer.approve',

  /** The act that creates a Person and an Employment. Held by fewest people. */
  hire: 'recruitment.hire',

  importCandidates: 'recruitment.import',
  /** Taking the candidate register out of the product. Separate, and held by fewer than read. */
  exportRecruitment: 'recruitment.export',
} as const;

export type RecruitmentPermission =
  (typeof RecruitmentPermissions)[keyof typeof RecruitmentPermissions];

export const ALL_RECRUITMENT_PERMISSIONS: readonly RecruitmentPermission[] =
  Object.values(RecruitmentPermissions);
