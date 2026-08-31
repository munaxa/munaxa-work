import type { ReactNode } from 'react';
import type {
  CaseEventView,
  CaseHistoryView,
  InvestigationView,
  ViolationView,
} from '@work/relations/contracts';

import type { Language } from './locale';
import {
  Cell,
  Clear,
  Fact,
  Facts,
  Figure,
  Identifier,
  Isolated,
  Reference,
  Refused,
  Region,
  Row,
  Rows,
  Term,
  When,
  Wrote,
  shownOf,
  stateTone,
  type RelationsProps,
} from './frame';
import type { Listing } from './api';

/**
 * One case: the recorded violation, where it is in its lifecycle, and the inquiries into it.
 *
 * **The description is evidence somebody filed, not this product's words.** It renders isolated,
 * in whatever language it was written, and is never truncated: a disciplinary record read back in
 * a dispute must be the record, not an excerpt of it.
 *
 * **`categoryCode` and `severity` are what the catalogue said when the violation was recorded**,
 * not what it says now — the module freezes both so the record keeps meaning what it meant. The
 * catalogue supplies today's bilingual *name* as a courtesy; refused or renamed, the frozen code
 * is what renders.
 *
 * **A concluded inquiry without findings stays exactly as ambiguous as the module made it.** The
 * fields are absent for an inquiry still open and for a caller without
 * `relations.investigation.read-findings` alike, indistinguishable by design — for a manager
 * reading about their own report, knowing an investigator wrote something is most of the
 * disclosure. So this screen renders findings only where the module supplied them and marks
 * nothing as redacted.
 */

interface SectionProps extends RelationsProps {
  readonly language: Language;
}

/** One written account inside a record — a labelled block of somebody's own words. */
const Account = ({ label, text }: { readonly label: string; readonly text: string }): ReactNode => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <p className="text-sm text-foreground">
      <Wrote>{text}</Wrote>
    </p>
  </div>
);

/**
 * The facts of the violation itself — every value the module returned, and nothing derived.
 *
 * The page header already carries the category's *name* and the state badge, so this grid does not
 * repeat either (rendering found the state three times on one screen). What it adds is the frozen
 * `categoryCode` — what the catalogue said when the record was written, even after a rename — and
 * the facts the header has no room for.
 */
export const CaseFacts = ({
  t,
  language,
  violation,
}: SectionProps & { readonly violation: ViolationView }): ReactNode => (
  <Region title={t('relations.label.violation')}>
    <Facts>
      <Fact
        label={t('relations.label.code')}
        value={<Isolated>{violation.categoryCode}</Isolated>}
      />
      <Fact
        label={t('relations.label.severity')}
        value={<Isolated>{violation.severity}</Isolated>}
      />
      <Fact
        label={t('relations.label.occurredOn')}
        value={<Isolated>{violation.occurredOn}</Isolated>}
      />
      <Fact
        label={t('relations.label.recordedOn')}
        value={<Isolated>{violation.recordedOn}</Isolated>}
      />
      <Fact
        label={t('relations.label.occurrence')}
        value={violation.occurrence === undefined ? '—' : <Figure>{violation.occurrence}</Figure>}
      />
      <Fact
        label={t('relations.label.employment')}
        value={
          <a
            className="underline underline-offset-4"
            href={`/employment/${violation.employmentId}?lang=${language}`}
          >
            <Reference value={violation.employmentId} />
          </a>
        }
      />
    </Facts>

    <Account label={t('relations.label.description')} text={violation.description} />
  </Region>
);

const EventRow = ({ t, event }: RelationsProps & { readonly event: CaseEventView }): ReactNode => (
  <Row>
    <Cell numeric>
      <Figure>{event.sequence}</Figure>
    </Cell>
    <Cell>
      <Term t={t} group="state" value={event.fromState} />
    </Cell>
    <Cell>
      <Term t={t} group="state" value={event.toState} />
    </Cell>
    <Cell>
      <Wrote>{event.reason}</Wrote>
    </Cell>
    <Identifier value={event.actor} />
    <When>{event.occurredAt}</When>
  </Row>
);

/**
 * Where the case is, and every transition that got it there.
 *
 * `currentState` is the module's derivation from this same history (D-5.2-16) and renders beside
 * it untouched — nothing here re-derives it from the rows, because two derivations is two answers.
 * Every row names its actor and carries its reason: the module requires both, so no movement in
 * this table is unexplained, and the screen keeps the sequence numbers the trail was written with.
 */
export const CaseStateSection = ({
  t,
  history,
}: RelationsProps & { readonly history: CaseHistoryView | undefined }): ReactNode => {
  const title = t('relations.label.caseHistory');

  if (history === undefined) {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }

  return (
    <Region
      title={title}
      description={
        <Term
          t={t}
          group="state"
          value={history.currentState}
          tone={stateTone(history.currentState)}
        />
      }
    >
      {history.history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('relations.empty.history')}</p>
      ) : (
        <Rows
          headings={[
            t('relations.label.sequence'),
            t('relations.label.from'),
            t('relations.label.to'),
            t('relations.label.reason'),
            t('relations.label.actor'),
            t('relations.label.occurredAt'),
          ]}
          numeric={[0]}
        >
          {history.history.map((event) => (
            <EventRow key={event.caseEventId} t={t} event={event} />
          ))}
        </Rows>
      )}
    </Region>
  );
};

const Inquiry = ({
  t,
  investigation,
}: RelationsProps & { readonly investigation: InvestigationView }): ReactNode => (
  <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
    <Facts>
      <Fact
        label={t('relations.label.state')}
        value={<Term t={t} group="investigationState" value={investigation.state} />}
      />
      <Fact
        label={t('relations.label.openedOn')}
        value={<Isolated>{investigation.openedOn}</Isolated>}
      />
      <Fact
        label={t('relations.label.concludedOn')}
        value={
          investigation.concludedOn === undefined ? (
            '—'
          ) : (
            <Isolated>{investigation.concludedOn}</Isolated>
          )
        }
      />
      <Fact
        label={t('relations.label.investigator')}
        value={<Reference value={investigation.investigatorMembershipId} />}
      />
      {investigation.correctsInvestigationId === undefined ? null : (
        <Fact
          label={t('relations.label.corrects')}
          value={<Reference value={investigation.correctsInvestigationId} />}
        />
      )}
    </Facts>

    <Account label={t('relations.label.subject')} text={investigation.subject} />
    {investigation.findings === undefined ? null : (
      <Account label={t('relations.label.findings')} text={investigation.findings} />
    )}
    {investigation.recommendation === undefined ? null : (
      <Account label={t('relations.label.recommendation')} text={investigation.recommendation} />
    )}
  </div>
);

/**
 * The inquiries, newest first, as the module lists them.
 *
 * The list is the module's redaction boundary: it is never filtered, so a reader sees that an
 * inquiry exists and when it moved, and what it *found* appears only when the caller holds the
 * separate findings grant. This screen adds no marker where the fields are absent.
 */
export const InvestigationsSection = ({
  t,
  investigations,
}: RelationsProps & {
  readonly investigations: Listing<InvestigationView> | undefined;
}): ReactNode => {
  const title = t('relations.label.investigations');

  if (investigations === undefined) {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }
  if (investigations.items.length === 0) {
    return <Clear t={t} title={title} message="relations.empty.investigations" />;
  }

  return (
    <Region title={title} description={shownOf(investigations)}>
      <div className="flex flex-col gap-4">
        {investigations.items.map((investigation) => (
          <Inquiry key={investigation.investigationId} t={t} investigation={investigation} />
        ))}
      </div>
    </Region>
  );
};
