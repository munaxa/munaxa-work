import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import { DASH } from './exact';
import type { Translate } from './locale';

/**
 * The pieces every performance screen is built from — the design language the six completed slices
 * established, applied to a seventh destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and its own
 * scroll behaviour, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is
 * Performance's own vocabulary: a term from one of its closed status sets, a score that must keep
 * its own direction inside translated text, and a section that was refused rather than empty.
 *
 * Four rules, stated once.
 *
 * **The domain's number is rendered, never re-derived.** The engine decided what a review is worth
 * against a template, a weighting and a rating scale this screen cannot see. Nothing here counts
 * rows to produce a figure, and nothing here substitutes one published field for another when the
 * one asked for is absent — a review with no final score shows no final score, not its calculated
 * one under a heading that says final.
 *
 * **Refused, empty and populated are three answers.** Performance separates six read permissions:
 * `configure.read`, `cycle.read`, `goal.read-team`, `review.read-team`, `talent.read`, `calibrate`,
 * `feedback.read-team` and `reconcile` each refuse independently, so a caller may see the cycles and
 * not the matrix. A screen that rendered a refused section as an empty one would undo that
 * separation in presentation.
 *
 * **Calibration sits beside the calculated score and never over it.** A trigger in the database
 * refuses an update that would change the original, so a screen with a single "score" field would
 * misrepresent what the panel did — to the person whose rating it is, most of all.
 *
 * **There are no controls.** Opening a cycle, assessing, scoring, calibrating, completing and
 * archiving are writes, and no request from this portal carries a principal, so a button here would
 * post unauthenticated and answer 401.
 */

export interface PerformanceProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * An identifier, a civil date, an instant or a code sitting inside an Arabic sentence is a
 * left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will reorder
 * the characters around it. `<bdi>` isolates the run so it keeps its own direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A score or a percentage, isolated **and forced left to right**.
 *
 * `<bdi>` alone is not enough. A decimal point and a percent sign are *neutral* characters, so
 * inside a right-to-left paragraph they take the paragraph's direction: `3.70` renders as `70.3`
 * and `60.00%` as `%60.00`. The Leave slice found this on a signed balance and the Attendance slice
 * on a negative duration; a rating carries the same risk without needing a sign, because the
 * decimal separator is neutral on its own.
 *
 * Every score and every weight goes through here, not only the ones that look at risk: a column
 * whose digit order depended on the value would be a column nobody could scan.
 */
export const Figure = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi dir="ltr">{children}</bdi>
);

/**
 * Free text somebody wrote, isolated so its own language decides its direction.
 *
 * A goal title, an assessment comment, a calibration reason and a feedback body are written by
 * people, in whichever language they chose, and they are the values on these screens whose
 * direction is not the page's. An English sentence rendered bare inside an Arabic table has its
 * trailing full stop moved to the front, because the punctuation is neutral and takes the
 * paragraph's direction. `<bdi>` infers the run's own direction from its first strong character.
 */
export const Wrote = ({ children }: { readonly children: ReactNode }): ReactNode =>
  children === undefined || children === '' ? <span>{DASH}</span> : <bdi>{children}</bdi>;

/**
 * A cell holding free text, given room to be a sentence.
 *
 * Without a minimum width a feedback body wraps to three words a line and the row grows to six,
 * which turns a table of four entries into a page. The table scrolls inside its own container, so
 * the width costs the page nothing.
 */
export const Sentence = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="min-w-64">
    <Wrote>{children}</Wrote>
  </TD>
);

/** A term from one of Performance's closed status vocabularies, translated, with an optional tone. */
export const Term = ({
  t,
  group,
  value,
  tone,
}: PerformanceProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>
      <span className="whitespace-nowrap">{t(`performance.vocabulary.${group}.${value}`)}</span>
    </Badge>
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
export const PerformanceSection = ({
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
 * `reason` names *which* permission was refused where Performance separates them, so somebody who
 * can read the cycles but not the talent matrix learns that rather than concluding nobody was
 * placed.
 */
export const Refused = ({
  t,
  title,
  reason,
}: PerformanceProps & { readonly title: string; readonly reason?: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(reason ?? 'admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: PerformanceProps & { readonly title: string; readonly message: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(message)}</p>
  </Section>
);

/**
 * A table, in the design system's own shape.
 *
 * `Table` brings its own `overflow-x-auto` container, and that container is the mobile answer. A
 * review row carries two employment identifiers in full, a status, two scores and an instant, and
 * at 390 px those either scroll inside the table or squash the page into an unreadable column. The
 * page never scrolls sideways; the table does.
 */
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
}): ReactNode => (
  <TD className={numeric ? 'whitespace-nowrap text-end tabular-nums' : undefined}>{children}</TD>
);

/**
 * A cell holding a civil date or an instant.
 *
 * `whitespace-nowrap` because `2026-08-24` broken across two lines as `2026-08-` and `24` is not a
 * date any more — which is what the screen this replaced did to every date on it once the eight
 * columns of the goals table outgrew the width.
 */
export const When = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="whitespace-nowrap">{children}</TD>
);

/**
 * A cell holding a reference to something another module owns.
 *
 * Monospaced, muted and **never shortened**. Performance holds no name for anybody, so an
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
 * A cell that opens one record, with the identifier kept beneath the link.
 *
 * The identifier stays in full and stays visible: the link is how the row is opened, not what the
 * row is. `next/link` is rejected by this repository's naming-convention lint, so every link in the
 * admin portal is a plain anchor.
 */
export const Opens = ({
  href,
  label,
  value,
}: {
  readonly href: string;
  readonly label: string;
  readonly value: string;
}): ReactNode => (
  <TD className="whitespace-nowrap">
    <a className="block text-sm underline underline-offset-4" href={href}>
      <Wrote>{label}</Wrote>
    </a>
    <span className="block font-mono text-xs text-muted-foreground">
      <Isolated>{value}</Isolated>
    </span>
  </TD>
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
}: PerformanceProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('performance.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);

/** A sentence a section needs to qualify what it just showed. */
export const Note = ({
  t,
  message,
}: PerformanceProps & { readonly message: string }): ReactNode => (
  <p className="text-xs text-muted-foreground">{t(message)}</p>
);
