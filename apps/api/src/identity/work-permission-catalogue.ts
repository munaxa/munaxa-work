import { ALL_ASSETS_PERMISSIONS } from '@work/assets';
import { ALL_ATTENDANCE_PERMISSIONS } from '@work/attendance';
import { ALL_CAREER_PERMISSIONS } from '@work/career';
import { ALL_COMPENSATION_PERMISSIONS } from '@work/compensation';
import { ALL_DOCUMENTS_PERMISSIONS } from '@work/documents';
import { ALL_EMPLOYMENT_PERMISSIONS } from '@work/employment';
import { ALL_IDENTITY_PERMISSIONS } from '@work/identity';
import { ALL_LEARNING_PERMISSIONS } from '@work/learning';
import { ALL_LEAVE_PERMISSIONS } from '@work/leave';
import { ALL_LETTERS_PERMISSIONS } from '@work/letters';
import { ALL_ONBOARDING_PERMISSIONS } from '@work/onboarding';
import { ALL_ORGANIZATION_PERMISSIONS } from '@work/organization';
import { ALL_PAYROLL_PERMISSIONS } from '@work/payroll';
import { ALL_PEOPLE_PERMISSIONS } from '@work/people';
import { ALL_PERFORMANCE_PERMISSIONS } from '@work/performance';
import { ALL_RECRUITMENT_PERMISSIONS } from '@work/recruitment';
import { ALL_RELATIONS_PERMISSIONS } from '@work/relations';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

/**
 * Every permission Munaxa Work declares — the closed vocabulary a Platform grant is checked against
 * (ADR-0076, rule 7).
 *
 * **Why a catalogue is needed at all.** Without one, `work:` plus anything syntactically valid would
 * translate into a permission, and a grant could name an authority Work never declared. Work owns
 * the vocabulary, so the only names that mean anything are the names Work wrote down. A grant
 * outside this set confers nothing, and cannot bring a new permission into existence.
 *
 * **Why it is assembled from the modules rather than resolved from the dispatcher.** The dispatcher
 * knows the same answer — `declaredPermissions()` derives it from the registered handlers — but it
 * is built from the permission checker, which would need this catalogue: a cycle in the composition
 * root. Each module already publishes its own list as a constant, so the catalogue is a static
 * import with no dependency on the module graph, and `work-permission-catalogue.spec.ts` proves the
 * two agree in shape and count rather than assuming it.
 *
 * A module added without its permissions appearing here fails closed: its permissions become
 * ungrantable, not ungoverned.
 */
const DECLARED: readonly (readonly string[])[] = [
  ALL_ASSETS_PERMISSIONS,
  ALL_ATTENDANCE_PERMISSIONS,
  ALL_CAREER_PERMISSIONS,
  ALL_COMPENSATION_PERMISSIONS,
  ALL_DOCUMENTS_PERMISSIONS,
  ALL_EMPLOYMENT_PERMISSIONS,
  ALL_IDENTITY_PERMISSIONS,
  ALL_LEARNING_PERMISSIONS,
  ALL_LEAVE_PERMISSIONS,
  ALL_LETTERS_PERMISSIONS,
  ALL_ONBOARDING_PERMISSIONS,
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PAYROLL_PERMISSIONS,
  ALL_PEOPLE_PERMISSIONS,
  ALL_PERFORMANCE_PERMISSIONS,
  ALL_RECRUITMENT_PERMISSIONS,
  ALL_RELATIONS_PERMISSIONS,
  ALL_WORKFLOW_PERMISSIONS,
];

/** The catalogue as a set, which is the shape every authorization check reads it in. */
export const WORK_PERMISSION_CATALOGUE: ReadonlySet<string> = new Set(DECLARED.flat());

/** The same catalogue, sorted — what the Platform grant artifact is generated from. */
export const workPermissionCatalogue = (): readonly string[] =>
  [...WORK_PERMISSION_CATALOGUE].sort();
