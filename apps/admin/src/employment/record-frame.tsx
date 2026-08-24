import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import type { Translate } from '../shell/locale';

/**
 * The pieces every section of the employee record is built from.
 *
 * Four things stated once here rather than repeated in each section.
 *
 * **Absent and empty are different, and the record says which.** A section whose module answered
 * with nothing shows "nothing to show". A section whose module did not answer — because the caller
 * may not read it, or because nothing is signed in — says it was withheld. Rendering both as an
 * empty table would tell an administrator that somebody has no disciplinary record when the truth
 * is that they were not allowed to look.
 *
 * That is why the three are **three components rather than one with two flags**: a section decides
 * which of them it is and returns, so the branch is taken once at the top instead of threaded
 * through every value below it — and every field inside the third is a value that certainly exists.
 *
 * **Each section is one module's answer and nothing else.** No section derives a value, totals a
 * column, infers a status or assembles a name from parts. What is on the screen is what a module
 * returned.
 *
 * **An identifier is shown as an identifier.** Where a name belongs to a module this screen did not
 * ask, the record shows a shortened identifier and says why. A cached name here would be a second
 * answer that goes stale on the first rename.
 *
 * **There are no controls.** This portal reads; every change is an API capability the server
 * decides, and a button that did nothing would be worse than the sentence that says so.
 */

export interface SectionProps {
  readonly t: Translate;
}

/** A section of the record: a heading and the module's answer. */
export const Section = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{title}</h2>
    {children}
  </Card>
);

/** The module did not answer: the caller may not read this, or nothing is authenticated. */
export const Withheld = ({ t, title }: SectionProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm opacity-70">{t('admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The module answered, and there is nothing. Deliberately not the same as the above. */
export const Empty = ({ t, title }: SectionProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm opacity-70">{t('admin.label.empty')}</p>
  </Section>
);

/** A labelled value. `value` is a node so a term renders as the same translated word everywhere. */
export const Fact = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}): ReactNode => (
  <div className="flex flex-col">
    <span className="text-xs uppercase tracking-wide opacity-60">{label}</span>
    <span className="text-sm">{value}</span>
  </div>
);

/** A run of labelled values, wrapping rather than truncating. */
export const Facts = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
);

/**
 * A table that scrolls inside its own bounds.
 *
 * The wrapper is not decoration: without it a wide row pushes the page sideways, and on a phone
 * that means the navigation and the content both move. Wide content scrolls; the page does not.
 */
export const Rows = ({
  headings,
  children,
}: {
  readonly headings: readonly string[];
  readonly children: ReactNode;
}): ReactNode => (
  <div className="overflow-x-auto">
    <table className="w-full text-start text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide opacity-60">
          {headings.map((heading) => (
            <th key={heading} scope="col" className="py-1 pe-4 text-start font-normal">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

/** One row of a record table. */
export const Row = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <tr className="border-t border-border/40">{children}</tr>
);

/** A cell holding an identifier rather than a name. Monospaced, so it reads as one. */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  <td className="py-1 pe-4 font-mono text-xs">{value}</td>
);

/** An ordinary cell. */
export const Cell = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <td className="py-1 pe-4">{children}</td>
);

/** An absent value, shown as a dash rather than as an empty cell that reads as a rendering fault. */
export const DASH = '—';

export const orDash = (value: string | number | undefined): string | number => value ?? DASH;
