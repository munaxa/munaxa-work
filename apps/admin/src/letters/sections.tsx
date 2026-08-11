import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  ApprovalDecisionView,
  DualCalendarView,
  IssuedLetterDetailView,
  IssuedLetterView,
  LetterRequestView,
  LetterTemplateVersionView,
  LetterTemplateView,
  LettersReconciliationFindingView,
} from '@work/letters/contracts';

import { textIn, type Language } from './locale';

/**
 * The letter register on screen: templates, versions, requests, approvals, issued letters and what
 * one of them said.
 *
 * Four things this screen does deliberately.
 *
 * **It shows no download and no preview.** An issued letter has content and no artefact, because no
 * renderer exists in this repository. The body is shown as text; a greyed-out "download PDF" button
 * would imply the capability is one permission away, and the notice says it is absent.
 *
 * **It says a version is frozen, and why.** Once a version has issued a letter it cannot be edited,
 * and the row says so — an administrator who edits a published template expecting the change to
 * apply retroactively has misunderstood what a letter register is for.
 *
 * **It never claims a signature.** A letter may record that one is required; nothing here says one
 * happened, because no signature provider exists.
 *
 * **It renders the frozen values as stored.** What a letter said was fixed when it was issued, and a
 * screen that re-resolved anything would disagree with the document somebody is holding.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/** Both calendars, derived by the module from one stored date so they cannot disagree. */
export const dual = (date: DualCalendarView | undefined): string =>
  date === undefined ? '—' : `${date.gregorian} · ${date.hijri}`;

export const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('letters.notice.empty')}</p>
);

/** A closed vocabulary of this module's own, so it is this product's to translate. */
export const Term = ({
  t,
  group,
  value,
}: {
  readonly t: Translate;
  readonly group: string;
  readonly value: string;
}): ReactNode => (
  <span className="rounded px-2 py-0.5 text-xs">{t(`letters.${group}.${value}`)}</span>
);

