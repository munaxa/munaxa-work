import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { Translate } from '../shell/locale';

import { DASH } from './exact';

/**
 * The pieces all three hiring screens are built from — the Employee Record's design language,
 * applied to a third destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and the muted
 * header row, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is
 * hiring's own vocabulary: a term from one of Recruitment's six closed status sets, a section that
 * was refused rather than empty, and a value that must keep its own direction inside translated
 * text.
 *
 * Four rules, stated once.
 *
 * **Refused, empty, withheld and populated are four answers, not two.** The pipeline checks the
 * permission before the handler runs, so a caller without `recruitment.application.read` is refused
 * outright; a caller who holds it but not `recruitment.interview.feedback.read` reads the
 * application and is refused the panel's opinion of the candidate. "Nobody has given feedback" and
 * "you may not see what the panel said" are opposite statements, and on a hiring screen the first
 * one is the dangerous one to make wrongly.
 *
 * **The word is always the status.** A screen that distinguished a rejected application from an
 * offered one only by a red or a green pill would be unreadable to somebody who cannot tell them
 * apart, and on a hiring screen that difference is whether somebody was told no. The tone is a
 * reading aid on top of the word, never instead of it.
 *
 * **Nothing is computed.** No headcount sum, no pipeline percentage, no average score, no days
 * open, no majority and no hiring verdict. Recruitment publishes each figure it holds and refuses
 * to publish the ones it considers policy; a screen that derived one would be inventing the hiring
 * rule the module declined to invent.
 *
 * **There are no controls.** Every movement through the pipeline is a write, and no request from
 * this portal carries a principal, so a "move to shortlisted" button would post unauthenticated and
 * answer 401 — a control that does not do what it appears to.
 */

export interface HiringProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * A requisition number, an identifier, a source code or a date sitting inside an Arabic sentence is
 * a left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will
 * reorder the characters around it — which is how `REQ-000417` renders as `417-REQ-000`. `<bdi>`
 * isolates the run so it keeps its own direction and its neighbours keep theirs.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A term from one of Recruitment's closed status vocabularies, translated, with an optional tone.
 *
 * `tone` is explicitly nullable rather than optional: a lookup that finds no tone means "no
 * emphasis", which is an answer rather than a missing argument.
 */
export const Term = ({
  t,
  group,
  value,
  tone,
}: HiringProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>{t(`recruitment.status.${group}.${value}`)}</Badge>
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
export const HiringSection = ({
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

/** The API refused: the caller may not read this, or nothing is authenticated. */
export const Refused = ({ t, title }: HiringProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t('admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: HiringProps & { readonly title: string; readonly message: string }): ReactNode => (
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
  /** Column indexes whose values are whole numbers, aligned to the end so digits line up. */
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
 * Monospaced and muted, so it reads as a value somebody can quote rather than as one that failed to
 * load, and never shortened: an organizational unit and a position are identifiers this product has
 * no reachable bounded read for, and eight characters of two of them created on the same afternoon
 * are the same eight characters.
 */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  // `whitespace-nowrap` because a full identifier must not be wrapped across four lines in a narrow
  // column — the table scrolls inside its own bounds instead, which is what `Table` is for.
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
 * Two figures rather than one, and never the same figure twice: `items.length` is how much of the
 * answer is on the screen and the total is how much of it there is. A section that printed only the
 * page length would tell a recruiter with four hundred applicants that they have twenty-five.
 *
 * **The whole ratio is one isolated run, not two.** Isolating only the total leaves the page count
 * as a second left-to-right run, and inside an Arabic paragraph the bidirectional algorithm puts
 * the later one first: `5 / 26` renders as `26 / 5`, which reads as a page bigger than its own
 * total. One `<bdi>` around both keeps the order the reader needs in either language.
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
}: HiringProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('recruitment.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);
