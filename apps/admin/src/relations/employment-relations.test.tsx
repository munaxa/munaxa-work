import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { relationsTranslator } from './locale';
import { ViolationsSection } from './employment-relations';
import {
  VIOLATION_A,
  aCatalogue,
  aRefusedEmploymentRelations,
  aViolationPage,
  anEmptyEmploymentRelations,
} from './relations.fixture';

/**
 * One employment's relations record, asserted against the markup rather than a description of it.
 *
 * The properties under test are the ones a disciplinary listing could most plausibly get wrong:
 * that a refused list never reads as a clean record, that the total is the server's, that a case
 * opens by its own identifier, that the list carries no ordinal the module deliberately did not
 * decorate it with, and that the tenant's own grading word is never translated.
 */

const en = relationsTranslator('en');
const ar = relationsTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('the violations of one employment', () => {
  it('says a refused list was withheld, and an empty one that there is nothing', () => {
    const refused = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aRefusedEmploymentRelations().violations}
        categories={aCatalogue()}
      />,
    );
    const empty = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={anEmptyEmploymentRelations().violations}
        categories={aCatalogue()}
      />,
    );

    // "No violations are recorded" is a statement about a person; a refusal must never make it.
    expect(refused).toContain(en('relations.withheld.violationRead'));
    expect(refused).not.toContain(en('relations.empty.violations'));
    expect(empty).toContain(en('relations.empty.violations'));
    expect(empty).not.toContain(en('relations.withheld.violationRead'));
  });

  it('reports the total the server counted, not the rows it happened to receive', () => {
    const markup = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={undefined}
      />,
    );

    // Two rows, seven violations. A screen counting `items.length` would render `2 / 2`.
    expect(markup).toContain('2 / 7');
  });

  it('opens every case by its own identifier, kept whole beside the link', () => {
    const markup = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );

    expect(markup).toContain(`href="/relations/cases/${VIOLATION_A}?lang=en"`);
    expect(markup).toContain(VIOLATION_A);
  });

  it('names the category from the catalogue, and falls back to the frozen code without it', () => {
    const named = html(
      <ViolationsSection
        t={ar}
        language="ar"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );
    const bare = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={undefined}
      />,
    );

    expect(named).toContain('التأخر المتكرر');
    // The catalogue was withheld: what renders is what the record froze, never an invented name.
    expect(bare).toContain('LATENESS');
  });

  it('carries no occurrence ordinal, because the module does not decorate the list', () => {
    const markup = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );

    expect(markup).not.toContain(en('relations.label.occurrence'));
  });

  it('translates the state and leaves the tenant severity word alone, in both languages', () => {
    const english = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );
    const arabic = html(
      <ViolationsSection
        t={ar}
        language="ar"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );

    expect(english).toContain(en('relations.state.under_investigation'));
    expect(arabic).toContain(ar('relations.state.under_investigation'));
    // The severity is the tenant's own grading word, rendered as stored in both directions.
    expect(english).toContain('minor');
    expect(arabic).toContain('minor');
  });

  it('says on the screen that reading this list is recorded against the reader', () => {
    const markup = html(
      <ViolationsSection
        t={en}
        language="en"
        violations={aViolationPage()}
        categories={aCatalogue()}
      />,
    );

    expect(markup).toContain(en('relations.notice.audited'));
  });
});
