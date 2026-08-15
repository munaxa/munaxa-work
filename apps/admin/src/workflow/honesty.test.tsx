import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APPROVAL_STATES } from '@work/workflow/contracts';

import { translator } from './locale';
import { count, instant, member, short } from './exact';
import { DefinitionsSection, StepsSection, VersionsSection } from './definitions';
import { InstanceStepsSection, InstancesSection } from './instances';
import { ApprovalStatusSection, DecidedSection, PendingSection } from './approvals';
import { HistorySection } from './history';
import { StatusSection } from './status';
import {
  APPROVER,
  DEPUTY,
  INSTANCE_ID,
  aDefinitionDetail,
  aDelegatedDecision,
  aDirectDecision,
  aHistory,
  aPendingApproval,
  anApprovalStatus,
  anInstance,
  anInstanceDetail,
} from './views.fixture';

/**
 * What the screen refuses to claim, and the two kinds of value it must not alter.
 *
 * The render suite proves the workspaces appear. This half proves the harder property: that nothing
 * on the page overstates what this product does. An instant keeps the moment the API sent, a whole
 * number keeps the integer the server decided, an actor is never confused with an authority, and
 * every capability that does not exist is named rather than left for somebody to infer from an
 * empty table.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

/**
 * The text of every heading, column header and figure label in the markup.
 *
 * The distinction this exists for. A screen that *states* it calculates no service level has to use
 * the words "service level" to say so, and one that says nothing escalates has to name escalation. A
 * blanket "this word never appears" assertion therefore fails on the very sentence that makes the
 * refusal honest — it would force the page to stop explaining itself, which is the opposite of what
 * these tests are for.
 *
 * A *claim*, by contrast, lives in a structural position: a section heading, a `<th scope="col">`, a
 * `<dt>` label. Those are the places a reader takes a word as a description of the data beneath it,
 * and those are what this searches.
 */
const labels = (markup: string): string =>
  [...markup.matchAll(/<(?:h1|h2|th|dt)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|th|dt)>/g)]
    .map((match) => match[1] ?? '')
    .join(' | ')
    .toLowerCase();

const populated = (language: 'en' | 'ar'): string => {
  const all = { t: translator(language), language } as const;

  return [
    html(
      <DefinitionsSection {...all} definitions={[aDefinitionDetail().definition]} total={4000} />,
    ),
    html(<VersionsSection {...all} detail={aDefinitionDetail()} />),
    html(<StepsSection {...all} detail={aDefinitionDetail()} />),
    html(<InstancesSection {...all} instances={[anInstance()]} total={4000} />),
    html(<InstanceStepsSection {...all} detail={anInstanceDetail()} />),
    html(<ApprovalStatusSection {...all} approval={anApprovalStatus()} />),
    html(<HistorySection {...all} history={aHistory()} total={9} />),
    html(<PendingSection {...all} pending={[aPendingApproval()]} total={12} />),
    html(<DecidedSection {...all} decided={[aDirectDecision(), aDelegatedDecision()]} total={7} />),
  ].join('\n');
};

describe('instants, on the page', () => {
  /**
   * The mandatory regression: the moment must survive all the way to the markup.
   *
   * `2026-02-28T23:30:00.000Z` is the case that breaks. Rendered in the server's own zone rather
   * than pinned to UTC it reads as the 28th at 15:30 in Los Angeles and as the **1st of March** in
   * Riyadh — an approval raised on a day it was not, and a decision attributed to the wrong month.
   */
  it('renders 2026-02-28T23:30Z as the 28th at 23:30, in both languages', () => {
    for (const language of ['en', 'ar'] as const) {
      const markup = populated(language);

      expect([language, markup.includes('28')]).toEqual([language, true]);
      expect([language, markup.includes('23:30') || markup.includes('11:30')]).toEqual([
        language,
        true,
      ]);
      // The day a missing UTC pin produces east of UTC, and the one it produces to the west.
      expect([language, markup.includes('01/03/2026')]).toEqual([language, false]);
      expect([language, markup.includes('15:30')]).toEqual([language, false]);
    }
  });

  it('is pinned to UTC, and would be caught if somebody dropped the pin', () => {
    const value = '2026-02-28T23:30:00.000Z';

    expect(instant(value, 'en')).toBe('28/02/2026, 23:30:00');
    expect(instant(undefined, 'en')).toBe('—');
    // The same moment without the pin, in a zone east of UTC, is a different day. The function
    // exists so that difference cannot appear on a screen.
    expect(new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })).toContain(
      '01/03/2026',
    );
  });

  /** No clock is consulted anywhere: every moment on the page is one the API sent. */
  it('renders no moment the fixtures did not contain', () => {
    const markup = populated('en');
    const today = new Date().toLocaleDateString('en-GB', { timeZone: 'UTC' });

    // The fixture's day is deliberately not today's, so a screen that stamped its own clock — an
    // age, an elapsed time, a "last refreshed" — would fail this rather than pass by coincidence.
    expect(markup).not.toContain(today);
  });
});

