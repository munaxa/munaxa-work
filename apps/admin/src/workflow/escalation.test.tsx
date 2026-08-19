import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { isLanguage, translator } from './locale';
import { InstanceStepsSection } from './instances';
import { APPROVER, DEPUTY, ESCALATED, MANAGER, anInstanceDetail } from './views.fixture';

/**
 * Telling an approver somebody was asked from an approver somebody added.
 *
 * **The distinction is published, and this file exists to prove the screen reads it rather than
 * guessing it.** Every way of guessing is wrong in a way that looks right on the fixtures a guess
 * would be written against: the branch at ordinal 2 has *two* rows and a snapshotted denominator of
 * *one* (D-16D-08), so a screen counting rows would call the extra row escalated and be right by
 * accident — and then call the manager step at ordinal 3 escalated too, because it is the fourth row
 * of an approval whose tallies add up to three.
 *
 * So the assertions below are paired throughout: what renders as escalated, and what must **not**.
 */

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const steps = (language: 'en' | 'ar' = 'en'): string =>
  html(
    <InstanceStepsSection
      t={translator(language)}
      language={language}
      detail={anInstanceDetail()}
    />,
  );

/** The row a membership appears in, so a cell can be read against the person it belongs to. */
const rowFor = (markup: string, membershipId: string): string => {
  const rows = markup.split('<tr>').filter((row) => row.includes(membershipId));

  expect(rows).toHaveLength(1);
  return rows[0] ?? '';
};

describe('an escalated approver, on the steps table', () => {
  const en = translator('en');

  it('marks the added approver as escalated', () => {
    expect(rowFor(steps(), ESCALATED)).toContain(
      en('workflow.vocabulary.approverOrigin.escalated'),
    );
  });

  /**
   * And every other row says `assigned` — including the fourth.
   *
   * `MANAGER` is the fourth step of this approval and was resolved at the start, not added later. A
   * screen deriving the marker from position, from row count, or from the branch's denominator would
   * mark it, and nothing about the page would look wrong.
   */
  it.each([
    ['the approver who already decided', APPROVER],
    ['the approver still awaiting', DEPUTY],
    ['the resolved manager, who is the fourth row', MANAGER],
  ])('leaves %s as assigned', (_who, membershipId) => {
    const row = rowFor(steps(), membershipId);

    expect(row).toContain(en('workflow.vocabulary.approverOrigin.assigned'));
    expect(row).not.toContain(en('workflow.vocabulary.approverOrigin.escalated'));
  });

  /** Both kinds in one branch, which is the case the distinction exists for. */
  it('shows an assigned and an escalated approver at the same ordinal', () => {
    const markup = steps();

    expect(rowFor(markup, DEPUTY)).toContain(en('workflow.vocabulary.approverOrigin.assigned'));
    expect(rowFor(markup, ESCALATED)).toContain(en('workflow.vocabulary.approverOrigin.escalated'));
    // Exactly one row is marked, out of four.
    const marked = markup
      .split('<tr>')
      .filter((row) => row.includes(en('workflow.vocabulary.approverOrigin.escalated')));

    expect(marked).toHaveLength(1);
  });

  /**
   * **The denominator disagrees with the row count, and the screen prints both unchanged.**
   *
   * Two rows await at ordinal 2 while its tally reads one assigned and a threshold of one. That is
   * D-16D-08 as an administrator sees it, and it is the fixture that makes "count the rows" fail:
   * a screen recomputing either number would print two where the server said one.
   */
  it('renders a branch whose rows outnumber its denominator without recomputing either', () => {
    const detail = anInstanceDetail();
    const second = detail.tallies?.find((tally) => tally.ordinal === 2);

    expect(detail.steps.filter((step) => step.ordinal === 2)).toHaveLength(2);
    expect([second?.assigned, second?.threshold]).toStrictEqual([1, 1]);
    // And the marker is the server's field on the row, not a function of that disagreement.
    expect(detail.steps.filter((step) => step.escalated)).toHaveLength(1);
  });
});

describe('how the screen decides', () => {
  /**
   * No arithmetic, no clock, and no second source.
   *
   * Asserted over the component's source rather than its output, because a screen that computed the
   * right answer today would still be a second implementation of a rule the server owns.
   */
  it('derives the marker from the published field alone', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./instances.tsx', import.meta.url), 'utf8'),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('step.escalated');
    for (const guess of [
      'Math.',
      'Date.now',
      'new Date',
      '.length >',
      // The *tally* fields, as property reads. The bare words are not forbidden: `'assigned'` is
      // the value this cell prints, and banning the string would ban the feature.
      '.assigned',
      '.threshold',
      '.outstanding',
      'tallies',
      'sourceGroupId ?',
      'history',
      'fetch(',
    ]) {
      expect([guess, code.includes(guess)]).toStrictEqual([guess, false]);
    }
  });

  /** And it stays a table: nothing here is a control, and escalating is still an API act. */
  it('renders no mutation control beside the marker', () => {
    const markup = steps().toLowerCase();

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      'action=',
      'onclick',
      'href=',
    ]) {
      expect([control, markup.includes(control)]).toStrictEqual([control, false]);
    }
  });
});

describe('the distinction in both languages', () => {
  it.each(['en', 'ar'] as const)('renders words rather than keys in %s', (language) => {
    const translate = translator(language);
    const markup = steps(language);

    for (const key of [
      'workflow.label.approverOrigin',
      'workflow.vocabulary.approverOrigin.assigned',
      'workflow.vocabulary.approverOrigin.escalated',
    ]) {
      const word = translate(key);

      expect(word).not.toBe(key);
      expect(markup).toContain(word);
    }
    // And no raw key survived anywhere on the section.
    expect(markup).not.toContain('workflow.vocabulary.approverOrigin');
    expect(markup).not.toContain('workflow.label.approverOrigin');
  });

  /** The Arabic is Arabic, not the English wearing an Arabic key. */
  it('uses Arabic script for the Arabic terms', () => {
    const ar = translator('ar');

    for (const key of [
      'workflow.label.approverOrigin',
      'workflow.vocabulary.approverOrigin.assigned',
      'workflow.vocabulary.approverOrigin.escalated',
    ]) {
      expect(ar(key)).toMatch(/[؀-ۿ]/);
      expect(ar(key)).not.toBe(translator('en')(key));
    }
  });

  /** An unrecognised language is not a language: the page falls back as it always has. */
  it('falls back for a language the catalogue does not have', () => {
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('ar')).toBe(true);
  });
});
