import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRANCH_RULES, CONDITION_OPERATORS } from '@work/workflow/contracts';

import { translator } from './locale';
import { AwaitingSection, BranchesSection } from './branches';
import { StepsSection } from './definitions';
import { InstanceStepsSection } from './instances';
import { APPROVER, DEPUTY } from './views.fixture';
import {
  GROUP_ID,
  THIRD,
  aBranchedDefinitionDetail,
  aParallelInstanceDetail,
} from './branches.fixture';

/**
 * Branches, tallies and conditions — and the arithmetic that must not be here.
 *
 * The API suites prove the server computes a threshold correctly. What only this can prove is that
 * the screen **renders the server's numbers rather than its own**: the fixture is built so that a
 * screen deriving any figure would disagree with it. `majority` over a denominator of two needs two
 * approvals, and one approval has been made — so a screen printing `approvals` where `threshold`
 * belongs shows `1`, and one deriving `assigned / 2` shows `1` as well.
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

const cells = (markup: string): readonly string[] =>
  [...markup.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1] ?? '');

describe('a tally is the server’s arithmetic', () => {
  it('renders every figure of a branch exactly as the API sent it', () => {
    const markup = html(<BranchesSection {...props} tallies={aParallelInstanceDetail().tallies} />);
    const first = cells(markup).slice(0, 11);

    // Position, rule, asked, approved, rejected, answered, outstanding, needed, quorum, quorum
    // state, outcome — in that order, and every number the one the server computed.
    expect(first[0]).toBe('1');
    expect(first[2]).toBe('2');
    expect(first[3]).toBe('1');
    expect(first[4]).toBe('0');
    expect(first[5]).toBe('1');
    expect(first[6]).toBe('1');
    // The one a screen deriving `floor(assigned / 2)` or reusing `approvals` would get wrong.
    expect(first[7]).toBe('2');
    expect(first[8]).toBe('2');
  });

  it('renders the rule, the quorum state and the outcome as translated terms', () => {
    const markup = html(<BranchesSection {...props} tallies={aParallelInstanceDetail().tallies} />);

    expect(markup).toContain(en('workflow.vocabulary.branchRule.majority'));
    expect(markup).toContain(en('workflow.vocabulary.quorumMet.not-met'));
    expect(markup).toContain(en('workflow.vocabulary.branchOutcome.awaiting'));
  });

  it('renders the same figures in Arabic, with no localized digits and no separator', () => {
    const markup = html(
      <BranchesSection t={ar} language="ar" tallies={aParallelInstanceDetail().tallies} />,
    );

    expect(markup).toContain(ar('workflow.vocabulary.branchRule.majority'));
    expect(markup).toContain('>2<');
    expect(/[٠-٩]/.test(markup)).toBe(false);
    expect(markup).not.toContain('workflow.vocabulary.');
  });

  /**
   * The absence of arithmetic, asserted against the source rather than the markup.
   *
   * A screen can render the right numbers today and still contain the division that produces the
   * wrong one tomorrow. There is no percentage, no bar and no operator between two figures in this
   * file, and this is the assertion that keeps it that way.
   */
  it('contains no arithmetic, no percentage and no progress bar', () => {
    const source = readFileSync(join(import.meta.dirname, 'branches.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const arithmetic of ['/ 2', '* 100', 'Math.', 'toFixed', '%', 'width:', 'progress']) {
      expect([arithmetic, source.includes(arithmetic)]).toEqual([arithmetic, false]);
    }
    // The figures are read and rendered; none is combined with another.
    expect(source).not.toMatch(/tally\.\w+\s*[+\-*/]/);
  });

  it('says in words that the numbers are the server’s own count', () => {
    const markup = html(<BranchesSection {...props} tallies={aParallelInstanceDetail().tallies} />);

    expect(markup).toContain(escaped(en('workflow.notice.tallyIsServerComputed')));
  });

  it('renders an empty state for an approval with no branch to show', () => {
    expect(html(<BranchesSection {...props} tallies={[]} />)).toContain(
      escaped(en('workflow.notice.empty')),
    );
  });
});

