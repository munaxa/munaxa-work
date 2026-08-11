import { describe, expect, it } from 'vitest';

import { createDocumentType, permitsOwner, type DocumentTypeState } from './document-type.js';
import {
  createDocument,
  deletionEligibility,
  legalHoldLifted,
  legalHoldPlaced,
  moveDocumentTo,
  verificationRecorded,
  versionAdded,
} from './document.js';

/**
 * Configuration and identity: what a document type may declare, and what a document is.
 *
 * The two rules worth reading first are the ownership rule — a document that evidences a People
 * identifier carries no expiry of its own, because `person_identifier` already owns that (D-1a) —
 * and the deletion rules, under which a verified historical record has no ordinary path out.
 *
 * The file, verification, expiry and access rules are in `documents-file.test.ts`.
 */

const aType = (
  overrides: Partial<Parameters<typeof createDocumentType>[0]> = {},
): DocumentTypeState => {
  const created = createDocumentType({
    documentTypeId: '019fef00-0000-7000-8000-000000000001',
    code: 'passport',
    name: { en: 'Passport', ar: 'جواز سفر' },
    ownerTypes: ['person'],
    expires: true,
    requiresVerification: true,
    confidentiality: 'confidential',
    employeeVisible: true,
    managerVisible: false,
    noticeDays: [30, 90, 60],
    ...overrides,
  });

  if (!created.ok) throw new Error(`fixture refused: ${created.error.reason}`);
  return created.value;
};

