import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { textIn, type Language } from './locale';

/**
 * The pieces every performance section is built from.
 *
 * Four things this workspace does deliberately, stated once here rather than repeated in each file.
 *
 * **It renders what the API returned and computes nothing.** Not a score, not a total, not a
 * weighted contribution. Every figure arrives as an exact integer of hundredths or basis points, or
 * as an exact decimal string; formatting is string surgery in `scoring.ts` and never arithmetic.
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked.
 *
 * **It offers only the actions each state permits** — and the API refuses them independently. See
 * `lifecycle.ts`: a hidden control has never been a security control, and nothing here pretends
 * otherwise.
 *
 * **It states what this product does not do**, rather than leaving an empty table to imply it
 * failed. No notification is delivered, nothing runs on a schedule, no document bytes exist, and no
 * reviewer is anonymous.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

export const instant = (at: string | undefined, language: Language): string =>
  at === undefined
    ? '—'
    : new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', {
        timeZone: 'UTC',
      });

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('performance.notice.empty')}</p>
);

/**
 * A status, translated, and **never colour alone**.
 *
 * The word is the status. A screen that distinguished "completed" from "cancelled" only by a green
 * or a red pill would be unreadable to somebody who cannot tell them apart, and the WCAG rule about
 * colour as the sole carrier of meaning exists for exactly this table.
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
  <span className="rounded px-2 py-0.5 text-xs">
    {t(`performance.vocabulary.${group}.${status}`)}
  </span>
);

export const Figure = ({
  t,
  label,
  value,
}: {
  readonly t: Translate;
  readonly label: string;
  readonly value: number | string;
}): ReactNode => (
  <div className="flex flex-col">
    <dt className="opacity-70">{t(`performance.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
  </div>
);

/**
 * The actions a state permits, and why any are missing.
 *
 * Rendered as text rather than as controls: this Admin portal is read-only, and a button that did
 * nothing would be worse than a list that is honest about being one. The note beneath says the
 * server decides, so nobody reads this as a permission model.
 */
export const Actions = ({
  t,
  actions,
  withheld,
}: {
  readonly t: Translate;
  readonly actions: ReadonlySet<string>;
  readonly withheld: string | undefined;
}): ReactNode => (
  <div className="flex flex-col gap-1 text-xs">
    <span className="opacity-70">{t('performance.label.actions')}</span>
    <span>
      {actions.size === 0
        ? '—'
        : [...actions].map((action) => t(`performance.action.${action}`)).join(' · ')}
    </span>
    {withheld === undefined ? undefined : <span className="opacity-70">{t(withheld)}</span>}
    <span className="opacity-60">{t('performance.notice.actionsAreUsability')}</span>
  </div>
);

/** A table whose header row is a real `<th scope="col">`, so a screen reader can navigate it. */
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
              {t(`performance.label.${header}`)}
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
 * `total` is the server's count, not `items.length`. A screen that displayed the length of what it
 * received would tell an administrator there were fifty goals in a cycle that has four thousand.
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
      <h2 className="text-lg font-medium">{t(`performance.label.${title}`)}</h2>
      {total === undefined ? undefined : (
        <p className="text-xs opacity-70">
          {`${t('performance.label.page')} 1 · ${String(shown ?? 0)} / ${String(total)}`}
        </p>
      )}
    </div>

    {children}
    {note === undefined ? undefined : <p className="text-xs opacity-60">{t(note)}</p>}
  </Card>
);

/** A bilingual value, in the reader's language. */
export const named = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => textIn(text, language);
