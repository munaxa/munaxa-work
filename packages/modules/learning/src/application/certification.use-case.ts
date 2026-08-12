import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  addMonths,
  issueCertification,
  revokeCertification,
  supersedeCertification,
} from '../domain/certification.js';
import { satisfyAssignment } from '../domain/assignment.js';
import type { CertificationSource } from '../domain/learning-vocabulary.js';
import { currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Issuing what this employer says somebody holds, and for how long (ADR-0070).
 *
 * **Learning owns this expiry and duplicates nobody else's.** `person_history.expires_on` keeps what
 * somebody arrived with, `document.expiry_date` keeps the validity of a scan, and this keeps the
 * validity of the qualification itself. Where the same certificate is also a Document, this row
 * *references* it through `evidenceDocumentId` and stores no second expiry date, no filename and no
 * bytes.
 *
 * **Validity is derived, and `validUntil` is the only fact stored.** Nothing writes an `expired`
 * flag, because nothing in this repository would move one on the right morning.
 *
 * **A certification may exist with no enrolment behind it** (D-2). A tenant recording a forklift
 * licence somebody already held must be able to; only a `learning_completion` source needs an
 * enrolment, because that is the one claiming a course was taken here.
 */

export interface IssueCertificationCommand extends Command {
  readonly commandName: 'learning.issue-certification';
  readonly employmentId: string;
  readonly enrolmentId?: string;
  readonly courseId?: string;
  readonly title: string;
  readonly source: CertificationSource;
  readonly issuedOn: string;
  /** Stated by the caller, or derived from the course version's configured period where absent. */
  readonly validUntil?: string;
  readonly supersedesCertificationId?: string;
  readonly evidenceDocumentId?: string;
}

export interface CertificationIdentified {
  readonly certificationId: string;
  /** False where this enrolment had already produced one. The retry-safe answer. */
  readonly created: boolean;
}

export const issueCertificationHandler = (
  dependencies: LearningDependencies,
): CommandHandler<IssueCertificationCommand, CertificationIdentified> => ({
  commandName: 'learning.issue-certification',
  permission: LearningPermissions.certificationManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const refusal = await confirmIssuance(dependencies, transaction, command);

      if (refusal !== undefined) return refuseWith<CertificationIdentified>(refusal);

      const validUntil = await validityFor(dependencies, transaction, command);
      const issued = issueCertification({
        certificationId: uuidV7(),
        issuedBy: currentActor(),
        ...command,
        ...(validUntil === undefined ? {} : { validUntil }),
      });

      if (!issued.ok) return refusedBy<CertificationIdentified>(issued.error);

      const written = await dependencies.stores.certifications.insertIfAbsent(
        transaction,
        issued.value,
      );

      if (!written) {
        const existing =
          command.enrolmentId === undefined
            ? undefined
            : await dependencies.stores.certifications.forEnrolment(
                transaction,
                command.enrolmentId,
              );

        return success({
          certificationId: existing?.certificationId ?? issued.value.certificationId,
          created: false,
        });
      }

      await supersedePredecessor(dependencies, transaction, command.supersedesCertificationId);
      await satisfyHeldRequirement(
        dependencies,
        transaction,
        issued.value.certificationId,
        command,
      );
      return success({ certificationId: issued.value.certificationId, created: true });
    }),
});

type Transaction = Parameters<Parameters<LearningDependencies['unitOfWork']['execute']>[0]>[0];

/**
 * The three things that must be true before anything is issued.
 *
 * The employment is confirmed through Employment's published contract — a certificate issued to
 * somebody who does not exist would still appear in every compliance count. The enrolment behind a
 * completion must actually be completed. And an evidence document is confirmed to exist through
 * Documents' contract: a reference to nothing would let a screen imply there is a certificate on
 * file when there is not.
 */
