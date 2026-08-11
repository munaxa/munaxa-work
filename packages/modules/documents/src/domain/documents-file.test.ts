import { describe, expect, it } from 'vitest';

import { createVersion, isSameContent, nextVersionNumber } from './document-version.js';
import { canDecideOn, recordVerification } from './verification.js';
import { addDays, expiryStateOf, inBothCalendars, noticeThresholdCrossed } from './expiry.js';
import { recordAccess } from './access-event.js';

/**
 * What this module records about a file it cannot read, and the rules around it.
 *
 * The theme is honesty about the gap. No storage adapter exists, so nothing has seen the bytes: the
 * declared media type is recorded as *claimed*, the detected one stays absent, and the hash is
 * stored unverified. A version is never described as validated because it was accepted.
 *
 * Verification, expiry derivation and the access trail are here too, because each is about the file
 * rather than about the document's identity.
 */

const HASH = 'a'.repeat(64);

describe('a document version', () => {
  const request = {
    documentVersionId: 'v1',
    documentId: 'd1',
    versionNumber: 1,
    storageReference: 'doc:store:2026/abc',
    originalFileName: 'passport.pdf',
    declaredMediaType: 'application/pdf',
    sizeInBytes: 1024n,
    contentHash: HASH,
    source: 'direct' as const,
  };

  it('records what the client claimed and admits it verified nothing', () => {
    const created = createVersion(request);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.declaredMediaType).toBe('application/pdf');
    // No storage adapter exists, so nothing has looked at the bytes. The row says so rather than
    // implying the file was inspected because it was accepted.
    expect(created.value.detectedMediaType).toBeUndefined();
    expect(created.value.hashVerified).toBe(false);
    expect(created.value.hashAlgorithm).toBe('sha-256');
    expect(created.value.verificationState).toBe('unverified');
  });

  it('refuses a malformed reference, media type, hash, name or size', () => {
    const cases: readonly [Partial<typeof request>, string][] = [
      [{ storageReference: 'https://bucket.example.com/x' }, 'storage_reference_malformed'],
      [{ declaredMediaType: 'pdf' }, 'media_type_malformed'],
      [{ contentHash: 'short' }, 'content_hash_malformed'],
      [{ originalFileName: '  ' }, 'file_name_invalid'],
      [{ sizeInBytes: -1n }, 'size_invalid'],
      [{ versionNumber: 0 }, 'version_number_invalid'],
    ];

    for (const [override, reason] of cases) {
      const refused = createVersion({ ...request, ...override });

      expect(refused.ok ? 'accepted' : refused.error.reason).toBe(reason);
    }
  });

  it('rejects a URL as a storage reference', () => {
    // The reference is opaque by design: nothing may infer a provider, a bucket or a path from it.
    expect(createVersion({ ...request, storageReference: 's3://bucket/key' }).ok).toBe(false);
  });

  it('recognises identical content without refusing it', () => {
    const one = { contentHash: HASH, hashAlgorithm: 'sha-256' };
    const same = { contentHash: HASH, hashAlgorithm: 'sha-256' };
    const other = { contentHash: 'b'.repeat(64), hashAlgorithm: 'sha-256' };

    // Permitted and flagged, never refused: one scan can legitimately evidence two things.
    expect(isSameContent(one, same)).toBe(true);
    expect(isSameContent(one, other)).toBe(false);
    expect(nextVersionNumber(3)).toBe(4);
  });
});

