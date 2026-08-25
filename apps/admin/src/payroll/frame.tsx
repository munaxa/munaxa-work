import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { Translate } from '../shell/locale';

import { DASH, type Amount } from './exact';

/**
 * The pieces all three payroll screens are built from — the Employee Record's design language,
 * applied to a fourth destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and the muted
 * header row, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is
 * payroll's own vocabulary: a published amount, a term from one of Payroll's closed status sets, a
 * section that was refused rather than empty, and a value that must keep its own direction inside
 * translated text.
 *
 * Four rules, stated once.
 *
 * **Refused, empty, withheld and populated are four answers, not two.** Payroll gates its reads with
 * *four different permissions*: `payroll.read` sees that a run covered 1,400 people, `payroll.read-result`
 * sees what a named person was paid, `payroll.accounting` sees the journal, `payroll.payment` sees the
 * instructions. A caller can hold the first and none of the others, and the module's own comment says
 * why that separation exists — collapsing them "would make every payroll administrator a reader of
 * every salary in the company". The screen that collapsed them back would undo it in presentation.
 *
 * **An amount is rendered, never computed.** No net is derived from a gross, no column is totalled,
 * no currency is converted or inferred. Payroll never totals across currencies; neither does this.
 *
 * **The word is always the status.** A finalized run and a reversed one differ by a word, and the
 * tone is a reading aid on top of it, never instead of it.
 *
 * **There are no controls.** Calculating, approving, finalizing and reversing are writes, and no
 * request from this portal carries a principal. The run record shows which of them the run's *state*
 * permits, as a statement about the run rather than as a control that would answer 401.
 */

export interface PayrollProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * An amount, a period code, a digest, an identifier or a date sitting inside an Arabic sentence is a
 * left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will reorder
 * the characters around it. `<bdi>` isolates the run so it keeps its own direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A published amount: the figure, and its currency beside it as a unit.
 *
 * **One isolated run, not two.** Isolating the figure and leaving the code outside would let Arabic
 * put the currency first for one amount and last for the next; the pair is one quantity and is
 * isolated as one.
 */
export const Money = ({ amount }: { readonly amount: Amount | undefined }): ReactNode =>
  amount === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Isolated>
      <span className="tabular-nums">{amount.figure}</span>
      <span className="ms-1.5 text-xs text-muted-foreground">{amount.currency}</span>
    </Isolated>
  );

/** A term from one of Payroll's closed status vocabularies, translated, with an optional tone. */
export const Term = ({
  t,
  group,
  value,
  tone,
}: PayrollProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>{t(`payroll.${group}.${value}`)}</Badge>
  );

/** A labelled value. */
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

/** A run of labelled values, in the one raised block a screen gets. */
export const Facts = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <Surface tone="muted" bordered padding={4} radius="lg">
    <Grid cols={{ base: 1, sm: 2, lg: 3 }} gap={4}>
      {children}
    </Grid>
  </Surface>
);

/** A titled region. */
export const PayrollSection = ({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}): ReactNode => (
  <Section title={title} description={description}>
    {children}
  </Section>
);

/**
 * The API refused: the caller may not read this, or nothing is authenticated.
 *
 * `reason` names *which* permission was refused where Payroll separates them, so an operator who
 * can see a run's shape but not its figures learns that rather than concluding the run is empty.
 */
export const Refused = ({
  t,
  title,
  reason,
}: PayrollProps & { readonly title: string; readonly reason?: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(reason ?? 'admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: PayrollProps & { readonly title: string; readonly message: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(message)}</p>
  </Section>
);

/** A table, in the design system's own shape. */
export const Rows = ({
  headings,
  numeric = [],
  children,
}: {
  readonly headings: readonly string[];
  /** Column indexes carrying a figure, aligned to the end so digits line up. */
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

export const Cell = ({
  children,
  numeric = false,
}: {
  readonly children: ReactNode;
  readonly numeric?: boolean;
}): ReactNode => <TD className={numeric ? 'text-end tabular-nums' : undefined}>{children}</TD>;

/**
 * A cell holding a reference to something another module owns.
 *
 * Monospaced, muted and never shortened. Payroll holds no name for anybody (ADR-0038), so an
 * employment here is an identifier and the screen says so rather than inventing a lookup.
 */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
    <Isolated>{value}</Isolated>
  </TD>
);

/** A reference inside a `Fact` rather than a table cell. */
export const Reference = ({ value }: { readonly value: string }): ReactNode => (
  <span className="font-mono text-xs text-muted-foreground">
    <Isolated>{value}</Isolated>
  </span>
);

/**
 * The rows on this page beside the total the server counted.
 *
 * One isolated run, not two: isolating only the total leaves the page count as a second
 * left-to-right run, and inside an Arabic paragraph the later run comes first — `5 / 26` renders as
 * `26 / 5`, which reads as a page bigger than its own total.
 */
export const shownOf = (
  listing: { readonly items: readonly unknown[]; readonly total: number } | undefined,
): ReactNode =>
  listing === undefined ? undefined : (
    <Isolated>{`${String(listing.items.length)} / ${String(listing.total)}`}</Isolated>
  );

/** What a screen does not do, said quietly rather than left as an absence. */
export const Boundaries = ({
  t,
  keys,
}: PayrollProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('payroll.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);
