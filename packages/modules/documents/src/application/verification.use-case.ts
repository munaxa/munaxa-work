import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { canDecideOn, recordVerification } from '../domain/verification.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import { legalHoldLifted, legalHoldPlaced, verificationRecorded } from '../domain/document.js';
import { recordAccessFor } from './access-recording.js';
import { hiddenFromCaller } from './confidentiality.js';
import { conflicted, currentActor, notFound, refusedBy } from './documents-context.js';
import { DocumentsPermissions } from './documents-permissions.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Deciding whether a version is what it claims to be.
 *
 * **One authenticated human, and no second-verifier requirement.** D-6 settled this: a single HR
 * verifier is the ordinary case, and a two-person rule would make the feature unusable for a
 * forty-person customer with one HR administrator. What is not optional is *who* — `decidedBy`
 * comes from the authenticated context and never from the command, so a caller cannot record
 * somebody else's name against their own upload.
 *
 * **The decision attaches to a version.** Replacing the file afterwards returns the document to
 * `pending_verification` (the domain does that), because nobody has looked at the new bytes. A
 * unique index refuses a second decision on the same version, so two verifiers racing on one
 * version produce one decision and one refusal rather than two rows.
 *
 * `system:auto-approval` appears nowhere. A document verified by nobody is a document nobody
 * accepted responsibility for.
 */

export interface VerifyDocumentCommand extends Command {
  readonly commandName: 'documents.verify';
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly decision: string;
  readonly reason?: string;
}

export interface VerificationDecided {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly decision: string;
}

export const verifyDocumentHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<VerifyDocumentCommand, VerificationDecided> => ({
  commandName: 'documents.verify',
  permission: DocumentsPermissions.verify,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, command.documentId);

      if (document === undefined) return notFound<VerificationDecided>('document');

      const version = await dependencies.stores.versions.byId(
        transaction,
        command.documentVersionId,
      );

      if (version === undefined || version.documentId !== document.documentId) {
        return notFound<VerificationDecided>('document_version');
      }

      const decidable = canDecideOn(version);

      if (!decidable.ok) return refusedBy<VerificationDecided>(decidable.error);

      const decision = recordVerification({
        verificationId: uuidV7(),
        documentId: document.documentId,
        documentVersionId: version.documentVersionId,
        decision: command.decision,
        decidedBy: currentActor(),
        decidedAt: dependencies.clock.now(),
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      });

      if (!decision.ok) return refusedBy<VerificationDecided>(decision.error);

      const moved = verificationRecorded(document, decision.value.decision);

      if (!moved.ok) return refusedBy<VerificationDecided>(moved.error);

      await dependencies.stores.verifications.insert(transaction, decision.value);
      await dependencies.stores.documents.update(transaction, moved.value, document.version);
      await recordAccessFor(dependencies, transaction, {
        documentId: document.documentId,
        documentVersionId: version.documentVersionId,
        action: decision.value.decision === 'verified' ? 'verified' : 'rejected',
      });

      return success({
        documentId: document.documentId,
        documentVersionId: version.documentVersionId,
        decision: decision.value.decision,
      });
    }),
});

export interface PlaceLegalHoldCommand extends Command {
  readonly commandName: 'documents.legal-hold';
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly hold: boolean;
  readonly reason?: string;
}

export interface LegalHoldChanged {
  readonly documentId: string;
  readonly legalHold: boolean;
}

/**
 * Placing and lifting a legal hold.
 *
 * A hold refuses archiving and refuses deletion, and it requires a stated reason — a hold nobody
 * can explain is a hold nobody can lift. **This module defines no retention period**: how long a
 * document must be kept is country-pack and GRC content, and `retentionPolicyCode` is an opaque
 * code this module stores and never interprets (D-11).
 */
