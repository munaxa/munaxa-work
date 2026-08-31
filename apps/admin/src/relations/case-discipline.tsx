import type { ReactNode } from 'react';
import type {
  ApplicableActionView,
  DisciplinaryActionView,
  EscalationContextView,
} from '@work/relations/contracts';

import type { Language } from './locale';
import {
  Clear,
  Fact,
  Facts,
  Figure,
  Isolated,
  Reference,
  Refused,
  Region,
  Term,
  Wrote,
  type RelationsProps,
} from './frame';
import type { Outcome } from './api';

/**
 * The disciplinary half of a case: how many times before, what the tenant's ladder suggests, and
 * what a named human actually issued.
 *
 * **Three sections, three different kinds of statement.** The repeat position is arithmetic the
 * module derived and stored nowhere; the suggested action is what configuration says and decides
 * nothing; the issued action is a decision somebody took, frozen as it was taken. The screen keeps
 * them apart because a reader who conflates "the policy suggests a warning" with "a warning was
 * issued" has been misled about a person.
 *
 * **An absent suggestion is a real answer.** Where the tenant configured no rule for this
 * occurrence, the module returns no action and this screen says the policy is silent — nothing is
 * invented to fill the gap (D-5.2-20).
 *
 * **Nothing issued reads as nothing issued.** The module answers `not_found` for a case no action
 * was issued on, deliberately the same answer another tenant's case gives. By the time these
 * sections render the case itself has resolved, so that `not_found` is this case's empty state and
 * renders as one — never as a withheld section.
 */

interface SectionProps extends RelationsProps {
  readonly language: Language;
}

const caseHref = (violationId: string, language: Language): string =>
  `/relations/cases/${violationId}?lang=${language}`;

/**
 * Where this violation sits in its own repeat window, and which records put it there.
 *
 * Every field is the module's: the window applied, the date it was measured back from, and the
 * violations inside it. Publishing the window with the count is deliberate — it makes the answer
 * checkable by the person whose record it describes. Each contributing violation links to its own
 * case, because "which prior matters produced this ordinal" is exactly the question a reader of
 * this section is asking.
 */
export const RepeatSection = ({
  t,
  language,
  escalation,
}: SectionProps & { readonly escalation: EscalationContextView | undefined }): ReactNode => {
  const title = t('relations.label.escalationContext');

  if (escalation === undefined) {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }

  return (
    <Region title={title}>
      <Facts>
        <Fact
          label={t('relations.label.occurrences')}
          value={<Figure>{escalation.occurrences}</Figure>}
        />
        <Fact
          label={t('relations.label.repeatWindowDays')}
          value={<Figure>{escalation.windowDays}</Figure>}
        />
        <Fact
          label={t('relations.label.windowFrom')}
          value={<Isolated>{escalation.windowFrom}</Isolated>}
        />
        <Fact label={t('relations.label.asAt')} value={<Isolated>{escalation.asAt}</Isolated>} />
      </Facts>

      <ul className="flex flex-col gap-1">
        {escalation.violationIds.map((violationId) => (
          <li key={violationId} className="font-mono text-xs">
            <a className="underline underline-offset-4" href={caseHref(violationId, language)}>
              <Isolated>{violationId}</Isolated>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('relations.notice.windowIsConfiguration')}</p>
    </Region>
  );
};

/**
 * What the tenant's ladder prescribes — decision support, rendered as such.
 *
 * The module's own sentence about silence renders where no rule matched, and the notice under the
 * section says in the customer's words that the ladder suggests and never issues.
 */
export const ApplicableSection = ({
  t,
  applicable,
}: RelationsProps & { readonly applicable: ApplicableActionView | undefined }): ReactNode => {
  const title = t('relations.label.applicableAction');

  if (applicable === undefined) {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }

  return (
    <Region title={title}>
      {applicable.action === undefined ? (
        <p className="text-sm text-muted-foreground">{t('relations.notice.noRuleNoAction')}</p>
      ) : (
        <Facts>
          <Fact
            label={t('relations.label.action')}
            value={<Term t={t} group="actionType" value={applicable.action} />}
          />
          <Fact
            label={t('relations.label.occurrence')}
            value={<Figure>{applicable.occurrence}</Figure>}
          />
          <Fact
            label={t('relations.label.minOccurrence')}
            value={
              applicable.minOccurrence === undefined ? (
                '—'
              ) : (
                <Figure>{applicable.minOccurrence}</Figure>
              )
            }
          />
        </Facts>
      )}
      <p className="text-xs text-muted-foreground">{t('relations.notice.ladderPrescribesOnly')}</p>
    </Region>
  );
};

const IssuedFacts = ({
  t,
  action,
}: RelationsProps & { readonly action: DisciplinaryActionView }): ReactNode => (
  <>
    <Facts>
      <Fact
        label={t('relations.label.action')}
        value={<Term t={t} group="actionType" value={action.action} tone="warning" />}
      />
      <Fact label={t('relations.label.issuedOn')} value={<Isolated>{action.issuedOn}</Isolated>} />
      <Fact label={t('relations.label.issuedBy')} value={<Reference value={action.issuedBy} />} />
      <Fact
        label={t('relations.label.occurrenceAtIssue')}
        value={<Figure>{action.occurrenceAtIssue}</Figure>}
      />
      <Fact
        label={t('relations.label.prescribedByRule')}
        value={
          <Term t={t} group="prescribedByRule" value={action.prescribedByRule ? 'yes' : 'no'} />
        }
      />
    </Facts>

    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('relations.label.reason')}
      </span>
      <p className="text-sm text-foreground">
        <Wrote>{action.reason}</Wrote>
      </p>
    </div>
  </>
);

/**
 * The action a named human issued, if one was — frozen as it was taken.
 *
 * `action` and `occurrenceAtIssue` are what the decision meant at issue, not what today's ladder
 * says; the module keeps both questions askable and this screen shows the frozen one. The notice
 * under the section is the module's own: recording an action carries nothing out.
 */
export const IssuedActionSection = ({
  t,
  action,
}: RelationsProps & { readonly action: Outcome<DisciplinaryActionView> }): ReactNode => {
  const title = t('relations.label.disciplinaryAction');

  if (action.kind === 'refused') {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }
  if (action.kind === 'missing') {
    return <Clear t={t} title={title} message="relations.empty.action" />;
  }

  return (
    <Region title={title}>
      <IssuedFacts t={t} action={action.value} />
      <p className="text-xs text-muted-foreground">{t('relations.notice.actionNotExecuted')}</p>
    </Region>
  );
};
