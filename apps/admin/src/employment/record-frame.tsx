import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { Translate } from '../shell/locale';

/**
 * The pieces every part of the employee record is built from.
 *
 * **Nothing here is a component the design system already ships.** `Section` gives a labelled
 * region and its heading, `Table` gives the bordered container and the muted header row, `Badge`
 * gives the status tones, `Surface` gives the one raised block, `Grid` gives the responsive
 * columns. What is left in this file is the record's own vocabulary — a fact, a withheld section,
 * a quantity in minutes — and each of those is four lines over a platform primitive.
 *
 * Four rules the record keeps, stated once here rather than repeated in each section.
 *
 * **Absent and empty are different, and the record says which.** A section whose module answered
 * with nothing says there is nothing. A section whose module did not answer says it was withheld.
 * Rendering both as an empty table would tell an administrator that somebody has no disciplinary
 * record when the truth is that they were not allowed to look.
 *
 * **A withheld section is one line, not a panel.** Twelve panels each carrying the same sentence is
 * what a deployment without Platform's authentication adapter looked like before — a screen of
 * repeated apology. The heading stays, so the reader can see the record's shape and which part of
 * it they cannot see, and the explanation is said once at the top of the page.
 *
 * **Each section is one module's answer and nothing else.** No section derives a value, totals a
 * column, infers a status or assembles a name from parts. What is on the screen is what a module
 * returned — including the minutes, which are converted to no other unit because the module chose
 * that one and ships the words for it.
 *
 * **There are no controls.** This portal reads; every change is an API capability the server
 * decides, and a button that did nothing would be worse than the sentence that says so.
 */

export interface SectionProps {
  readonly t: Translate;
}

/** An absent value. A dash rather than an empty cell, which reads as a rendering fault. */
export const DASH = '—';

export const orDash = (value: string | number | undefined): string | number => value ?? DASH;

/**
 * A quantity of minutes, in the words the owning module ships for it.
 *
 * Leave and Attendance both publish whole minutes and both carry a `{minutes}` formatter in both
 * languages, so the unit is the module's own word and the number is the module's own figure. The
 * record converts to no other unit: hours and days are interpretations of a working day, and what a
 * working day is belongs to Attendance's schedule engine rather than to a screen.
 */
export const minutes = (t: Translate, key: string, value: number): string =>
  t(key).replace('{minutes}', String(value));

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * An employment number, a reference, a date or a Latin code sitting inside an Arabic sentence is a
 * left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will reorder
 * the characters around it — which is how `EMP-000417` renders as `417-EMP-000`. `<bdi>` isolates
 * the run so it keeps its own direction and its neighbours keep theirs.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/** A labelled value. `value` is a node so a term renders as the same translated word everywhere. */
export const Fact = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}): ReactNode => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <span className="text-sm text-foreground">{value}</span>
  </div>
);

/** A run of labelled values. Three columns at desk width, one on a phone. */
export const Facts = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <Surface tone="muted" bordered padding={4} radius="lg">
    <Grid cols={{ base: 1, sm: 2, lg: 3 }} gap={4}>
      {children}
    </Grid>
  </Surface>
);

/** A section of the record: the platform's labelled region, and the module's answer inside it. */
export const RecordSection = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode => <Section title={title}>{children}</Section>;

/** The module did not answer: the caller may not read this, or nothing is authenticated. */
export const Withheld = ({ t, title }: SectionProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t('admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The module answered, and there is nothing. Deliberately not the same as the above. */
export const NothingToShow = ({
  t,
  title,
}: SectionProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t('admin.label.empty')}</p>
  </Section>
);

/**
 * A term from one of a module's closed vocabularies, and never colour alone.
 *
 * The word is the status. A screen that distinguished an ended employment from an active one only
 * by a red or a green pill would be unreadable to somebody who cannot tell them apart, and on an
 * employee record that difference is whether somebody works here.
 *
 * The tone is a reading aid on top of the word, and the mapping lives with each caller rather than
 * here: what counts as a warning is the owning module's meaning, not a shared guess.
 */
export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

export const Status = ({
  tone,
  children,
}: {
  /** Explicitly nullable: a lookup that finds no tone means "no emphasis", not a missing prop. */
  readonly tone: Tone | undefined;
  readonly children: ReactNode;
}): ReactNode => <Badge tone={tone ?? 'muted'}>{children}</Badge>;

/** A table, in the design system's own shape: bordered container, muted header, hover rows. */
export const Rows = ({
  headings,
  numeric = [],
  children,
}: {
  readonly headings: readonly string[];
  /** Column indexes whose values are quantities, aligned to the end so digits line up. */
  readonly numeric?: readonly number[];
  readonly children: ReactNode;
}): ReactNode => (
  <Table>
    <THead>
      <TR>
        {headings.map((heading, index) => (
          <TH key={heading} className={numeric.includes(index) ? 'text-end' : undefined}>
            {heading}
          </TH>
        ))}
      </TR>
    </THead>
    <TBody>{children}</TBody>
  </Table>
);

export { TR as Row };

/** An ordinary cell. */
export const Cell = ({
  children,
  numeric = false,
}: {
  readonly children: ReactNode;
  readonly numeric?: boolean;
}): ReactNode => <TD className={numeric ? 'text-end tabular-nums' : undefined}>{children}</TD>;

/**
 * A cell holding an identifier rather than a name.
 *
 * Monospaced and muted, so it reads as a reference somebody can quote in a support call rather than
 * as a value that failed to load. Resolving a unit or a position to its name needs a bounded
 * lookup by identifier that Organization does not publish; inventing one here would be a second
 * answer to a question that module owns.
 */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  <TD className="font-mono text-xs text-muted-foreground">{value}</TD>
);
