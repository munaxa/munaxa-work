import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Figure, Isolated, Wrote, shownOf } from './frame';
import { relationsTranslator } from './locale';
import { ViolationsSection } from './employment-relations';
import { CaseFacts, CaseStateSection, InvestigationsSection } from './case';
import { ApplicableSection, IssuedActionSection, RepeatSection } from './case-discipline';
import {
  aCaseHistory,
  aCatalogue,
  aViolation,
  aViolationPage,
  anApplicable,
  anEscalation,
  anInvestigations,
  anIssuedAction,
} from './relations.fixture';

/**
 * Every Latin run inside Arabic, and what happens when one is not isolated.
 *
 * A relations screen is dense in Latin runs even in Arabic: a category code, a tenant's severity
 * word, three civil dates, an instant, a membership identifier, a violation identifier and two
 * ordinals — on every case. All of them are values somebody stored or the module derived, none is
 * a label this product ships, and each is a candidate for reordering by the bidirectional
 * algorithm.
 *
 * **A ratio must be one isolate, not two.** Isolating only the total leaves the page count as a
 * second left-to-right run, and inside an Arabic paragraph the later run comes first: `2 / 7`
 * renders as `7 / 2`, which reads as a page bigger than its own total.
 */

const ar = relationsTranslator('ar');
const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('the isolation primitives', () => {
  it('isolates an identifier without forcing its direction', () => {
    expect(html(<Isolated>{'01900000-0000-7000-8000-00000000v001'}</Isolated>)).toBe(
      '<bdi>01900000-0000-7000-8000-00000000v001</bdi>',
    );
  });

  it('forces an ordinal left to right, because a count can arrive beside a neutral character', () => {
    expect(html(<Figure>{'3'}</Figure>)).toBe('<bdi dir="ltr">3</bdi>');
  });

  it('isolates free text so its own first strong character decides its direction', () => {
    expect(html(<Wrote>{'The arrival time is not disputed.'}</Wrote>)).toBe(
      '<bdi>The arrival time is not disputed.</bdi>',
    );
  });

  it('renders a dash rather than an empty isolate for an absent value', () => {
    expect(html(<Wrote>{undefined}</Wrote>)).toBe('<span>—</span>');
  });

  it('puts the whole ratio in one isolate rather than isolating the total alone', () => {
    expect(html(<>{shownOf({ items: [1, 2], total: 7 })}</>)).toBe('<bdi>2 / 7</bdi>');
  });

  it('renders nothing at all for a listing that was refused', () => {
    expect(html(<>{shownOf(undefined)}</>)).toBe('');
  });
});

describe('every Latin run on an Arabic relations screen is isolated', () => {
  /**
   * Anything outside a `<bdi>` that is a run of Latin letters, digits or the separators around
   * them is a candidate for reordering. The catalogue's own Arabic text is Arabic, so what is left
   * in the stripped markup should be Arabic and punctuation only.
   */
  const unisolated = (markup: string): readonly string[] => {
    const withoutTags = markup
      .replaceAll(/<bdi[^>]*>.*?<\/bdi>/g, '')
      // Prose from the catalogue is the translator's own sentence, not a value this screen
      // composed. What this test is for is the values the *screen* puts beside that prose.
      .replaceAll(/<p\b[^>]*>.*?<\/p>/g, '')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll('&#x27;', "'")
      .replaceAll('&quot;', '"');

    return withoutTags.match(/[A-Za-z0-9][A-Za-z0-9.,:%/-]*/g) ?? [];
  };

  /**
   * The detector itself, asserted before anything is asserted with it.
   *
   * In three earlier slices a sweep that passed on its first run meant the helper was blind rather
   * than the markup clean. This renders a value deliberately outside a `<bdi>` and requires that
   * it is caught, so a sweep that passes is a sweep that could have failed.
   */
  it('catches a value that is not isolated', () => {
    expect(unisolated('<td>LATENESS</td>')).toEqual(['LATENESS']);
    expect(unisolated('<td><bdi>LATENESS</bdi></td>')).toEqual([]);
  });

  it('leaves no bare code, date, severity or identifier on the violations list', () => {
    const markup = html(
      <ViolationsSection
        t={ar}
        language="ar"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value among the case’s own facts', () => {
    const markup = html(<CaseFacts t={ar} language="ar" violation={aViolation()} />);

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare actor, instant or ordinal on the case history', () => {
    expect(unisolated(html(<CaseStateSection t={ar} history={aCaseHistory()} />))).toEqual([]);
  });

  it('leaves no bare date or identifier among the inquiries', () => {
    const markup = html(<InvestigationsSection t={ar} investigations={anInvestigations()} />);

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare window, date or identifier on the repeat position', () => {
    expect(
      unisolated(html(<RepeatSection t={ar} language="ar" escalation={anEscalation()} />)),
    ).toEqual([]);
  });

  it('leaves no bare figure on either disciplinary section', () => {
    const markup = [
      html(<ApplicableSection t={ar} applicable={anApplicable()} />),
      html(<IssuedActionSection t={ar} action={{ kind: 'ok', value: anIssuedAction() }} />),
    ].join('');

    expect(unisolated(markup)).toEqual([]);
  });
});