const confirmIssuance = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  command: IssueCertificationCommand,
): Promise<string | undefined> => {
  const facts = await dependencies.employment.factsFor(
    command.employmentId,
    dependencies.clock.now(),
  );

  if (facts === undefined) return 'certification-employment-unknown';

  if (command.enrolmentId !== undefined) {
    const enrolment = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

    if (enrolment === undefined) return 'certification-enrolment-unknown';
    if (enrolment.status !== 'completed') return 'certification-enrolment-not-completed';
    if (enrolment.employmentId !== command.employmentId) {
      return 'certification-enrolment-other-employment';
    }
  }

  if (command.evidenceDocumentId !== undefined) {
    const known = await dependencies.documents.exists(command.evidenceDocumentId);

    if (!known) return 'certification-evidence-unknown';
  }
  return undefined;
};

/**
 * How long it stays valid: what the caller said, or what the course version was configured with.
 *
 * Derived from `certificationValidMonths` on the **pinned** version rather than the course's current
 * one, so a change to the syllabus's validity period does not retroactively shorten a certificate
 * issued under the old one. Where neither is present, the certification has no expiry at all — which
 * is a real answer and not a missing one.
 */
const validityFor = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  command: IssueCertificationCommand,
): Promise<string | undefined> => {
  if (command.validUntil !== undefined) return command.validUntil;
  if (command.enrolmentId === undefined) return undefined;

  const enrolment = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

  if (enrolment === undefined) return undefined;

  const version = await dependencies.stores.versions.byId(transaction, enrolment.courseVersionId);
  const months = version?.certificationValidMonths;

  return months === undefined ? undefined : addMonths(command.issuedOn, months);
};

/** A recertification marks its predecessor superseded. The old row stays and says what replaced it. */
const supersedePredecessor = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  predecessorId: string | undefined,
): Promise<void> => {
  if (predecessorId === undefined) return;

  const held = await dependencies.stores.certifications.byId(transaction, predecessorId);

  if (held === undefined) return;

  const superseded = supersedeCertification(held);

  if (superseded.ok) {
    await dependencies.stores.certifications.update(transaction, superseded.value, held.version);
  }
};

/**
 * Closes an open assignment for the same course, where the certification satisfies one.
 *
 * This is D-2's other half: somebody who already holds the licence a rule demands should not be sent
 * on the course to prove it. A refusal is not an error — an assignment already waived is terminal,
 * and the certification stands regardless.
 */
const satisfyHeldRequirement = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  certificationId: string,
  command: IssueCertificationCommand,
): Promise<void> => {
  if (command.courseId === undefined) return;

  const open = await dependencies.stores.assignments.openFor(
    transaction,
    command.employmentId,
    command.courseId,
  );

  if (open === undefined) return;

  const satisfied = satisfyAssignment(open, { at: dependencies.clock.now(), certificationId });

  if (satisfied.ok) {
    await dependencies.stores.assignments.update(transaction, satisfied.value, open.version);
  }
};

export interface RevokeCertificationCommand extends Command {
  readonly commandName: 'learning.revoke-certification';
  readonly certificationId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

export interface CertificationMoved {
  readonly certificationId: string;
  readonly status: string;
}

/**
 * Taking a qualification away — its own permission, its own reason, its own name against it.
 *
 * Revoked is not expired: one says the issuer withdrew it, the other says time passed. A report that
 * could not tell them apart would describe two very different people the same way.
 */
export const revokeCertificationHandler = (
  dependencies: LearningDependencies,
): CommandHandler<RevokeCertificationCommand, CertificationMoved> => ({
  commandName: 'learning.revoke-certification',
  permission: LearningPermissions.certificationRevoke,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.certifications.byId(
        transaction,
        command.certificationId,
      );

      if (held === undefined) return notFound<CertificationMoved>('learning_certification');

      const revoked = revokeCertification(
        held,
        dependencies.clock.now(),
        currentActor(),
        command.reason,
      );

      if (!revoked.ok) return refusedBy<CertificationMoved>(revoked.error);

      await dependencies.stores.certifications.update(
        transaction,
        revoked.value,
        command.expectedVersion,
      );
      return success({ certificationId: held.certificationId, status: revoked.value.status });
    }),
});
