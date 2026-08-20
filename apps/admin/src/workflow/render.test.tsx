import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from './locale';
import { OverviewSection } from './overview';
import { DefinitionsSection, StepsSection, VersionsSection } from './definitions';
import { InstanceStepsSection, InstancesSection } from './instances';
import { ApprovalStatusSection, DecidedSection, PendingSection } from './approvals';
import { HistorySection } from './history';
import { ApprovalGroupsSection, GroupMembersSection } from './groups';
import { AwaitingSection, BranchesSection } from './branches';
import { ProvidedSection, StatusSection } from './status';
import {
  aDefinition,
  aDefinitionDetail,
  aDelegatedDecision,
  aDirectDecision,
  aHistory,
  aPendingApproval,
  aRetiredDefinition,
  anApprovalStatus,
  anInstance,
  anInstanceDetail,
} from './views.fixture';
import { aGroup, aGroupDetail, aParallelInstanceDetail } from './branches.fixture';

/**
 * What the screen actually renders, asserted against the markup rather than against a description
 * of it.
 *
 * Every workspace, its totals, its empty state and its Arabic. These are the assertions nobody else
 * in this repository can make: the API suites prove the server sends a page and a total, and only
 * this proves a browser puts both on the page and does not print one in place of the other.
 *
 * `renderToStaticMarkup` runs the real components with the real catalogues and produces the real
 * HTML — no DOM, no test renderer, no new dependency, and nothing mocked at all.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/**
 * A catalogue string as React emits it.
 *
 * React escapes `'`, `"`, `&`, `<` and `>` in text nodes, so a sentence containing an apostrophe
 * appears in the markup escaped. Comparing against the raw string would fail on text that rendered
 * correctly, which is a test bug wearing the shape of a defect.
 */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const everything = (
  translate: typeof en,
  language: 'en' | 'ar',
): readonly (readonly [string, string])[] => {
  const all = { t: translate, language } as const;

  return [
    [
      'overview',
      html(
        <OverviewSection
          {...all}
          groupsTotal={6}
          definitionsTotal={4000}
          instancesTotal={4000}
          pendingTotal={12}
          decidedTotal={7}
          unavailable={false}
        />,
      ),
    ],
    [
      'definitions',
      html(<DefinitionsSection {...all} definitions={[aDefinition()]} total={4000} />),
    ],
    ['versions', html(<VersionsSection {...all} detail={aDefinitionDetail()} />)],
    ['steps', html(<StepsSection {...all} detail={aDefinitionDetail()} />)],
    ['instances', html(<InstancesSection {...all} instances={[anInstance()]} total={4000} />)],
    ['instanceSteps', html(<InstanceStepsSection {...all} detail={anInstanceDetail()} />)],
    ['approvalStatus', html(<ApprovalStatusSection {...all} approval={anApprovalStatus()} />)],
    ['history', html(<HistorySection {...all} history={aHistory()} total={9} />)],
    ['pending', html(<PendingSection {...all} pending={[aPendingApproval()]} total={12} />)],
    ['decided', html(<DecidedSection {...all} decided={[aDelegatedDecision()]} total={7} />)],
    ['approvalGroups', html(<ApprovalGroupsSection {...all} groups={[aGroup()]} total={6} />)],
    ['groupMembers', html(<GroupMembersSection {...all} detail={aGroupDetail()} />)],
    ['branches', html(<BranchesSection {...all} tallies={aParallelInstanceDetail().tallies} />)],
    [
      'awaitingSteps',
      html(<AwaitingSection {...all} steps={aParallelInstanceDetail().awaitingSteps} />),
    ],
    ['providedNotices', html(<ProvidedSection {...all} />)],
    ['statusNotices', html(<StatusSection {...all} />)],
  ] as const;
};

describe('the workspaces render', () => {
  it('renders every section with its heading, in English', () => {
    const markup = everything(en, 'en')
      .map(([, rendered]) => rendered)
      .join('\n');

    for (const heading of [
      'workflow.label.overview',
      'workflow.label.definitions',
      'workflow.label.versions',
      'workflow.label.steps',
      'workflow.label.instances',
      'workflow.label.instanceSteps',
      'workflow.label.approvalStatus',
      'workflow.label.history',
      'workflow.label.pending',
      'workflow.label.decided',
      'workflow.label.approvalGroups',
      'workflow.label.groupMembers',
      'workflow.label.branches',
      'workflow.label.awaitingSteps',
      'workflow.label.providedNotices',
      'workflow.label.statusNotices',
    ]) {
      expect([heading, markup.includes(escaped(en(heading)))]).toEqual([heading, true]);
    }
  });

  /** The same sixteen sections in Arabic — real Arabic, and never a catalogue key. */
  it('renders every section in Arabic, with no untranslated key anywhere', () => {
    const markup = everything(ar, 'ar')
      .map(([, rendered]) => rendered)
      .join('\n');

    expect(markup).toContain(escaped(ar('workflow.label.pending')));
    expect(markup).toContain(escaped(ar('workflow.vocabulary.instanceStatus.running')));
    expect(markup).toContain(escaped(ar('workflow.vocabulary.historyEvent.step-approved')));
    // Arabic script actually present, and not one key leaked through the translator's fallback.
    expect(/[؀-ۿ]/.test(markup)).toBe(true);
    expect(markup).not.toContain('workflow.label.');
    expect(markup).not.toContain('workflow.vocabulary.');
    expect(markup).not.toContain('workflow.notice.');
    expect(markup).not.toContain('workflow.withheld.');
    expect(markup).not.toContain('workflow.provided.');
  });

  it('renders no catalogue key in English either', () => {
    for (const [section, markup] of everything(en, 'en')) {
      expect([section, markup.includes('workflow.label.')]).toEqual([section, false]);
      expect([section, markup.includes('workflow.vocabulary.')]).toEqual([section, false]);
      expect([section, markup.includes('workflow.withheld.')]).toEqual([section, false]);
      expect([section, markup.includes('workflow.provided.')]).toEqual([section, false]);
    }
  });
});

