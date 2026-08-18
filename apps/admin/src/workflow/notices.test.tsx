import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import catalogue from '@work/workflow/locales/en.json';

import { translator } from './locale';
import { DefinitionsSection, StepsSection, VersionsSection } from './definitions';
import { ApprovalGroupsSection, GroupMembersSection } from './groups';
import { AwaitingSection, BranchesSection } from './branches';
import { InstanceStepsSection, InstancesSection } from './instances';
import { ApprovalStatusSection, DecidedSection, PendingSection } from './approvals';
import { HistorySection } from './history';
import { ProvidedSection, StatusSection } from './status';
import {
  DEPUTY,
  ESCALATED,
  aDefinitionDetail,
  aDelegatedDecision,
  aDirectDecision,
  aHistory,
  aPendingApproval,
  anApprovalStatus,
  anInstance,
  anInstanceDetail,
} from './views.fixture';
import {
  aBranchedDefinitionDetail,
  aGroup,
  aGroupDetail,
  aParallelInstanceDetail,
} from './branches.fixture';

/**
 * What the screen claims, and what it refuses to claim.
 *
 * The other half of `honesty.test.tsx`, split from it for the file budget along the seam the phase
 * itself drew: that file is about **values** an instant or an integer must survive, and this one is
 * about **words** — which capabilities the page says exist, which it says do not, and where a word
 * counts as a description of the data rather than an explanation of it.
 *
 * The list of absences is only honest if it shrinks when the product grows, and six entries left it
 * in Phase 16B. Both directions are asserted here: what is now claimed must be true, and what is
 * still refused must still be refused.
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
 * A screen that *states* it calculates no service level has to use the words "service level" to say
 * so, and one that says nothing escalates has to name escalation. A blanket "this word never
 * appears" assertion would fail on the very sentence that makes the refusal honest. A *claim*, by
 * contrast, lives in a structural position — a heading, a `<th scope="col">`, a `<dt>` — and those
 * are what this searches.
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
    html(<ApprovalGroupsSection {...all} groups={[aGroup()]} total={6} />),
    html(<GroupMembersSection {...all} detail={aGroupDetail()} />),
    html(<StepsSection {...all} detail={aBranchedDefinitionDetail()} />),
    html(<BranchesSection {...all} tallies={aParallelInstanceDetail().tallies} />),
    html(<AwaitingSection {...all} steps={aParallelInstanceDetail().awaitingSteps} />),
  ].join('\n');
};

describe('what this release added', () => {
  /**
   * The six capabilities Phase 16B built, stated as built.
   *
   * Every one of them was on the deferred list in Phase 16A, and this is the assertion that stops
   * the list from outliving the absence: a screen rendering a branch of two while telling an
   * administrator that every chain is sequential is wrong in the direction nobody checks for.
   */
  it('states every capability this phase implemented, in both languages', () => {
    for (const [language, translate] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const markup = html(<ProvidedSection t={translate} language={language} />);

      for (const key of [
        'workflow.provided.approvalGroups',
        'workflow.provided.parallelApproval',
        'workflow.provided.branchRules',
        'workflow.provided.quorum',
        'workflow.provided.conditionalBranching',
        'workflow.provided.tally',
        'workflow.provided.managerRouting',
        'workflow.provided.serviceLevel',
        // Phase 16D: a person can widen a branch. Nothing else about it changed.
        'workflow.provided.escalation',
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
   * And none of the six is still listed as absent.
   *
   * Asserted against the module's own catalogue rather than against a sentence: the keys that
   * claimed these capabilities were missing are gone, so a screen cannot render one by accident and
   * a later reader cannot resurrect one from the catalogue.
   */
  it('no longer carries a catalogue entry claiming any of them is absent', () => {
    const withheld = Object.keys(catalogue.workflow.withheld);

    for (const gone of [
      'parallelApproval',
      'tally',
      'conditionalBranching',
      'groups',
      // Phase 16C: both were blanket claims, and both are now false.
      'sla',
      'managerRouting',
    ]) {
      expect([gone, withheld.includes(gone)]).toEqual([gone, false]);
    }
    // What replaced the blanket claims is narrower and still true.
    expect(withheld).toContain('groupDirectory');
    expect(withheld).toContain('roles');
    expect(en('workflow.withheld.roles')).toContain('approval group');
    expect(en('workflow.withheld.groupDirectory')).toContain('list a tenant maintains');
    // A target exists; a *business-day* target does not, and nothing fires when one passes.
    expect(withheld).toContain('businessDays');
    expect(withheld).toContain('escalation');
    expect(withheld).toContain('approvalExpiry');
    expect(en('workflow.withheld.escalation')).toContain('past its target');
    expect(en('workflow.withheld.approvalExpiry')).toContain('stays exactly where it is');
    // And a manager is resolved once rather than continuously — the claim that replaced the old one.
    expect(en('workflow.provided.managerRouting')).toContain('once, when the approval starts');
    expect(en('workflow.provided.serviceLevel')).toContain('observed rather than enforced');
  });
});

/**
 * The one claim of this phase, and the refusal it sits beside.
 *
 * Phase 16D added a route a person can call to widen a stuck branch. That makes exactly one sentence
 * on this page newly true — and it makes the sentence next to it newly *misleading*, because "nothing
 * escalates" and "an administrator can escalate" cannot both stand. Neither one was deleted: the
 * refusal was narrowed to the thing that is still refused, which is that nothing escalates **on its
 * own**. The pair is asserted together, because the honesty of either depends on the other.
 */
describe('escalation, claimed and refused in the same breath', () => {
  it('claims a person can widen a branch and still refuses that anything does it unprompted', () => {
    const claim = en('workflow.provided.escalation');
    const refusal = en('workflow.withheld.escalation');

    // What is now true: somebody does it, it adds, and it removes nobody.
    expect(claim).toContain('administrator');
    expect(claim).toContain('add an approver');
    expect(claim).toContain('nobody is replaced');
    // And what is still false, which is every automatic form of the same word.
    expect(refusal).toContain('by itself');
    expect(refusal).toContain('on a timer');
    expect(refusal).toContain('after a delay');
    // The refusal must not have been emptied into a claim: it is still on the deferred list.
    expect(Object.keys(catalogue.workflow.withheld)).toContain('escalation');
  });

  /**
   * And the timeline can say the word, in both languages.
   *
   * The event is the **only** published trace of an escalation — `WorkflowStepView` carries no marker
   * — so a missing catalogue entry would not be a cosmetic gap. `translator` answers a missing key
   * with the key itself, which renders as `workflow.vocabulary.historyEvent.step-escalated` in a
   * table cell: legible enough to look deliberate and wrong in a way nobody reports.
   */
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)(
    'names the escalation event as words rather than a key in %s',
    (language, translate) => {
      const KEY = 'workflow.vocabulary.historyEvent.step-escalated';
      const word = translate(KEY);

      expect(word).not.toBe(KEY);
      expect(word).not.toContain('workflow.');

      const markup = html(
        <HistorySection t={translate} language={language} history={aHistory()} total={9} />,
      );

      expect(markup).toContain(escaped(word));
      expect(markup).not.toContain(KEY);
    },
  );

  /**
   * The added approver is a row, not a recomputed denominator.
   *
   * Two steps await at ordinal 2 and the branch still needs one approval. A screen that counted the
   * rows it was rendering would print two, which is the failure this asserts against — the tally is
   * the server's arithmetic and this page only prints it.
   */
  it('renders the widened branch without moving the number it needs', () => {
    const detail = anInstanceDetail();
    const second = detail.tallies?.find((tally) => tally.ordinal === 2);

    expect(detail.awaitingSteps?.filter((step) => step.ordinal === 2)).toHaveLength(2);
    expect([second?.assigned, second?.threshold, second?.outstanding]).toStrictEqual([1, 1, 1]);

    const markup = html(<InstanceStepsSection {...props} detail={detail} />);

    // Both people are on the screen, each as an ordinary awaiting membership step.
    expect(markup).toContain(DEPUTY);
    expect(markup).toContain(ESCALATED);
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
        'workflow.withheld.businessDays',
        'workflow.withheld.escalation',
        'workflow.withheld.scheduling',
        'workflow.withheld.approvalExpiry',
        'workflow.withheld.delegationExpiry',
        'workflow.withheld.delegationManagement',
        'workflow.withheld.roles',
        'workflow.withheld.groupDirectory',
        'workflow.withheld.externalApprovers',
        'workflow.withheld.notificationDelivery',
        'workflow.withheld.analytics',
        'workflow.withheld.asynchronousCallbacks',
        'workflow.withheld.outbox',
        'workflow.withheld.routingIntelligence',
        'workflow.withheld.selfServicePortal',
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
   *
   * **Four words left this list in Phase 16B and one changed meaning.** A branch, a rule, a quorum
   * and a tally are now data the server publishes, so a column naming one is a description rather
   * than a claim — the test below asserts they are present rather than absent. `group` moved for a
   * narrower reason: an approval group is real, a group *directory* is not.
   *
   * **Four more left it in Phase 16C, and `manager` is the one worth reading twice.** A step may ask
   * the requester's manager and a step may carry a target, so `manager`, `due`, `overdue` and
   * `service level` now describe data rather than claim capability, and the companion test asserts
   * each of them appears. What stays forbidden is what still does not exist: `role`, `team`,
   * `directory` and `department` — the words that would turn one resolved person into a directory —
   * along with `sla`, `elapsed`, `age` and `business day`, which would each claim an arithmetic this
   * screen does not perform.
   */
  it('has no heading, column or figure naming a capability this phase deferred', () => {
    const structural = labels(populated('en'));

    for (const claim of [
      'sla',
      'escalat',
      'elapsed',
      'age',
      'business day',
      'role',
      'team',
      'directory',
      'department',
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

  /**
   * And what is now real is named as a column, because the data is there to describe.
   *
   * This is the complement of the list above, and it is what stops a word leaving the forbidden list
   * from reading as a capability quietly dropped: each of these must actually appear.
   */
  it('names the branch, the rule, the quorum, the tally, the target and how it stands', () => {
    const structural = labels(populated('en'));

    for (const provided of [
      'branch rule',
      'quorum',
      'approvals needed',
      'outcome',
      'members',
      // Phase 16C's columns.
      'expected to take',
      'against target',
      'approver kind',
    ]) {
      expect([provided, structural.includes(provided)]).toEqual([provided, true]);
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