describe('verification', () => {
  const request = {
    verificationId: 'ver1',
    documentId: 'd1',
    documentVersionId: 'v1',
    decision: 'verified',
    decidedBy: 'user:hr',
    decidedAt: new Date('2026-08-01T09:00:00Z'),
  };

  it('records a named human and their decision', () => {
    const recorded = recordVerification(request);

    expect(recorded.ok && recorded.value.decidedBy).toBe('user:hr');
    expect(recorded.ok && recorded.value.documentVersionId).toBe('v1');
  });

  it('requires a reason to reject and an actor always', () => {
    expect(
      recordVerification({ ...request, decision: 'rejected' }).ok ? '' : 'rejection_needs_reason',
    ).toBe('rejection_needs_reason');
    expect(recordVerification({ ...request, decidedBy: ' ' }).ok).toBe(false);
    expect(recordVerification({ ...request, decision: 'approved' }).ok).toBe(false);
  });

  it('refuses a second decision on the same version, and any decision on a superseded one', () => {
    expect(canDecideOn({ verificationState: 'pending_verification' }).ok).toBe(true);

    const decided = canDecideOn({ verificationState: 'verified' });
    const superseded = canDecideOn({
      verificationState: 'pending_verification',
      supersededAt: new Date(),
    });

    expect(decided.ok ? '' : decided.error.reason).toBe('version_already_decided');
    // A verdict on bytes that are no longer current tells nobody anything.
    expect(superseded.ok ? '' : superseded.error.reason).toBe('version_superseded');
  });
});

describe('expiry', () => {
  const window = { today: '2026-08-11', noticeDays: [90, 60, 30] };

  it('derives every state from the date and today', () => {
    expect(expiryStateOf(undefined, window)).toBe('no_expiry');
    expect(expiryStateOf('2026-08-10', window)).toBe('expired');
    expect(expiryStateOf('2026-09-01', window)).toBe('expiring_soon');
    expect(expiryStateOf('2030-01-01', window)).toBe('valid');
  });

  it('reports the nearest threshold crossed, not the widest', () => {
    // 20 days out is inside 30, 60 and 90; the useful answer is 30.
    expect(noticeThresholdCrossed('2026-08-31', window)).toBe(30);
    expect(noticeThresholdCrossed('2026-10-05', window)).toBe(60);
    expect(noticeThresholdCrossed('2030-01-01', window)).toBeUndefined();
    // An already-expired document has crossed no threshold: it is past all of them.
    expect(noticeThresholdCrossed('2020-01-01', window)).toBeUndefined();
  });

  it('adds days as calendar days in UTC', () => {
    expect(addDays('2026-08-11', 30)).toBe('2026-09-10');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('renders a date in both calendars without storing two of them', () => {
    const both = inBothCalendars('2026-08-11');

    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(both.value.gregorian).toBe('2026-08-11');
    expect(both.value.hijri.calendar).toBe('hijri');
    expect(both.value.hijri.year).toBeGreaterThan(1400);
    expect(inBothCalendars('11/08/2026').ok).toBe(false);
  });
});

describe('the access trail', () => {
  const request = {
    accessEventId: 'a1',
    documentId: 'd1',
    action: 'download_authorized',
    actor: 'user:hr',
    occurredAt: new Date('2026-08-11T09:00:00Z'),
    outcome: 'permitted' as const,
  };

  it('records a permitted access and a refused one alike', () => {
    const permitted = recordAccess(request);
    const refused = recordAccess({ ...request, action: 'download_refused', outcome: 'refused' });

    expect(permitted.ok && permitted.value.outcome).toBe('permitted');
    // The interesting half: somebody trying to reach a document they may not see.
    expect(refused.ok && refused.value.outcome).toBe('refused');
  });

  it('refuses an unknown action or a missing actor', () => {
    expect(recordAccess({ ...request, action: 'exfiltrated' }).ok).toBe(false);
    expect(recordAccess({ ...request, actor: '' }).ok).toBe(false);
  });

  it('carries nothing that would make the trail itself a disclosure', () => {
    const recorded = recordAccess(request);

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    // No content, no storage reference, no URL, no credential — by construction of the type.
    expect(Object.keys(recorded.value).sort()).toEqual([
      'accessEventId',
      'action',
      'actor',
      'documentId',
      'occurredAt',
      'outcome',
      'version',
    ]);
  });
});