describe('exact whole numbers, on the page', () => {
  it('renders positions, versions and totals as integers in both languages', () => {
    for (const [language, markup] of [
      ['en', populated('en')],
      ['ar', populated('ar')],
    ] as const) {
      // A step's position, a version number and a row version, each as the exact cell rather than a
      // substring: `>2<` cannot match inside `>21<`.
      expect([language, markup.includes('>2<')]).toEqual([language, true]);
      expect([language, markup.includes('>3<')]).toEqual([language, true]);
      // No decimal point, no thousands separator, and no Arabic-Indic digit anywhere a number is
      // rendered. `toLocaleString` would produce all three.
      expect([language, markup.includes('4000')]).toEqual([language, true]);
      expect([language, markup.includes('4,000')]).toEqual([language, false]);
      expect([language, /[٠-٩]/.test(markup)]).toEqual([language, false]);
    }
  });

  it('is an identity function, and would be caught if somebody localized it', () => {
    expect(count(4000)).toBe('4000');
    expect(count(1)).toBe('1');
    expect(count(undefined)).toBe('—');
    expect((4000).toLocaleString('en-GB')).not.toBe(count(4000));
  });

  it('shortens a row identifier without converting it', () => {
    expect(short(INSTANCE_ID)).toBe('01930000…');
    expect(short(undefined)).toBe('—');
    // A UUID is not a quantity. `Number` on one is `NaN`, which is what this prevents reaching a cell.
    expect(Number.isNaN(Number(INSTANCE_ID))).toBe(true);
  });

  /**
   * A membership is never shortened, and this is the arithmetic that says why.
   *
   * These identifiers are UUIDv7: the leading forty-eight bits are a millisecond timestamp, so two
   * memberships created within a few hours of each other share their first eight characters. On the
   * one screen where two memberships must be told apart — the actor and the authority — a truncation
   * would render them as the same person.
   */
  it('renders a membership in full, because eight characters cannot tell two apart', () => {
    expect(member(APPROVER)).toBe(APPROVER);
    expect(member(undefined)).toBe('—');
    expect(APPROVER).not.toBe(DEPUTY);
    // The collision the full identifier avoids.
    expect(short(APPROVER)).toBe(short(DEPUTY));
  });
});

describe('an actor and an authority are two people', () => {
  /** A direct decision: the actor is shown, and the authority column is absent rather than filled. */
  it('shows no acting-for on a decision somebody made on their own step', () => {
    const markup = html(<DecidedSection {...props} decided={[aDirectDecision()]} total={1} />);

    expect(markup).toContain(`>${APPROVER}<`);
    expect(markup).toContain(en('workflow.vocabulary.authority.assigned'));
    // The deputy is nowhere on a decision they did not make, and the approver is not printed twice
    // to fill an empty column: the acting-for cell is absent rather than a repeat of the actor.
    expect(markup).not.toContain(`>${DEPUTY}<`);
    expect(markup).toContain('>—<');
  });

  /** A delegated decision: both memberships, with their own labels, and never collapsed. */
  it('shows the delegate as the actor and the approver as the authority', () => {
    const markup = html(<DecidedSection {...props} decided={[aDelegatedDecision()]} total={1} />);

    // Two different identifiers, both in full, in two labelled columns.
    expect(markup).toContain(`>${DEPUTY}<`);
    expect(markup).toContain(`>${APPROVER}<`);
    expect(markup).toContain(en('workflow.vocabulary.authority.delegated'));
    expect(labels(markup)).toContain(en('workflow.label.decidedBy').toLowerCase());
    expect(labels(markup)).toContain(en('workflow.label.onBehalfOf').toLowerCase());
  });

  /** The rejection comment stays on the decision, and never appears in the timeline. */
  it('keeps a rejection comment on the decision and out of the history', () => {
    const decided = html(<DecidedSection {...props} decided={[aDelegatedDecision()]} total={1} />);
    const history = html(<HistorySection {...props} history={aHistory()} total={9} />);

    expect(decided).toContain('Not budgeted this quarter');
    expect(history).not.toContain('Not budgeted this quarter');
    expect(labels(history)).not.toContain(en('workflow.label.comment').toLowerCase());
  });

  /** The timeline names both memberships too, without inventing a field. */
  it('renders the timeline in order, with only the fields the view carries', () => {
    const markup = html(<HistorySection {...props} history={aHistory()} total={9} />);
    const started = markup.indexOf(en('workflow.vocabulary.historyEvent.instance-started'));
    const approved = markup.indexOf(en('workflow.vocabulary.historyEvent.step-approved'));

    expect(started).toBeGreaterThan(-1);
    expect(approved).toBeGreaterThan(started);

    // Exactly the five columns the view has, and nothing invented beside them.
    for (const invented of ['comment', 'reason', 'duration', 'elapsed', 'due', 'sla']) {
      expect([invented, labels(markup).includes(invented)]).toEqual([invented, false]);
    }
  });
});

