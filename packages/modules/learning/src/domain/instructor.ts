import {
  accept,
  isLocalizedName,
  refuse,
  type LearningResult,
  type LocalizedName,
} from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * Who teaches — as an identity, and only as an identity (D-6).
 *
 * **An internal instructor is an employment, not a copy of one.** `employmentId` references
 * Employment's record and this module stores no name, no job title, no contact detail and no
 * department beside it. A copied name goes stale the day somebody marries; a copied department goes
 * stale the day they transfer; and the copy would silently become the version screens showed.
 *
 * **An external instructor is a Learning-owned record, and no fake Person is created for them.** A
 * visiting fire-safety trainer from another company is not an employee, not an applicant and not a
 * person this organisation keeps records about — manufacturing a `person` row for them would put a
 * non-employee into headcount reports, org charts, document queues and every other place People and
 * Employment legitimately look. Their name lives here, where it means "somebody who taught a course",
 * and nowhere else.
 *
 * **This module schedules nobody.** There is no availability, no calendar, no assignment to a
 * session, no rate and no booking. Sessions are Phase 14B, and an instructor row here answers "who
 * delivered this" and "who may we call", not "who is free on Tuesday".
 */

export interface InstructorState {
  readonly instructorId: string;
  /** Present for an internal instructor. The only link — no copied personal data travels with it. */
  readonly employmentId?: string;
  /** Present for an external instructor. This module owns the name because nobody else should. */
  readonly externalName?: LocalizedName;
  /** The external instructor's organisation, in the tenant's own words. Never interpreted. */
  readonly externalOrganization?: string;
  /** A contact address for an external instructor. Absent for an internal one — Employment has it. */
  readonly externalContact?: string;
  readonly active: boolean;
  readonly version: number;
}

export interface RegisterInstructorRequest {
  readonly instructorId: string;
  readonly employmentId?: string;
  readonly externalName?: LocalizedName;
  readonly externalOrganization?: string;
  readonly externalContact?: string;
}

/**
 * Registering an instructor, and the exclusivity that keeps the boundary honest.
 *
 * Exactly one of the two identities: an internal instructor with a copied external name would have
 * two names that could disagree, and a record with neither would be an instructor who is nobody. The
 * database enforces the same rule again as a check constraint, because a boundary worth stating in a
 * decision record is worth being unable to violate.
 */
export const registerInstructor = (
  request: RegisterInstructorRequest,
): LearningResult<InstructorState> => {
  const internal = request.employmentId !== undefined;
  const external = request.externalName !== undefined;

  if (internal && external) return refuse('instructor-identity-ambiguous');
  if (!internal && !external) return refuse('instructor-identity-required');
  if (external && !isLocalizedName(request.externalName)) return refuse('instructor-name-required');
  // Contact details belong to whoever owns the identity. An internal instructor's are Employment's,
  // and a second copy here would be the one somebody eventually emailed after it went stale.
  if (
    internal &&
    (request.externalOrganization !== undefined || request.externalContact !== undefined)
  ) {
    return refuse('instructor-internal-has-no-external-detail');
  }

  return accept({
    instructorId: request.instructorId,
    active: true,
    version: 1,
    ...definedOf({
      employmentId: request.employmentId,
      externalName: request.externalName,
      externalOrganization: request.externalOrganization,
      externalContact: request.externalContact,
    }),
  });
};

/**
 * Deactivating removes somebody from the list of people a tenant may call on.
 *
 * It is not deletion: a course delivered in 2023 was delivered by somebody, and a certification
 * issued on the back of it stays explainable only while that somebody is still readable.
 */
export const deactivateInstructor = (state: InstructorState): LearningResult<InstructorState> => {
  if (!state.active) return refuse('instructor-already-inactive');

  return accept({ ...state, active: false });
};

/** Whether this instructor is one of the tenant's own people. Read by the Employment adapter only. */
export const isInternal = (state: InstructorState): boolean => state.employmentId !== undefined;
