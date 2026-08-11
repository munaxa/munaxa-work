import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordTimeEvent, eventKeyFor } from './time-event.js';
import { rosterEntry } from './roster-entry.js';
import { decideCorrection, requestCorrection } from './correction.js';

/**
 * How a punch is captured and deduplicated, what a correction may do, and what a rota entry means.
 *
 * The deduplication assertions are the ones to read. They are the reason a turnstile retrying over
 * a flaky uplink, a mobile queue flushing twice and an import re-run all converge on one row rather
 * than three — and the reason two people punching at the same instant on different readers stay two
 * punches (ADR-0053).
 *
 * The correction suite proves the property somebody disputing a month's pay depends on: a
 * correction never rewrites a punch, and it cannot be approved by the person who asked for it.
 */

const TENANT = uuidV7();
const NOW = new Date('2026-08-10T09:00:00Z');
const RIYADH = 'Asia/Riyadh';

const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value as TValue;
};

describe('Ingestion never trusts a client clock, and deduplicates deterministically', () => {
  const base = {
    tenantId: TENANT,
    employmentId: uuidV7(),
    kind: 'clock_in' as const,
    source: 'mobile' as const,
    zone: RIYADH,
    attendanceDate: '2026-05-04',
    clockSkewToleranceSeconds: 300,
  };

  it('keeps the reported instant inside tolerance and the received one beyond it', () => {
    const reportedAt = new Date('2026-05-04T05:00:00Z');
    const withinReceived = new Date('2026-05-04T05:01:00Z');
    const beyondReceived = new Date('2026-05-04T09:00:00Z');
    const within = unwrap(recordTimeEvent({ ...base, reportedAt, receivedAt: withinReceived }));
    const beyond = unwrap(recordTimeEvent({ ...base, reportedAt, receivedAt: beyondReceived }));

    expect(within.occurredAt).toEqual(reportedAt);
    expect(beyond.occurredAt).toEqual(beyondReceived);
    // Both survive either way. Divergence is data, not an error to discard.
    expect(beyond.reportedAt).toEqual(reportedAt);
    expect(beyond.clockSkewSeconds).toBe(-14_400);
  });

  it('prefers a client key, then a source reference, then a digest', () => {
    const at = new Date('2026-05-04T05:00:00Z');
    const keyed = eventKeyFor(
      { ...base, reportedAt: at, receivedAt: at, idempotencyKey: 'abc' },
      at,
    );
    const referenced = eventKeyFor(
      { ...base, reportedAt: at, receivedAt: at, sourceReference: 'dev-9' },
      at,
    );
    const digested = eventKeyFor({ ...base, reportedAt: at, receivedAt: at }, at);

    expect(keyed).toBe('k:abc');
    expect(referenced).toBe('s:mobile:dev-9');
    expect(digested.startsWith('d:')).toBe(true);
    expect(digested).toBe(eventKeyFor({ ...base, reportedAt: at, receivedAt: at }, at));
  });

  /** Two readers producing the same instant are two events, and a human decides which is real. */
  it('gives two devices at one instant two different keys', () => {
    const at = new Date('2026-05-04T05:00:00Z');
    const left = eventKeyFor({ ...base, reportedAt: at, receivedAt: at, deviceReference: 'a' }, at);
    const right = eventKeyFor(
      { ...base, reportedAt: at, receivedAt: at, deviceReference: 'b' },
      at,
    );

    expect(left).not.toBe(right);
  });

  it('refuses half a coordinate and an impossible one', () => {
    const at = new Date('2026-05-04T05:00:00Z');
    const impossible = recordTimeEvent({
      ...base,
      reportedAt: at,
      receivedAt: at,
      location: { latitude: 120, longitude: 0 },
    });

    expect(impossible.ok).toBe(false);
    expect(!impossible.ok && impossible.error.reason).toBe('location_malformed');
  });
});

describe('A correction preserves history and cannot be approved by its author', () => {
  const request = {
    tenantId: TENANT,
    employmentId: uuidV7(),
    attendanceDate: '2026-05-04',
    kind: 'add_event' as const,
    proposedKind: 'clock_out' as const,
    proposedOccurredAt: new Date('2026-05-04T14:00:00Z'),
    reasonCode: 'forgot-to-punch',
    justification: 'Left through the loading bay.',
    requestedBy: 'user:supervisor',
  };

  it('requires a reason and a justification', () => {
    const refused = requestCorrection({ ...request, justification: '  ' }, NOW);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.reason).toBe('justification_required');
  });

  it('requires a target for an amendment and refuses one for an addition', () => {
    expect(requestCorrection({ ...request, kind: 'amend_event' }, NOW).ok).toBe(false);
    expect(requestCorrection({ ...request, targetEventId: uuidV7() }, NOW).ok).toBe(false);
  });

  it('refuses self-approval even when the caller holds both permissions', () => {
    const correction = unwrap(requestCorrection(request, NOW));
    const bySelf = decideCorrection(
      correction,
      { approve: true, decidedBy: 'user:supervisor' },
      NOW,
    );
    const byAnother = decideCorrection(
      correction,
      { approve: true, decidedBy: 'user:manager' },
      NOW,
    );

    expect(bySelf.ok).toBe(false);
    expect(!bySelf.ok && bySelf.error.reason).toBe('correction_self_approval');
    expect(byAnother.ok).toBe(true);
  });

  it('refuses a second decision on a decided request', () => {
    const decided = unwrap(
      decideCorrection(
        unwrap(requestCorrection(request, NOW)),
        { approve: false, decidedBy: 'user:manager' },
        NOW,
      ),
    );

    expect(decideCorrection(decided, { approve: true, decidedBy: 'user:other' }, NOW).ok).toBe(
      false,
    );
  });
});

describe('A roster entry says exactly what it means', () => {
  it('requires a shift for a shift entry and forbids one otherwise', () => {
    const base = { tenantId: TENANT, employmentId: uuidV7(), onDate: '2026-05-04' };

    expect(rosterEntry({ ...base, kind: 'shift' }, NOW).ok).toBe(false);
    expect(rosterEntry({ ...base, kind: 'shift', shiftId: uuidV7() }, NOW).ok).toBe(true);
    expect(rosterEntry({ ...base, kind: 'rest', shiftId: uuidV7() }, NOW).ok).toBe(false);
    expect(rosterEntry({ ...base, kind: 'holiday' }, NOW).ok).toBe(true);
  });
});
