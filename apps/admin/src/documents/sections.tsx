import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  AccessEventView,
  DocumentTypeView,
  DocumentVersionView,
  DocumentView,
  DualCalendarView,
  ReconciliationFindingView,
  VerificationView,
} from '@work/documents/contracts';

import { textIn, type Language } from './locale';

/**
 * The document register on screen: categories, the register itself, the two queues, one document's
 * versions and its access trail.
 *
 * Five things this screen does deliberately.
 *
 * **It shows no file and offers no download.** There is no upload control and no download button,
 * because no storage adapter exists in this repository. A screen with a greyed-out download button
 * would imply the capability is one permission away; the notice says the capability is absent.
 *
 * **It shows owner identifiers, not names.** Resolving a person to a human being is People's read,
 * behind People's permission — and this screen has not asked.
 *
 * **It says when an expiry belongs to People.** Where a document evidences an identifier, the date
 * shown came from the person's identifier record and this module stores none of its own. The row
 * says so, because a date whose owner is ambiguous is a date somebody will edit in the wrong place.
 *
 * **It never implies a notice was sent.** Notice thresholds are configuration and nothing fires
 * them; the expiring queue is a screen somebody opens, and the notice under it says exactly that.
 *
 * **It distinguishes withheld from empty.** A caller who may read the register but not the access
 * trail sees a stated boundary rather than a blank table that looks like nobody has ever opened the
 * document.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/**
 * A date in both calendars, exactly as the API rendered them.
 *
 * Both are derived by the module from one stored date, so they cannot disagree. Nothing here
 * converts anything: a screen doing its own Hijri arithmetic would be a second answer to a question
 * the kernel already decided.
 */
export const dual = (date: DualCalendarView | undefined): string =>
  date === undefined ? '—' : `${date.gregorian} · ${date.hijri}`;

export const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('documents.notice.empty')}</p>
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
  <span className="rounded px-2 py-0.5 text-xs">{t(`documents.${group}.${value}`)}</span>
);