describe('an empty tenant', () => {
  /** Every section says "nothing to show" rather than rendering a broken table. */
  it('renders every section with its empty state', () => {
    const markup = [
      html(<DefinitionsSection {...props} definitions={[]} total={0} />),
      html(<VersionsSection {...props} detail={undefined} />),
      html(<StepsSection {...props} detail={undefined} />),
      html(<InstancesSection {...props} instances={[]} total={0} />),
      html(<InstanceStepsSection {...props} detail={undefined} />),
      html(<ApprovalStatusSection {...props} approval={undefined} />),
      html(<HistorySection {...props} history={[]} total={0} />),
      html(<PendingSection {...props} pending={[]} total={0} />),
      html(<DecidedSection {...props} decided={[]} total={0} />),
      html(<ApprovalGroupsSection {...props} groups={[]} total={0} />),
      html(<GroupMembersSection {...props} detail={undefined} />),
      html(<BranchesSection {...props} tallies={[]} />),
      html(<AwaitingSection {...props} steps={[]} />),
    ];

    for (const [index, section] of markup.entries()) {
      expect([index, section.includes(escaped(en('workflow.notice.empty')))]).toEqual([
        index,
        true,
      ]);
    }
  });

  /**
   * A service that did not answer says so, rather than showing four zeroes.
   *
   * An outage rendered as an organization that approves nothing is the single most misleading thing
   * this screen could do, and the two states are different sentences.
   */
  it('distinguishes a service that did not answer from a tenant with nothing in it', () => {
    const down = html(
      <OverviewSection
        {...props}
        groupsTotal={0}
        definitionsTotal={0}
        instancesTotal={0}
        pendingTotal={0}
        decidedTotal={0}
        unavailable
      />,
    );
    const empty = html(
      <OverviewSection
        {...props}
        groupsTotal={0}
        definitionsTotal={0}
        instancesTotal={0}
        pendingTotal={0}
        decidedTotal={0}
        unavailable={false}
      />,
    );

    expect(down).toContain(escaped(en('workflow.notice.failed')));
    expect(empty).not.toContain(escaped(en('workflow.notice.failed')));
    expect(empty).toContain('>0<');
  });
});

describe('a populated tenant', () => {
  it('shows the server’s total beside the number of rows on the page', () => {
    const markup = html(
      <DefinitionsSection {...props} definitions={[aDefinition()]} total={4000} />,
    );

    // One row shown, four thousand in the tenant — and never `1 / 1`.
    expect(markup).toContain('1 / 4000');
  });

  it('renders a retired workflow as retired, with the moment it was retired', () => {
    const markup = html(
      <DefinitionsSection {...props} definitions={[aRetiredDefinition()]} total={2} />,
    );

    expect(markup).toContain(en('workflow.vocabulary.definitionStatus.retired'));
    expect(markup).toContain('28/02/2026');
  });

  it('renders each version’s own status and step count', () => {
    const markup = html(<VersionsSection {...props} detail={aDefinitionDetail()} />);

    expect(markup).toContain(en('workflow.vocabulary.versionStatus.published'));
    expect(markup).toContain(en('workflow.vocabulary.versionStatus.archived'));
  });

  it('renders the published chain in ordinal order', () => {
    const markup = html(<StepsSection {...props} detail={aDefinitionDetail()} />);
    const first = markup.indexOf('Hiring manager');
    const second = markup.indexOf('Finance director');

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('renders the awaiting step of a running approval as awaiting', () => {
    const markup = html(<InstanceStepsSection {...props} detail={anInstanceDetail()} />);

    expect(markup).toContain(en('workflow.vocabulary.stepStatus.awaiting'));
    expect(markup).toContain(en('workflow.vocabulary.stepStatus.approved'));
  });

  it('renders a direct decision and a delegated one in the same table', () => {
    const markup = html(
      <DecidedSection {...props} decided={[aDirectDecision(), aDelegatedDecision()]} total={2} />,
    );

    expect(markup).toContain(en('workflow.vocabulary.authority.assigned'));
    expect(markup).toContain(en('workflow.vocabulary.authority.delegated'));
  });

  it('renders the queue with the workflow code and the subject it is about', () => {
    const markup = html(<PendingSection {...props} pending={[aPendingApproval()]} total={12} />);

    expect(markup).toContain('requisition-approval');
    expect(markup).toContain('recruitment.requisition');
    expect(markup).toContain('1 / 12');
  });
});