describe('a configured approver is not the reader', () => {
  it('labels the step’s membership as the approver asked, never as the viewer', () => {
    const markup = html(<StepsSection {...props} detail={aDefinitionDetail()} />);

    expect(labels(markup)).toContain(en('workflow.label.approver').toLowerCase());
    expect(markup).toContain(escaped(en('workflow.notice.approverIsConfigured')));
    for (const claim of ['you', 'your', 'my ', 'manager', 'team']) {
      expect([claim, labels(markup).includes(claim)]).toEqual([claim, false]);
    }
  });
});

describe('the state vocabulary, and the one state nothing reaches', () => {
  /**
   * `expired` is declared by the port and never produced by this phase.
   *
   * The screen renders whichever state the server returned and offers no legend, so the word cannot
   * appear from a page of real data. What it does do is *say* that nothing expires — which is why
   * the assertion is scoped to the tables and headings rather than to the whole page.
   */
  it('never renders expired as a state, and says plainly that nothing expires', () => {
    const markup = populated('en');

    expect(APPROVAL_STATES).toContain('expired');
    expect(markup).not.toContain(en('workflow.vocabulary.approvalState.expired'));
    // And the absence is stated rather than left to be noticed.
    expect(html(<StatusSection {...props} />)).toContain(
      escaped(en('workflow.withheld.approvalExpiry')),
    );
  });

  it('renders the state the server sent, in the port’s own words', () => {
    const markup = html(<ApprovalStatusSection {...props} approval={anApprovalStatus()} />);

    expect(markup).toContain(en('workflow.vocabulary.approvalState.pending'));
  });
});

describe('what this product does not do', () => {
  it('states every deferred capability, in both languages', () => {
    for (const [language, translate] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const markup = html(<StatusSection t={translate} language={language} />);

      for (const key of [
        'workflow.withheld.sla',
        'workflow.withheld.businessDays',
        'workflow.withheld.escalation',
        'workflow.withheld.scheduling',
        'workflow.withheld.approvalExpiry',
        'workflow.withheld.delegationExpiry',
        'workflow.withheld.parallelApproval',
        'workflow.withheld.tally',
        'workflow.withheld.conditionalBranching',
        'workflow.withheld.roles',
        'workflow.withheld.groups',
        'workflow.withheld.managerRouting',
        'workflow.withheld.externalApprovers',
        'workflow.withheld.notificationDelivery',
        'workflow.withheld.analytics',
        'workflow.withheld.asynchronousCallbacks',
        'workflow.withheld.outbox',
        'workflow.notice.actionsAreApi',
        'workflow.notice.identifiersNotNames',
        'workflow.notice.queueIsAmbient',
      ]) {
        expect([language, key, markup.includes(escaped(translate(key)))]).toEqual([
          language,
          key,
          true,
        ]);
      }
    }
  });

  /**
   * A notice is a sentence, never a control.
   *
   * The point of naming an absence is to stop somebody building on it. A notice that rendered as a
   * button, a link or a form would do the opposite — it would look like the capability is a click
   * away.
   */
  it('renders the notices as text, with nothing actionable among them', () => {
    const markup = html(<StatusSection {...props} />).toLowerCase();

    for (const control of ['<form', '<button', '<input', '<select', '<a ', 'href=', 'onclick']) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });
});

describe('the claims no heading or column makes', () => {
  /**
   * The negative space, scoped to where a claim would live.
   *
   * Every word below would, as a heading or a column header, describe data this product does not
   * have. The refusal sentences use several of them, which is why this searches headings, `<th>` and
   * `<dt>` rather than the whole page.
   */
  it('has no heading, column or figure naming a capability this phase deferred', () => {
    const structural = labels(populated('en'));

    for (const claim of [
      'sla',
      'service level',
      'escalat',
      'due',
      'overdue',
      'elapsed',
      'age',
      'business day',
      'parallel',
      'majority',
      'unanimous',
      'quorum',
      'first response',
      'tally',
      'role',
      'group',
      'manager',
      'team',
      'analytic',
      'rate',
      'average',
      'bottleneck',
      'compliance',
      'notification',
      'reminder',
      'schedule',
      'upload',
      'download',
      'webhook',
    ]) {
      expect([claim, structural.includes(claim)]).toEqual([claim, false]);
    }
  });

  /** And no Recruitment vocabulary anywhere: the subject type is printed, nothing more. */
  it('names no Recruitment concept beyond the subject type Workflow published', () => {
    const structural = labels(populated('en'));
    const markup = populated('en');

    expect(markup).toContain('recruitment.requisition');
    for (const concept of ['requisition', 'vacancy', 'candidate', 'application', 'offer', 'hire']) {
      expect([concept, structural.includes(concept)]).toEqual([concept, false]);
    }
  });
});