export const TypesSection = ({
  t,
  language,
  types,
}: SectionProps & { readonly types: readonly DocumentTypeView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.categories')}</h2>

    {types.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('documents.label.code')}</th>
            <th className="text-start">{t('documents.label.type')}</th>
            <th className="text-start">{t('documents.label.confidentiality')}</th>
            <th className="text-start">{t('documents.label.requiresVerification')}</th>
            <th className="text-start">{t('documents.label.noticeDays')}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type.documentTypeId}>
              {/* A tenant's own code, rendered as stored and never translated. */}
              <td>{type.code}</td>
              <td>{textIn(type.name, language)}</td>
              <td>
                <Term t={t} group="confidentiality" value={type.confidentiality} />
              </td>
              <td>{type.requiresVerification ? '✓' : '—'}</td>
              <td>{type.noticeDays.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    {/* Configuration, and nothing that fires. Said here rather than left to be assumed. */}
    <p className="text-sm opacity-70">{t('documents.notice.noNotices')}</p>
  </Card>
);

export const RegisterSection = ({
  t,
  language,
  documents,
  total,
  unavailable,
}: SectionProps & {
  readonly documents: readonly DocumentView[];
  readonly total: number;
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.register')}</h2>

    {unavailable ? (
      <p className="text-sm opacity-70">{t('documents.notice.error')}</p>
    ) : (
      <DocumentTable t={t} language={language} documents={documents} />
    )}

    {/* The count agrees with the rows: a caller without read-sensitive is never told how many
        confidential documents were withheld, because the count is itself a disclosure. */}
    <p className="text-sm opacity-70">
      {total} · {t('documents.notice.sensitiveWithheld')}
    </p>
    <p className="text-sm opacity-70">{t('documents.notice.noStorage')}</p>
  </Card>
);

export const DocumentTable = ({
  t,
  language,
  documents,
}: SectionProps & { readonly documents: readonly DocumentView[] }): ReactNode =>
  documents.length === 0 ? (
    <Empty t={t} />
  ) : (
    <table className="w-full text-start text-sm">
      <thead className="opacity-70">
        <tr>
          <th className="text-start">{t('documents.label.document')}</th>
          <th className="text-start">{t('documents.label.owner')}</th>
          <th className="text-start">{t('documents.label.status')}</th>
          <th className="text-start">{t('documents.label.verificationState')}</th>
          <th className="text-start">{t('documents.label.expiryDate')}</th>
          <th className="text-start">{t('documents.label.expires')}</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.documentId}>
            <td>{textIn(document.title, language)}</td>
            {/* An identifier, not a name: resolving one is People's read, and this screen has not
                asked. */}
            <td>{short(document.ownerId)}</td>
            <td>
              <Term t={t} group="status" value={document.status} />
            </td>
            <td>
              <Term t={t} group="verification" value={document.verificationState} />
            </td>
            <td>
              {dual(document.expiryDate)}
              {/* Where People owns the expiry, the row says so — a date whose owner is ambiguous
                  is a date somebody edits in the wrong place. */}
              {document.expiryOwnedByPeople ? ' ⟵ ' : ''}
              {document.expiryOwnedByPeople ? t('documents.notice.expiryFromPeople') : ''}
            </td>
            <td>
              <Term t={t} group="expiry" value={document.expiryState} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

export const ExpiringSection = ({
  t,
  language,
  expiring,
}: SectionProps & { readonly expiring: readonly DocumentView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.expiring')}</h2>
    <DocumentTable t={t} language={language} documents={expiring} />
    <p className="text-sm opacity-70">{t('documents.notice.noNotices')}</p>
  </Card>
);

export const VerificationQueueSection = ({
  t,
  language,
  awaiting,
}: SectionProps & { readonly awaiting: readonly DocumentView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.reverify')}</h2>
    <DocumentTable t={t} language={language} documents={awaiting} />
  </Card>
);

export const VersionsSection = ({
  t,
  language,
  versions,
  verifications,
}: SectionProps & {
  readonly versions: readonly DocumentVersionView[];
  readonly verifications: readonly VerificationView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.versions')}</h2>

    {versions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('documents.label.version')}</th>
            <th className="text-start">{t('documents.label.fileName')}</th>
            <th className="text-start">{t('documents.label.declaredMediaType')}</th>
            <th className="text-start">{t('documents.label.size')}</th>
            <th className="text-start">{t('documents.label.contentHash')}</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.documentVersionId}>
              <td>{version.versionNumber}</td>
              <td>{version.originalFileName}</td>
              {/* What a client claimed. Nothing has inspected the content to confirm it, and the
                  screen does not imply otherwise. */}
              <td>{version.declaredMediaType}</td>
              {/* Rendered as the string the API sent: a file can exceed what a double holds. */}
              <td>{version.sizeInBytes}</td>
              <td className="font-mono">{short(version.contentHash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <h3 className="text-sm font-medium">{t('documents.label.verify')}</h3>
    {verifications.length === 0 ? (
      <Empty t={t} />
    ) : (
      <ul className="text-sm">
        {verifications.map((decision) => (
          <li key={decision.verificationId}>
            <Term t={t} group="verification" value={decision.decision} /> · {decision.decidedBy} ·{' '}
            {instant(decision.decidedAt, language)}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const AuditSection = ({
  t,
  language,
  trail,
  withheld,
}: SectionProps & {
  readonly trail: readonly AccessEventView[];
  readonly withheld: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.audit')}</h2>

    {withheld ? (
      // A stated boundary rather than a blank table that would look like nobody has ever opened
      // this document.
      <p className="text-sm opacity-70">{t('documents.notice.error')}</p>
    ) : trail.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('documents.label.action')}</th>
            <th className="text-start">{t('documents.label.actor')}</th>
            <th className="text-start">{t('documents.label.outcome')}</th>
            <th className="text-start">{t('documents.label.correlation')}</th>
          </tr>
        </thead>
        <tbody>
          {trail.map((event) => (
            <tr key={event.accessEventId}>
              <td>
                <Term t={t} group="access" value={event.action} />
              </td>
              <td>{event.actor}</td>
              <td>{event.outcome}</td>
              <td className="font-mono">{short(event.correlationId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-sm opacity-70">{instant(trail[0]?.occurredAt, language)}</p>
  </Card>
);

export const FindingsSection = ({
  t,
  findings,
}: SectionProps & { readonly findings: readonly ReconciliationFindingView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('documents.label.reconciliation')}</h2>

    {findings.length === 0 ? (
      <Empty t={t} />
    ) : (
      <ul className="text-sm">
        {findings.map((finding) => (
          <li key={`${finding.finding}:${finding.documentId}:${finding.documentVersionId ?? ''}`}>
            {t(`documents.finding.${finding.finding}`)} · {short(finding.documentId)}
          </li>
        ))}
      </ul>
    )}

    <p className="text-sm opacity-70">{t('documents.notice.reconciliationReports')}</p>
  </Card>
);
