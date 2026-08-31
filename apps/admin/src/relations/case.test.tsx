import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { relationsTranslator } from './locale';
import { CaseFacts, CaseStateSection, InvestigationsSection } from './case';
import { ApplicableSection, IssuedActionSection, RepeatSection } from './case-discipline';
import {
  EMPLOYMENT_A,
  VIOLATION_PRIOR,
  aCaseHistory,
  aCaseWithoutAction,
  aRedactedInvestigations,
  aSilentApplicable,
  aViolation,
  aWithheldCaseContext,
  anApplicable,
  anEscalation,
  anInvestigations,
  anIssuedAction,
} from './relations.fixture';

/**
 * One case and everything published about it.
 *
 * The properties under test are the ones this screen could most plausibly get wrong: that a
 * withheld findings payload is never marked as redacted, that "no action issued" never reads as
 * "you may not know", that policy silence is stated rather than filled, that no ordinal or state
 * is re-derived here, and that the module's own answer to "whose record is this" stays an
 * identifier that links rather than a name this module refuses to hold.
 */

const en = relationsTranslator('en');
const ar = relationsTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('the facts of the violation', () => {
  it('links the employment to its record by the published identifier, whole', () => {
    const markup = html(<CaseFacts t={en} language="en" violation={aViolation()} />);

    expect(markup).toContain(`href="/employment/${EMPLOYMENT_A}?lang=en"`);
    expect(markup).toContain(EMPLOYMENT_A);
  });

  it('shows the occurrence ordinal the module derived, and only that one', () => {
    const markup = html(<CaseFacts t={en} language="en" violation={aViolation()} />);

    expect(markup).toContain('3');
    // Absent when the module could not derive it — a dash, never a defaulted 1.
    const { occurrence: _occurrence, ...withoutOrdinal } = aViolation();
    const undecorated = html(<CaseFacts t={en} language="en" violation={withoutOrdinal} />);

    expect(undecorated).toContain('—');
    expect(undecorated).not.toContain('>1<');
  });

  it('carries the frozen category code, whatever today’s catalogue says', () => {
    const markup = html(<CaseFacts t={en} language="en" violation={aViolation()} />);

    expect(markup).toContain('LATENESS');
  });

  /**
   * Rendering the page found the case state three times on one screen — the header badge, this
   * grid, and the case history. The header and the history each have a reason to carry it; this
   * grid does not, and the duplication is pinned out here.
   */
  it('repeats neither the state badge nor the category name the header already carries', () => {
    const markup = html(<CaseFacts t={en} language="en" violation={aViolation()} />);

    expect(markup).not.toContain(en('relations.state.under_investigation'));
    expect(markup).not.toContain('Repeated lateness');
  });
});

describe('where the case is', () => {
  it('renders the state the module derived beside its own history, and never re-derives it', () => {
    const markup = html(<CaseStateSection t={en} history={aCaseHistory()} />);

    expect(markup).toContain(en('relations.state.under_investigation'));
    expect(markup).toContain(en('relations.state.reported'));
  });

  it('keeps every movement explained: its actor and its reason are on the row', () => {
    const markup = html(<CaseStateSection t={en} history={aCaseHistory()} />);

    expect(markup).toContain('membership-hr-041');
    expect(markup).toContain('Opened an inquiry into the third occurrence.');
  });

  it('says an untouched case has had nothing happen, rather than showing an empty table', () => {
    const markup = html(
      <CaseStateSection
        t={en}
        history={{ violationId: 'x', currentState: 'reported', history: [] }}
      />,
    );

    expect(markup).toContain(en('relations.empty.history'));
    expect(markup).toContain(en('relations.state.reported'));
  });
});

describe('the inquiries', () => {
  it('distinguishes a refused list from a case nobody has investigated', () => {
    const refused = html(
      <InvestigationsSection t={en} investigations={aWithheldCaseContext().investigations} />,
    );
    const empty = html(<InvestigationsSection t={en} investigations={{ items: [], total: 0 }} />);

    expect(refused).toContain(en('relations.withheld.violationRead'));
    expect(empty).toContain(en('relations.empty.investigations'));
    expect(empty).not.toContain(en('relations.withheld.violationRead'));
  });

  it('renders findings where the module supplied them, and the correction link between accounts', () => {
    const markup = html(<InvestigationsSection t={en} investigations={anInvestigations()} />);

    expect(markup).toContain('The badge log confirms the arrival time');
    expect(markup).toContain(en('relations.label.corrects'));
  });

  /**
   * The module's own redaction design, preserved: withheld findings are **absent**, exactly as for
   * an inquiry still open, and never marked. A "redacted" marker would tell a reader that findings
   * exist about somebody — which, in this module's words, is itself the disclosure.
   */
  it('marks nothing where findings were withheld — no label, no dash, no redaction notice', () => {
    const markup = html(
      <InvestigationsSection t={en} investigations={aRedactedInvestigations()} />,
    );

    expect(markup).not.toContain(en('relations.label.findings'));
    expect(markup).not.toContain(en('relations.label.recommendation'));
    // The inquiries themselves stay visible: existence is part of the case.
    expect(markup).toContain('2 / 2');
    expect(markup).toContain(en('relations.investigationState.concluded'));
  });
});

describe('the repeat position', () => {
  it('publishes the window with the count, and links every contributing case', () => {
    const markup = html(<RepeatSection t={en} language="en" escalation={anEscalation()} />);

    expect(markup).toContain('180');
    expect(markup).toContain('2025-11-05');
    expect(markup).toContain(`href="/relations/cases/${VIOLATION_PRIOR}?lang=en"`);
  });
});

describe('what the ladder says, and what was issued', () => {
  it('states policy silence rather than inventing a suggestion', () => {
    const markup = html(<ApplicableSection t={en} applicable={aSilentApplicable()} />);

    expect(markup).toContain(en('relations.notice.noRuleNoAction'));
    expect(markup).not.toContain(en('relations.actionType.written_warning'));
  });

  it('translates a suggested action in both languages', () => {
    expect(html(<ApplicableSection t={en} applicable={anApplicable()} />)).toContain(
      en('relations.actionType.written_warning'),
    );
    expect(html(<ApplicableSection t={ar} applicable={anApplicable()} />)).toContain(
      ar('relations.actionType.written_warning'),
    );
  });

  it('keeps "nothing issued" apart from "you may not know"', () => {
    const nothing = html(<IssuedActionSection t={en} action={aCaseWithoutAction().action} />);
    const refused = html(<IssuedActionSection t={en} action={{ kind: 'refused' }} />);

    expect(nothing).toContain(en('relations.empty.action'));
    expect(nothing).not.toContain(en('relations.withheld.violationRead'));
    expect(refused).toContain(en('relations.withheld.violationRead'));
    expect(refused).not.toContain(en('relations.empty.action'));
  });

  it('shows the issued action frozen as taken, with who issued it and why', () => {
    const markup = html(
      <IssuedActionSection t={en} action={{ kind: 'ok', value: anIssuedAction() }} />,
    );

    expect(markup).toContain(en('relations.actionType.written_warning'));
    expect(markup).toContain('membership-hr-007');
    expect(markup).toContain(en('relations.prescribedByRule.yes'));
    expect(markup).toContain('Third occurrence inside the window');
    // Recording an action carries nothing out, and the screen says so in the customer's words.
    expect(markup).toContain(en('relations.notice.actionNotExecuted'));
  });
});
