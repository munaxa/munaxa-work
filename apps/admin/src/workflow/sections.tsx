import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { textIn, type Language } from './locale';

/**
 * The pieces every approvals section is built from.
 *
 * Six things this workspace does deliberately, stated once here rather than repeated in each file.
 *
 * **It renders what the API returned and computes nothing.** A status is the server's, a total is
 * the server's count over its own predicate, and a timeline is in the order the server sorted it.
 * There is nothing here to derive: Workflow publishes no age, no due date, no elapsed time and no
 * tally, so a screen that produced one would be inventing it.
 *
 * **It shows memberships and subjects by identifier, not by name.** Resolving a membership to a
 * person is Identity's read behind Identity's permission, and resolving a subject is the owning
 * module's — this screen has asked for neither, and it never says "manager", because Workflow does
 * not know what one is.
 *
 * **A configured approver is not the reader.** The membership on a step is the person the tenant
 * configured to be asked. Nothing on this screen presents it as the viewer, and nothing infers a
 * delegation by comparing it to anybody.
 *
 * **It offers no controls at all.** This Admin portal is read-only — no form, no button, no dialog,
 * no state. Raising, deciding, cancelling, publishing and retiring are named as *API* capabilities
 * and the server decides each one, which is the shape every Admin screen in this product has. A
 * button that did nothing would be worse than a sentence that is honest about being one.
 *
 * **It states what this product does not do**, rather than leaving an empty table to imply it
 * failed. Nothing escalates, nothing expires, nothing is scheduled, nothing is delivered and nothing
 * is measured.
 *
 * **It converts no exact value.** Instants and whole numbers go through the named functions in
 * `exact.ts`, which exist so that a later reader reaching for `Date.now()` or `toLocaleString` meets
 * the reason first.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('workflow.notice.empty')}</p>
);

/**
 * A term from one of this module's closed vocabularies, translated — and **never colour alone**.
 *
 * The word is the status. A screen that distinguished a rejected approval from an approved one only
 * by a red or a green pill would be unreadable to somebody who cannot tell them apart, and on an
 * approvals screen that difference is whether an organization committed to something.
 */
export const Term = ({
  t,
  group,
  value,
}: {
  readonly t: Translate;
  readonly group: string;
  readonly value: string | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>—</span>
  ) : (
    <span className="rounded px-2 py-0.5 text-xs">
      {t(`workflow.vocabulary.${group}.${value}`)}
    </span>
  );

/**
 * A labelled figure.
 *
 * `value` is a `ReactNode` rather than a string so a status can be rendered as the same translated
 * term it is everywhere else on the page. A figure that printed a raw `running` beside tables that
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
    <dt className="opacity-70">{t(`workflow.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
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
              {t(`workflow.label.${header}`)}
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
 * it received would tell an administrator that fifty approvals are waiting in an organization where
 * four thousand are, and both numbers are shown separately so neither can be mistaken for the other.
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
      <h2 className="text-lg font-medium">{t(`workflow.label.${title}`)}</h2>
      {total === undefined ? undefined : (
        <p className="text-xs opacity-70">
          {`${t('workflow.label.page')} 1 · ${String(shown ?? 0)} / ${String(total)}`}
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
