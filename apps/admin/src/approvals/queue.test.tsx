import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { approvalsTranslator } from './locale';
import { BoundariesNote, DecidedSection, QueueSummary, WaitingSection } from './queue';
import {
  aClearQueue,
  aFullQueue,
  aPartialQueue,
  aRefusedQueue,
  aDelegatedDecision,
} from './approvals.fixture';

/**
 * The approvals queue, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a finding the slice investigation stated, so none of them can come
 * back quietly. The three that matter most are the three-state distinction, the server's total, and
 * the two identities on a delegated decision.
 */

const en = approvalsTranslator('en');
const ar = approvalsTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const queue = (
  t: typeof en,
  language: 'en' | 'ar',
  approvals: ReturnType<typeof aFullQueue>,
): string =>
  [
    html(<QueueSummary t={t} pending={approvals.pending} decided={approvals.decided} />),
    html(<WaitingSection t={t} language={language} pending={approvals.pending} />),
    html(<DecidedSection t={t} language={language} decided={approvals.decided} />),
    html(<BoundariesNote t={t} />),
  ].join('\n');

describe('the approvals queue', () => {
  /**
   * The assertion the whole screen turns on.
   *
   * "Nothing is waiting for you" and "you are not allowed to see what is waiting" are opposite
   * statements. The pipeline refuses a caller without the permission before the handler runs, and
   * answers a caller who resolved no membership with an empty page — so the screen must never
   * render one as the other.
   */
  it('keeps refused, clear and populated as three different answers', () => {
    const refused = queue(en, 'en', aRefusedQueue());
    const clear = queue(en, 'en', aClearQueue());
    const full = queue(en, 'en', aFullQueue());

    expect(refused).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(refused).not.toContain(escaped(en('admin.approvals.nothingWaiting')));

    expect(clear).toContain(escaped(en('admin.approvals.nothingWaiting')));
    expect(clear).toContain(escaped(en('admin.approvals.nothingDecided')));
    expect(clear).not.toContain(escaped(en('admin.notice.sectionWithheld')));

    expect(full).not.toContain(escaped(en('admin.approvals.nothingWaiting')));
    expect(refused).not.toBe(clear);
  });

  it('refuses one queue without refusing the other', () => {
    const markup = queue(en, 'en', aPartialQueue());

    expect(markup).toContain(escaped(en('admin.notice.sectionWithheld')));
    // The decided list still rendered its row.
    expect(markup).toContain('Budget confirmed.');
  });

  /**
   * A queue that counted its own rows would tell somebody with three hundred approvals that they
   * have two. The fixture's totals are deliberately larger than its pages.
   */
  it('shows the server’s total and never the page length', () => {
    const markup = queue(en, 'en', aFullQueue());

    expect(markup).toContain('317');
    expect(markup).toContain('42');
  });

  /**
   * The summary's overdue cell is a **count**, not the word "overdue".
   *
   * A label reading "Overdue" beside a value reading "Overdue" tells a reader nothing they did not
   * already have. The figure is a tally of a state the server already decided on the rows of this
   * page — never a comparison of two instants.
   */
  it('shows how many rows on this page the server called overdue', () => {
    const markup = html(
      <QueueSummary t={en} pending={aFullQueue().pending} decided={aFullQueue().decided} />,
    );

    // One of the two fixture rows is overdue; the other is within its target.
    expect(markup).toContain('>1<');
  });

  it('renders no count at all when the queue was refused', () => {
    const markup = html(<QueueSummary t={en} pending={undefined} decided={undefined} />);

    expect(markup).not.toContain('317');
    expect(markup).toContain('—');
  });

  /**
   * The actor and the authority are two fields and never one. Collapsing them would let the screen
   * say a director approved something their deputy approved.
   */
  it('keeps the actor and the authority apart on a delegated decision', () => {
    const markup = html(<DecidedSection t={en} language="en" decided={aFullQueue().decided} />);
    const delegated = aDelegatedDecision();

    expect(markup).toContain(delegated.decidedByMembershipId);
    expect(markup).toContain(delegated.onBehalfOfMembershipId ?? 'missing');
    expect(delegated.decidedByMembershipId).not.toBe(delegated.onBehalfOfMembershipId);
    expect(markup).toContain(en('workflow.vocabulary.authority.delegated'));
    expect(markup).toContain(en('workflow.vocabulary.authority.assigned'));
  });

  /** A membership is never shortened: eight characters of a UUIDv7 are the same for a whole afternoon. */
  it('shows every membership in full', () => {
    const markup = html(<DecidedSection t={en} language="en" decided={aFullQueue().decided} />);

    expect(markup).toContain('01900000-0000-7000-8000-00000000m001');
    expect(markup).not.toContain('01900000…');
  });

  it('shows the service-level state the server decided, and computes none of it', () => {
    const markup = html(<WaitingSection t={en} language="en" pending={aFullQueue().pending} />);

    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.overdue'));
    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.within'));
  });

  it('opens each row on the approval it is about', () => {
    const markup = html(<WaitingSection t={en} language="en" pending={aFullQueue().pending} />);

    expect(markup).toContain('href="/approvals/01900000-0000-7000-8000-00000000i001?lang=en"');
  });

  /**
   * A comment is free text somebody typed, of unknown direction.
   *
   * Left unisolated inside an Arabic table it is reordered — an English sentence renders with its
   * full stop at the front — so it is isolated exactly as an identifier or an instant is.
   */
  it('isolates the free text somebody typed', () => {
    const markup = html(<DecidedSection t={ar} language="ar" decided={aFullQueue().decided} />);

    expect(markup).toContain('<bdi>Budget confirmed.</bdi>');
  });

  it('renders in Arabic, with every Latin run isolated', () => {
    const markup = queue(ar, 'ar', aFullQueue());

    expect(markup).toContain(escaped(ar('admin.approvals.waitingForYou')));
    expect(markup).toContain(escaped(ar('admin.approvals.decidedByYou')));
    expect(markup).toContain(ar('workflow.vocabulary.decision.approved'));
    expect(markup).toContain('<bdi>REQUISITION-APPROVAL</bdi>');
    expect(markup).toContain('<bdi>recruitment.requisition</bdi>');
  });

  it('offers no control: deciding is the server’s and is named, not offered', () => {
    const markup = queue(en, 'en', aFullQueue()).toLowerCase();

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      '<textarea',
      '<dialog',
      'onclick',
      'onsubmit',
      'use client',
    ]) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
    expect(queue(en, 'en', aFullQueue())).toContain(escaped(en('admin.approvals.decidingIsApi')));
  });

  it('names what the screen does not do', () => {
    const markup = html(<BoundariesNote t={en} />);

    for (const key of [
      'admin.approvals.decidingIsApi',
      'admin.approvals.subjectIsOpaque',
      'admin.approvals.membershipsAreIdentifiers',
      'admin.approvals.onlyRecruitmentRaises',
      'admin.notice.readOnly',
    ]) {
      expect([key, markup.includes(escaped(en(key)))]).toEqual([key, true]);
    }
  });

  /** A subject is two opaque strings. Nothing here interprets what a requisition is. */
  it('shows the subject as its type and identifier, and describes neither', () => {
    const markup = html(<WaitingSection t={en} language="en" pending={aFullQueue().pending} />);

    expect(markup).toContain('recruitment.requisition');
    expect(markup).toContain('01900000…');
  });
});