describe('a document type', () => {
  it('requires a name in both languages', () => {
    const refused = createDocumentType({
      documentTypeId: 'x',
      code: 'passport',
      name: { en: 'Passport', ar: '  ' },
      ownerTypes: ['person'],
      expires: false,
      requiresVerification: false,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: false,
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.reason).toBe('type_name_incomplete');
  });

  it('refuses an expiring type with no notice thresholds, and orders the ones it has', () => {
    const refused = createDocumentType({
      documentTypeId: 'x',
      code: 'permit',
      name: { en: 'Permit', ar: 'تصريح' },
      ownerTypes: ['person'],
      expires: true,
      requiresVerification: false,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: false,
      noticeDays: [],
    });

    expect(refused.ok ? '' : refused.error.reason).toBe('expiring_type_needs_notice_days');
    // Descending and deduplicated: "90, 60, 30" is the order somebody would say them in.
    expect(aType({ noticeDays: [30, 90, 60, 90] }).noticeDays).toEqual([90, 60, 30]);
  });

  it('refuses a notice threshold on a type that never expires', () => {
    const refused = createDocumentType({
      documentTypeId: 'x',
      code: 'note',
      name: { en: 'Note', ar: 'ملاحظة' },
      ownerTypes: ['person'],
      expires: false,
      requiresVerification: false,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: false,
      noticeDays: [30],
    });

    // A warning that can never be due is configuration nobody can act on.
    expect(refused.ok ? '' : refused.error.reason).toBe('notice_days_without_expiry');
  });

  it('refuses a confidential type that is also manager visible', () => {
    const refused = createDocumentType({
      documentTypeId: 'x',
      code: 'medical',
      name: { en: 'Medical', ar: 'طبي' },
      ownerTypes: ['person'],
      expires: false,
      requiresVerification: false,
      confidentiality: 'confidential',
      employeeVisible: true,
      managerVisible: true,
    });

    // Otherwise the classification is decorative.
    expect(refused.ok ? '' : refused.error.reason).toBe(
      'confidential_type_cannot_be_manager_visible',
    );
  });

  it('refuses `dependent` by name, because nothing in this repository models one', () => {
    const refused = createDocumentType({
      documentTypeId: 'x',
      code: 'dependant-id',
      name: { en: 'Dependant ID', ar: 'هوية تابع' },
      ownerTypes: ['dependent'],
      expires: false,
      requiresVerification: false,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: false,
    });

    // Named rather than reported as unknown, so the gap reads as deliberate.
    expect(refused.ok ? '' : refused.error.reason).toBe('owner_type_not_available');
  });

  it('says which owners it permits', () => {
    expect(permitsOwner(aType(), 'person')).toBe(true);
    expect(permitsOwner(aType(), 'legal_entity')).toBe(false);
  });
});

describe('a document', () => {
  const ownerId = '019fef00-0000-7000-8000-0000000000aa';

  const aDocument = (overrides: Partial<Parameters<typeof createDocument>[0]> = {}) => {
    const created = createDocument({
      documentId: '019fef00-0000-7000-8000-000000000002',
      type: aType(),
      ownerType: 'person',
      ownerId,
      title: { en: 'Passport', ar: 'جواز سفر' },
      source: 'direct',
      ...overrides,
    });

    if (!created.ok) throw new Error(`fixture refused: ${created.error.reason}`);
    return created.value;
  };

  it('starts as a draft that nobody has verified', () => {
    const document = aDocument();

    // Draft, because a document with no file is intent rather than evidence. Unverified, because
    // creating a record is not checking one.
    expect(document.status).toBe('draft');
    expect(document.verificationState).toBe('unverified');
    expect(document.versionCount).toBe(0);
  });

  it('takes its confidentiality from the type, never from the caller', () => {
    // A caller who could choose would file a medical certificate where colleagues can read it.
    expect(aDocument().confidentiality).toBe('confidential');
  });

  it('refuses an owner the type does not permit', () => {
    const refused = createDocument({
      documentId: 'x',
      type: aType(),
      ownerType: 'legal_entity',
      ownerId,
      title: { en: 'Passport', ar: 'جواز' },
      source: 'direct',
    });

    expect(refused.ok ? '' : refused.error.reason).toBe('owner_type_not_permitted_for_type');
  });

  it('refuses an expiry of its own when it evidences a People identifier', () => {
    const refused = createDocument({
      documentId: 'x',
      type: aType(),
      ownerType: 'person',
      ownerId,
      personIdentifierId: '019fef00-0000-7000-8000-0000000000bb',
      title: { en: 'Passport', ar: 'جواز' },
      expiryDate: '2030-01-01',
      source: 'direct',
    });

    // D-1a, in the domain. `person_identifier` owns the expiry; two answers is one too many.
    expect(refused.ok ? '' : refused.error.reason).toBe('identifier_document_holds_no_expiry');
  });

  it('permits an expiry of its own for a document that evidences nothing People owns', () => {
    const document = aDocument({ issueDate: '2020-01-01', expiryDate: '2030-01-01' });

    expect(document.expiryDate).toBe('2030-01-01');
  });

  it('refuses an expiry on a type that does not expire, and one before its issue', () => {
    const notExpiring = createDocument({
      documentId: 'x',
      type: aType({ expires: false, noticeDays: [] }),
      ownerType: 'person',
      ownerId,
      title: { en: 'x', ar: 'x' },
      expiryDate: '2030-01-01',
      source: 'direct',
    });
    const backwards = createDocument({
      documentId: 'x',
      type: aType(),
      ownerType: 'person',
      ownerId,
      title: { en: 'x', ar: 'x' },
      issueDate: '2030-01-01',
      expiryDate: '2020-01-01',
      source: 'direct',
    });

    expect(notExpiring.ok ? '' : notExpiring.error.reason).toBe('type_does_not_expire');
    expect(backwards.ok ? '' : backwards.error.reason).toBe('expiry_before_issue');
  });

  it('becomes active on its first version and un-verifies on a later one', () => {
    const first = versionAdded(aDocument(), 'v1', true);

    expect(first.status).toBe('active');
    expect(first.versionCount).toBe(1);
    expect(first.currentVersionId).toBe('v1');

    const verified = verificationRecorded(first, 'verified');

    expect(verified.ok && verified.value.verificationState).toBe('verified');

    const replaced = versionAdded(verified.ok ? verified.value : first, 'v2', true);

    // The whole point of attaching verification to a version: somebody checked different bytes.
    expect(replaced.verificationState).toBe('pending_verification');
    expect(replaced.versionCount).toBe(2);
    expect(replaced.currentVersionId).toBe('v2');
  });

  it('permits archiving and restoring, and refuses a move nobody listed', () => {
    const active = versionAdded(aDocument(), 'v1', false);
    const archived = moveDocumentTo(
      active,
      'archived',
      new Date('2026-08-01T00:00:00Z'),
      'user:hr',
    );

    expect(archived.ok && archived.value.status).toBe('archived');
    expect(archived.ok && archived.value.archivedBy).toBe('user:hr');

    const restored = moveDocumentTo(
      archived.ok ? archived.value : active,
      'active',
      new Date(),
      'user:hr',
    );

    expect(restored.ok && restored.value.status).toBe('active');
    expect(restored.ok && restored.value.archivedAt).toBeUndefined();

    const impossible = moveDocumentTo(active, 'draft', new Date(), 'user:hr');

    expect(impossible.ok ? '' : impossible.error.reason).toBe('document_transition_not_permitted');
  });

  it('refuses to archive a document under legal hold', () => {
    const held = legalHoldPlaced(versionAdded(aDocument(), 'v1', false), 'tribunal case 4471');

    expect(held.ok).toBe(true);

    const archived = moveDocumentTo(
      held.ok ? held.value : aDocument(),
      'archived',
      new Date(),
      'x',
    );

    // Archiving under hold would be a quiet way to stop a document appearing in the searches the
    // hold exists to guarantee.
    expect(archived.ok ? '' : archived.error.reason).toBe('document_under_legal_hold');
  });

  it('requires a reason for a legal hold, and lets one be lifted', () => {
    const document = aDocument();

    expect(legalHoldPlaced(document, '   ').ok).toBe(false);

    const held = legalHoldPlaced(document, 'tribunal case 4471');
    const lifted = legalHoldLifted(held.ok ? held.value : document);

    expect(lifted.ok && lifted.value.legalHold).toBe(false);
    expect(lifted.ok && lifted.value.legalHoldReason).toBeUndefined();
    expect(legalHoldLifted(document).ok).toBe(false);
  });

  it('has no ordinary path out for a verified, held or filed document', () => {
    const draft = aDocument();
    const withFile = versionAdded(draft, 'v1', false);
    const verified = verificationRecorded(withFile, 'verified');
    const held = legalHoldPlaced(draft, 'tribunal');

    const reasonFor = (state: typeof draft): string => {
      const outcome = deletionEligibility(state);

      return outcome.ok ? 'eligible' : outcome.error.reason;
    };

    // A draft nobody ever attached anything to is a mistake, not a record.
    expect(reasonFor(draft)).toBe('eligible');
    expect(reasonFor(withFile)).toBe('document_with_versions_not_deletable');
    expect(reasonFor(verified.ok ? verified.value : draft)).toBe('verified_document_not_deletable');
    expect(reasonFor(held.ok ? held.value : draft)).toBe('document_under_legal_hold');
  });
});