export const placeLegalHoldHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<PlaceLegalHoldCommand, LegalHoldChanged> => ({
  commandName: 'documents.legal-hold',
  permission: DocumentsPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, command.documentId);

      if (document === undefined) return notFound<LegalHoldChanged>('document');

      const changed = command.hold
        ? legalHoldPlaced(document, command.reason ?? '')
        : legalHoldLifted(document);

      if (!changed.ok) return refusedBy<LegalHoldChanged>(changed.error);

      await dependencies.stores.documents.update(
        transaction,
        changed.value,
        command.expectedVersion,
      );
      return success({
        documentId: document.documentId,
        legalHold: changed.value.legalHold,
      });
    }),
});

export interface AuthorizeDownloadCommand extends Command {
  readonly commandName: 'documents.authorize-download';
  readonly documentId: string;
  readonly documentVersionId?: string;
}

export interface DownloadAuthorization {
  readonly documentId: string;
  readonly documentVersionId: string;
  /** Present only when a storage adapter exists. Absent is the honest answer today. */
  readonly url?: string;
  readonly available: boolean;
  readonly expiresInSeconds: number;
}

/** Two minutes. A link that outlives the click is a link somebody forwards. */
const URL_LIFETIME_SECONDS = 120;

/**
 * Authorizing a download — **and only then** asking storage for a URL.
 *
 * The order is the security property, and it is the order this reads in: resolve the document,
 * confirm the caller's permission (the pipeline did that before this ran), confirm the version,
 * record the access, and *last* reach for a signed URL. Nothing computes a URL before the access
 * is authorized, so a refused caller never causes one to exist.
 *
 * **The access is recorded whether or not storage answers.** An attempt that could not be served is
 * still an attempt somebody made, and the trail is more useful for containing the refusals.
 *
 * There is no storage adapter in this repository, so `available` is false and `url` is absent. That
 * is reported honestly rather than as a failure and never as a fabricated link.
 */
export const authorizeDownloadHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<AuthorizeDownloadCommand, DownloadAuthorization> => ({
  commandName: 'documents.authorize-download',
  permission: DocumentsPermissions.download,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, command.documentId);

      if (document === undefined) return notFound<DownloadAuthorization>('document');
      // Confidentiality binds the download as it binds the read: `document.download` alone does not
      // reach a confidential file, and the answer is "not found" rather than "forbidden".
      if (await hiddenFromCaller(dependencies, document)) {
        return notFound<DownloadAuthorization>('document');
      }

      const versionId = command.documentVersionId ?? document.currentVersionId;

      if (versionId === undefined)
        return conflicted<DownloadAuthorization>('document_has_no_version');

      const version = await dependencies.stores.versions.byId(transaction, versionId);

      if (version === undefined || version.documentId !== document.documentId) {
        return notFound<DownloadAuthorization>('document_version');
      }

      return success(await signAndRecord(dependencies, transaction, version));
    }),
});

/**
 * Ask storage, then record — in that order, and record either way.
 *
 * Reached only once the document has been resolved and the caller's access to it settled, which is
 * what keeps a refused caller from ever causing a URL to be computed. An attempt that could not be
 * served is still an attempt somebody made, so the trail records the refusal too.
 */
const signAndRecord = async (
  dependencies: DocumentsDependencies,
  transaction: Transaction,
  version: DocumentVersionState,
): Promise<DownloadAuthorization> => {
  const url = await dependencies.storage.signedUrl({
    storageReference: version.storageReference,
    expiresInSeconds: URL_LIFETIME_SECONDS,
  });

  await recordAccessFor(dependencies, transaction, {
    documentId: version.documentId,
    documentVersionId: version.documentVersionId,
    action: url === undefined ? 'download_refused' : 'download_authorized',
    outcome: url === undefined ? 'refused' : 'permitted',
  });

  return {
    documentId: version.documentId,
    documentVersionId: version.documentVersionId,
    available: dependencies.storage.available && url !== undefined,
    expiresInSeconds: URL_LIFETIME_SECONDS,
    ...(url === undefined ? {} : { url }),
  };
};
