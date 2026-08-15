import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { textIn, type Language } from './locale';

/**
 * The pieces every career section is built from.
 *
 * Six things this workspace does deliberately, stated once here rather than repeated in each file.
 *
 * **It renders what the API returned and computes nothing a domain owns.** `inForce`, `reviewDue`,
 * `overdue` and `standing` are the server's answers, computed against a day it names and echoes
 * back. A screen that recomputed them would be a second, weaker answer — and it would disagree on
 * the day a recommendation lapses, because the browser's clock is not the day the caller asked
 * about.
 *
 * **It shows employment, position and unit identifiers, not names.** Resolving an employment to a
 * human being is People's read behind People's permission, and a position's title is
 * Organization's — this screen has asked for neither.
 *
 * **A position identifier is a reference and never a judgement.** A position appearing on a
 * succession plan is one the tenant already named. Nothing here says it is *critical*: Career has no
 * criticality filter and no way to ask for one, so enumerating critical positions stays out of reach
 * (D-4) and no label on this screen implies otherwise.
 *
 * **It offers no controls at all.** This Admin portal is read-only — no form, no dialog, no state.
 * Where a state permits a transition, the screen names the transition as an *API* capability and
 * says the server decides, which is the shape every Admin screen in this product has.
 *
 * **It states what this product does not do**, rather than leaving an empty table to imply it
 * failed. Nothing is scheduled, no readiness is computed, no nine-box band is read, no notification
 * is delivered, no document exists, and nobody can read their own record.
 *
 * **It converts no exact value.** Civil dates and ordinals go through the named identity functions
 * in `exact.ts`, which exist so that a later reader reaching for `Date` or `toLocaleString` meets
 * the reason first.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/** A boolean the server stated, as a word. Never a bare tick that reads the same either way. */
export const yesNo = (value: boolean, t: Translate): string =>
  t(value ? 'career.vocabulary.answer.yes' : 'career.vocabulary.answer.no');

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('career.notice.empty')}</p>
);

/**
 * A status, translated, and **never colour alone**.
 *
 * The word is the status. A screen that distinguished a withdrawn nomination from a confirmed one
 * only by a red or a green pill would be unreadable to somebody who cannot tell them apart — and on
 * a succession screen that difference is whether an organization has committed to a name.
 */
export const Status = ({
  t,
  group,
  status,
}: {
  readonly t: Translate;
  readonly group: string;
  readonly status: string;
}): ReactNode => (
  <span className="rounded px-2 py-0.5 text-xs">{t(`career.vocabulary.${group}.${status}`)}</span>
);

/**
 * A labelled figure.
 *
 * `value` is a `ReactNode` rather than a string so a status can be rendered as the same translated
 * pill it is everywhere else on the page. A figure that printed a raw `nominated` beside tables that
 * translate it would be the one place an Arabic reader met an English vocabulary word.
 */
export const Figure = ({
  t,
  label,
  value,
}: {
  readonly t: Translate;
  readonly label: string;
  readonly value: ReactNode;
}): ReactNode => (
  <div className="flex flex-col">
    <dt className="opacity-70">{t(`career.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
  </div>
);

/**
 * A table whose header row is a real `<th scope="col">`, so a screen reader can navigate it.
 */
export const Table = ({
  headers,
  t,
  children,
}: {
  readonly headers: readonly string[];
  readonly t: Translate;
  readonly children: ReactNode;
}): ReactNode => (
  <div className="overflow-x-auto">
    <table className="w-full text-start text-sm">
      <thead className="opacity-70">
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col" className="text-start">
              {t(`career.label.${header}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

/**
 * A section with its heading, its empty state and — where the API bounded a listing — its page
 * position.
 *
 * `total` is the **server's count**, not `items.length`. A screen that displayed the length of what
 * it received would tell an administrator that fifty people are on succession benches in an
 * organization where four thousand are, and both numbers are shown separately so neither can be
 * mistaken for the other.
 */
export const Section = ({
  t,
  title,
  total,
  shown,
  note,
  children,
}: {
  readonly t: Translate;
  readonly title: string;
  readonly total?: number;
  readonly shown?: number;
  readonly note?: string;
  readonly children: ReactNode;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-medium">{t(`career.label.${title}`)}</h2>
      {total === undefined ? undefined : (
        <p className="text-xs opacity-70">
          {`${t('career.label.page')} 1 · ${String(shown ?? 0)} / ${String(total)}`}
        </p>
      )}
    </div>

    {children}
    {note === undefined ? undefined : <p className="text-xs opacity-60">{t(note)}</p>}
  </Card>
);

/**
 * The day a derived answer was computed against, exactly as the API reported it.
 *
 * Shown wherever a section carries `inForce`, `reviewDue`, `overdue` or `standing`, because each of
 * those is a function of a day and means nothing without it. Never `new Date()`: the server decided,
 * and a screen that stamped its own clock would caption an answer with a day the answer was not
 * computed for.
 */
export const AsOf = ({
  t,
  asOf,
}: {
  readonly t: Translate;
  readonly asOf: string | undefined;
}): ReactNode =>
  asOf === undefined ? undefined : (
    <p className="text-xs opacity-70">
      {`${t('career.label.asOf')} ${asOf} · ${t('career.notice.derivedAtRead')}`}
    </p>
  );

/**
 * The transitions a state permits, named as API capabilities rather than offered as controls.
 *
 * Rendered as text, because this portal has no mutation architecture: no form, no dialog and no
 * client state. A button that did nothing would be worse than a list that is honest about being one,
 * and a button that posted would be a second UI architecture introduced for one module.
 *
 * The note beneath says the server decides, so nobody reads this as a permission model — confirming
 * a successor and nominating one stand on separate permissions, and this screen holds neither.
 */
export const Actions = ({
  t,
  actions,
}: {
  readonly t: Translate;
  readonly actions: readonly string[];
}): ReactNode => (
  <div className="flex flex-col gap-1 text-xs">
    <span className="opacity-70">{t('career.label.actions')}</span>
    <span>
      {actions.length === 0
        ? '—'
        : actions.map((action) => t(`career.vocabulary.action.${action}`)).join(' · ')}
    </span>
    <span className="opacity-60">{t('career.notice.actionsAreApi')}</span>
  </div>
);

/** A bilingual value, in the reader's language. */
export const named = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => textIn(text, language);