describe('a branch is several people at once', () => {
  it('renders every awaiting step rather than the first of them', () => {
    const detail = aParallelInstanceDetail();
    const markup = html(
      <AwaitingSection
        {...props}
        steps={[...detail.steps].filter((s) => s.status === 'awaiting')}
      />,
    );

    expect(markup).toContain(`>${DEPUTY}<`);
    expect(markup).toContain(escaped(en('workflow.notice.branchIsSimultaneous')));
  });

  it('shows two steps sharing one position, both of them', () => {
    const markup = html(
      <AwaitingSection {...props} steps={aParallelInstanceDetail().steps.slice(0, 2)} />,
    );
    const positions = cells(markup).filter((cell) => cell === '1');

    // Two rows, both at position 1 — a screen rendering a branch as one step would show one.
    expect(positions).toHaveLength(2);
    expect(markup).toContain(`>${APPROVER}<`);
    expect(markup).toContain(`>${DEPUTY}<`);
  });

  /** A decision already recorded is that decision, and never a step that was skipped. */
  it('renders a decided step as decided and an unreached one as not yet reached', () => {
    const markup = html(<InstanceStepsSection {...props} detail={aParallelInstanceDetail()} />);

    expect(markup).toContain(en('workflow.vocabulary.stepStatus.approved'));
    expect(markup).toContain(en('workflow.vocabulary.stepStatus.awaiting'));
    expect(markup).toContain(en('workflow.vocabulary.stepStatus.pending'));
    expect(markup).not.toContain(en('workflow.vocabulary.stepStatus.skipped'));
  });

  /** Provenance: the list somebody came from, on a step that names the person and not the list. */
  it('records which list an approver was taken from, without routing through it', () => {
    const markup = html(<InstanceStepsSection {...props} detail={aParallelInstanceDetail()} />);

    expect(markup).toContain(GROUP_ID.slice(0, 8));
    // The step after the branch names one person individually and came from no list.
    expect(markup).toContain(`>${THIRD}<`);
  });
});

describe('a step names a person or a list', () => {
  it('renders a group approver as a group and a membership approver as a member', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    expect(markup).toContain(en('workflow.vocabulary.approverKind.group'));
    expect(markup).toContain(en('workflow.vocabulary.approverKind.membership'));
    expect(markup).toContain(GROUP_ID.slice(0, 8));
    expect(markup).toContain(`>${THIRD}<`);
  });

  it('shows the rule and the quorum on the branch, and neither on the step without them', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    expect(markup).toContain(en('workflow.vocabulary.branchRule.majority'));
    // The second step was configured before any of this existed. Its cells are absent rather than
    // filled with the defaults the domain would apply — printing `unanimous` there would report a
    // decision the tenant never made.
    expect(markup).not.toContain(en('workflow.vocabulary.branchRule.unanimous'));
    expect(markup).toContain('>—<');
  });

  it('offers only the rules the domain declares', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    expect(BRANCH_RULES).toStrictEqual(['unanimous', 'majority', 'first-response']);
    for (const invented of ['two-thirds', 'weighted', 'any-two', '66%']) {
      expect([invented, markup.includes(invented)]).toEqual([invented, false]);
    }
  });
});

describe('a condition is configuration, not a result', () => {
  it('renders each clause with its key, its comparison and its operand', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    expect(markup).toContain('amount');
    expect(markup).toContain(en('workflow.vocabulary.conditionOperator.greater-than'));
    // A whole number bound, exactly as configured — no separator, no decimal.
    expect(markup).toContain('4000');
    expect(markup).not.toContain('4,000');
    // A list operand, in the order it was configured.
    expect(markup).toContain('finance, operations');
  });

  /**
   * No evaluated result anywhere, and this is the assertion the checkpoint turns on.
   *
   * The server tells three configuration mistakes apart from an ordinary "the condition did not
   * hold": the request did not carry the value, the value is of a kind this comparison cannot use,
   * and the value is of a different kind from the one configured. A screen printing `false` would
   * collapse four outcomes into one, and three of them are somebody's mistake to fix.
   */
  it('renders no true, no false and no evaluation of any kind', () => {
    const markup = html(
      <StepsSection {...props} detail={aBranchedDefinitionDetail()} />,
    ).toLowerCase();

    for (const verdict of [
      '>true<',
      '>false<',
      'would run',
      'matches',
      'does not match',
      '✓',
      '✗',
    ]) {
      expect([verdict, markup.includes(verdict)]).toEqual([verdict, false]);
    }
  });

  it('says a condition is evaluated by the server when an approval starts', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    expect(markup).toContain(escaped(en('workflow.notice.conditionIsConfiguration')));
  });

  it('translates every operator the domain has, and invents none it does not', () => {
    expect(CONDITION_OPERATORS).toStrictEqual([
      'equals',
      'not-equals',
      'greater-than',
      'less-than',
      'in',
    ]);
    for (const operator of CONDITION_OPERATORS) {
      const key = `workflow.vocabulary.conditionOperator.${operator}`;

      expect([operator, en(key)]).not.toStrictEqual([operator, key]);
      expect([operator, ar(key)]).not.toStrictEqual([operator, key]);
    }
  });

  it('renders a step with no condition as having none, rather than as one that is always true', () => {
    const markup = html(<StepsSection {...props} detail={aBranchedDefinitionDetail()} />);

    // The second step has no clauses. It renders as absent — not as `true`, and not as "always".
    expect(markup).toContain('>—<');
    expect(markup.toLowerCase()).not.toContain('always');
  });
});
