import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { approvalsTranslator } from './locale';
import {
  ApprovalSummary,
  BranchesSection,
  ChainSection,
  DecisionsSection,
  DetailBoundaries,
} from './detail';
import { PortStatusSection, TimelineSection } from './timeline';
import { aHistoryEntry, anApprovalStatus, anInstanceDetail } from './approvals.fixture';

/**
 * One approval, opened.
 *
 * The assertions here are about the two properties the domain is strictest on: **every figure is
 * the server's**, and **the actor and the authority are never collapsed**. A screen that added two
 * tally fields together, or worked out a majority, or inferred delegation by comparing identifiers,
 * would be a second answer to a question the module answers deliberately and carefully.
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

const whole = (t: typeof en, language: 'en' | 'ar'): string => {
  const detail = anInstanceDetail();

  return [
    html(<ApprovalSummary t={t} language={language} detail={detail} />),
    html(<ChainSection t={t} language={language} steps={detail.steps} />),
    html(<BranchesSection t={t} tallies={detail.tallies} />),
    html(<DecisionsSection t={t} language={language} decisions={detail.decisions} />),
    html(
      <TimelineSection
        t={t}
        language={language}
        history={{ items: [aHistoryEntry()], total: 9 }}
      />,
    ),
    html(<PortStatusSection t={t} language={language} status={anApprovalStatus()} />),
    html(<DetailBoundaries t={t} />),
  ].join('\n');
};

describe('one approval', () => {
  it('shows the chain, the decisions, the branch and the timeline', () => {
    const markup = whole(en, 'en');

    expect(markup).toContain(en('workflow.vocabulary.stepStatus.awaiting'));
    expect(markup).toContain(en('workflow.vocabulary.decision.approved'));
    expect(markup).toContain(en('workflow.vocabulary.decision.rejected'));
    expect(markup).toContain(en('workflow.vocabulary.branchRule.majority'));
    expect(markup).toContain(en('workflow.vocabulary.historyEvent.step-awaiting'));
    expect(markup).toContain('Budget confirmed.');
  });

  /**
   * Nine published figures and no tenth derived from them. `outstanding` is not `assigned` minus
   * `responses`, and `quorumMet` is not a comparison — both are counted by the server from the
   * decisions at read time, and the denominator in particular is a locked domain rule.
   */
  it('renders every branch figure exactly as the server counted it', () => {
    const markup = html(<BranchesSection t={en} tallies={anInstanceDetail().tallies} />);

    for (const figure of ['3', '1', '0', '2']) expect(markup).toContain(figure);
    expect(markup).toContain(en('workflow.vocabulary.quorumMet.met'));
    expect(markup).toContain(en('workflow.vocabulary.branchOutcome.awaiting'));
  });

  /**
   * `dueOn` is a field, not `awaitingOn` plus the target, and the state is the application's word
   * rather than "is `dueOn` in the past". `overdueByMinutes` is whole minutes, never divided.
   */
  it('renders the service level as three published fields', () => {
    const markup = html(<ChainSection t={en} language="en" steps={anInstanceDetail().steps} />);

    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.overdue'));
    expect(markup).toContain('2880');
    expect(markup).toContain('22/08/2026');
  });

  it('keeps the actor and the authority apart, and names no manager', () => {
    const markup = html(
      <DecisionsSection t={en} language="en" decisions={anInstanceDetail().decisions} />,
    );

    expect(markup).toContain('01900000-0000-7000-8000-00000000m002');
    expect(markup).toContain('01900000-0000-7000-8000-00000000m001');
    expect(markup).toContain(en('workflow.vocabulary.authority.delegated'));
    expect(markup.toLowerCase()).not.toContain('manager approved');
  });

  /**
   * A step's `approverKind` may be `manager` — that is how the *template* routed it — and the
   * running step still names a concrete membership. The screen renders the kind as the module's own
   * word and resolves nobody.
   */
  it('renders the approver kind as a word and the approver as an identifier', () => {
    const markup = html(<ChainSection t={en} language="en" steps={anInstanceDetail().steps} />);

    expect(markup).toContain(en('workflow.vocabulary.approverKind.manager'));
    expect(markup).toContain('01900000-0000-7000-8000-00000000m001');
  });

  it('distinguishes a refused timeline from an empty one', () => {
    const refused = html(<TimelineSection t={en} language="en" history={undefined} />);
    const empty = html(<TimelineSection t={en} language="en" history={{ items: [], total: 0 }} />);

    expect(refused).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(empty).toContain(escaped(en('workflow.notice.empty')));
    expect(empty).not.toContain(escaped(en('admin.notice.sectionWithheld')));
  });

  it('says nobody has answered yet rather than rendering an empty decision table', () => {
    const markup = html(<DecisionsSection t={en} language="en" decisions={[]} />);

    expect(markup).toContain(escaped(en('admin.approvals.nothingDecidedYet')));
  });

  /**
   * These are *this approval's* decisions, by whoever made them — not the reader's own list.
   *
   * The queue's heading is "Decided by you", and reusing it here would tell somebody that every
   * decision on the screen was theirs, including the ones a colleague made.
   */
  it('does not call this approval’s decisions the reader’s own', () => {
    const markup = html(
      <DecisionsSection t={en} language="en" decisions={anInstanceDetail().decisions} />,
    );

    expect(markup).toContain(escaped(en('admin.approvals.decisions')));
    expect(markup).not.toContain(escaped(en('admin.approvals.decidedByYou')));
  });

  /** The header already carries the subject in full; the summary carries what it cannot. */
  it('does not repeat the subject the page header already states', () => {
    const detail = anInstanceDetail();
    const markup = html(<ApprovalSummary t={en} language="en" detail={detail} />);

    expect(markup).not.toContain(en('workflow.label.subjectType'));
    expect(markup).toContain(en('workflow.label.requestedBy'));
    expect(markup).toContain(en('workflow.label.workflowVersionId'));
  });

  it('shows the timeline’s server total', () => {
    const markup = html(
      <TimelineSection t={en} language="en" history={{ items: [aHistoryEntry()], total: 9 }} />,
    );

    expect(markup).toContain('9');
  });

  /** `expired` is declared in the port's vocabulary and this product never produces it. */
  it('offers no legend of the approval states', () => {
    const markup = whole(en, 'en');

    expect(markup).not.toContain(en('workflow.vocabulary.approvalState.expired'));
  });

  it('renders in Arabic, with every Latin run isolated', () => {
    const markup = whole(ar, 'ar');

    expect(markup).toContain(ar('workflow.vocabulary.stepStatus.awaiting'));
    expect(markup).toContain(ar('workflow.vocabulary.authority.delegated'));
    // A shortened workflow identifier in the summary, and a membership in full in the chain: both
    // are Latin runs sitting inside right-to-left text, and both keep their own direction.
    expect(markup).toContain('<bdi>01900000…</bdi>');
    expect(markup).toContain('<bdi>01900000-0000-7000-8000-00000000m001</bdi>');
  });

  it('offers no control anywhere', () => {
    const markup = whole(en, 'en').toLowerCase();

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
  });

  it('names what the screen does not do', () => {
    const markup = html(<DetailBoundaries t={en} />);

    for (const key of [
      'admin.approvals.decidingIsApi',
      'admin.approvals.subjectIsOpaque',
      'admin.approvals.membershipsAreIdentifiers',
      'admin.approvals.nothingExpires',
    ]) {
      expect([key, markup.includes(escaped(en(key)))]).toEqual([key, true]);
    }
  });
});