export const TemplatesSection = ({
  t,
  language,
  templates,
  versions,
}: SectionProps & {
  readonly templates: readonly LetterTemplateView[];
  readonly versions: readonly LetterTemplateVersionView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('letters.label.templates')}</h2>

    {templates.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('letters.label.code')}</th>
            <th className="text-start">{t('letters.label.template')}</th>
            <th className="text-start">{t('letters.label.category')}</th>
            <th className="text-start">{t('letters.label.requiresApproval')}</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.letterTemplateId}>
              {/* A tenant's own code and category, rendered as stored and never translated. */}
              <td>{template.code}</td>
              <td>{textIn(template.name, language)}</td>
              <td>{template.category}</td>
              <td>{template.requiresApproval ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <h3 className="text-sm font-medium">{t('letters.label.versions')}</h3>
    {versions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <ul className="text-sm">
        {versions.map((version) => (
          <li key={version.letterTemplateVersionId}>
            {version.versionNumber} · <Term t={t} group="templateStatus" value={version.status} /> ·{' '}
            {version.variables.join(', ') || '—'}
            {/* Frozen by issuance, not by publication — and the row says which. */}
            {version.editable ? '' : ` · ${t('letters.notice.versionFrozen')}`}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const RequestsSection = ({
  t,
  language,
  requests,
  decisions,
  unavailable,
}: SectionProps & {
  readonly requests: readonly LetterRequestView[];
  readonly decisions: readonly ApprovalDecisionView[];
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('letters.label.requests')}</h2>

    {unavailable ? (
      <p className="text-sm opacity-70">{t('letters.notice.error')}</p>
    ) : requests.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('letters.label.requestedBy')}</th>
            <th className="text-start">{t('letters.label.locale')}</th>
            <th className="text-start">{t('letters.label.status')}</th>
            <th className="text-start">{t('letters.label.approvals')}</th>
            <th className="text-start">{t('letters.label.requestedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.letterRequestId}>
              <td>{request.requestedBy}</td>
              <td>{request.locale}</td>
              <td>
                <Term t={t} group="status" value={request.status} />
              </td>
              <td>
                {/* Derived from the whole chain, because a reversal does not erase what it
                    reverses. */}
                <Term t={t} group="approval" value={request.approvalState} />
              </td>
              <td>{instant(request.requestedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <ApprovalChain t={t} language={language} decisions={decisions} />
  </Card>
);

/**
 * The chain, as the history it is.
 *
 * Every decision is listed, including the ones a reversal set aside: a reversal does not erase what
 * it reverses, and a screen that showed only the standing decision would hide the fact that
 * somebody changed their mind.
 */
const ApprovalChain = ({
  t,
  language,
  decisions,
}: SectionProps & { readonly decisions: readonly ApprovalDecisionView[] }): ReactNode => (
  <>
    <h3 className="text-sm font-medium">{t('letters.label.approvals')}</h3>
    {decisions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <ul className="text-sm">
        {decisions.map((decision) => (
          <li key={decision.approvalDecisionId}>
            {decision.sequence} · <Term t={t} group="approval" value={decision.decision} /> ·{' '}
            {decision.decidedBy} · {instant(decision.decidedAt, language)}
          </li>
        ))}
      </ul>
    )}
  </>
);

export const IssuedSection = ({
  t,
  issued,
}: SectionProps & { readonly issued: readonly IssuedLetterView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('letters.label.generated')}</h2>

    {issued.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('letters.label.reference')}</th>
            <th className="text-start">{t('letters.label.issuedAt')}</th>
            <th className="text-start">{t('letters.label.issuedBy')}</th>
            <th className="text-start">{t('letters.label.signature')}</th>
            <th className="text-start">{t('letters.label.superseded')}</th>
          </tr>
        </thead>
        <tbody>
          {issued.map((letter) => (
            <tr key={letter.issuedLetterId}>
              <td>{letter.referenceNumber}</td>
              <td>{dual(letter.issuedAt)}</td>
              <td>{letter.issuedBy}</td>
              <td>
                {/* Never `signed`: no provider exists, so nothing may say one occurred. */}
                <Term t={t} group="signature" value={letter.signatureState} />
              </td>
              <td>{short(letter.supersededById)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <p className="text-sm opacity-70">{t('letters.notice.noRendering')}</p>
    <p className="text-sm opacity-70">{t('letters.notice.noSignature')}</p>
    <p className="text-sm opacity-70">{t('letters.notice.issuedIsFinal')}</p>
  </Card>
);

export const LetterContentSection = ({
  t,
  detail,
  withheld,
}: SectionProps & {
  readonly detail: IssuedLetterDetailView | undefined;
  readonly withheld: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('letters.label.body')}</h2>

    {withheld || detail === undefined ? (
      // A stated boundary: what a letter said may include pay, and a caller may see the register
      // without seeing the figures.
      <p className="text-sm opacity-70">{t('letters.notice.salaryGated')}</p>
    ) : (
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {Object.entries(detail.substitutedValues).map(([name, value]) => (
          <div key={name} className="flex flex-col">
            <dt className="opacity-70">{name}</dt>
            {/* Exactly as frozen. Nothing is re-resolved, or the screen would disagree with the
                document somebody is holding. */}
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    )}

    <p className="text-sm opacity-70">{t('letters.notice.frozen')}</p>
  </Card>
);

export const FindingsSection = ({
  t,
  findings,
}: SectionProps & {
  readonly findings: readonly LettersReconciliationFindingView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('letters.label.reconciliation')}</h2>

    {findings.length === 0 ? (
      <Empty t={t} />
    ) : (
      <ul className="text-sm">
        {findings.map((finding) => (
          <li key={`${finding.finding}:${finding.letterRequestId}`}>
            {t(`letters.finding.${finding.finding}`)} · {short(finding.letterRequestId)}
          </li>
        ))}
      </ul>
    )}
  </Card>
);
