import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { Translate } from './locale';

/**
 * The shape every relations screen is drawn in.
 *
 * Nothing here holds a fact. These are the decisions eight completed slices settled —
 * bidirectional isolation, refused-is-not-empty, server totals, whole identifiers, tables that own
 * their own scrolling, and boundaries stated rather than left as an absence — expressed once so the
 * two screens cannot drift apart from each other or from the rest of the product.
 */

/** What a value is when the module published nothing for it. */
const DASH = '—';

export interface RelationsProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * A category code, a civil date, a membership identifier or a violation identifier sitting inside
 * an Arabic sentence is a left-to-right run inside a right-to-left paragraph, and the bidirectional
 * algorithm will reorder the characters around it. `<bdi>` isolates the run so it keeps its own
 * direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A count, isolated **and forced left to right**.
 *
 * `<bdi>` alone is not enough where a neutral character sits beside the digits — the Leave slice
 * found this on a signed balance and the Attendance slice on a negative duration. Every occurrence
 * ordinal and window length on these screens goes through here, not only the ones that look at
 * risk, because a column whose digit order depended on the value would be a column nobody could
 * scan.
 */
export const Figure = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi dir="ltr">{children}</bdi>
);

/**
 * Free text somebody wrote, isolated so its own language decides its direction.
 *
 * A violation description, an investigation subject, its findings, its recommendation and every
 * transition reason are written by people in whichever language they chose. An English sentence
 * rendered bare inside an Arabic block has its trailing full stop moved to the front, because the
 * punctuation is neutral and takes the paragraph's direction. `<bdi>` infers the run's own
 * direction from its first strong character.
 */
export const Wrote = ({ children }: { readonly children: ReactNode }): ReactNode =>
  children === undefined || children === '' ? <span>{DASH}</span> : <bdi>{children}</bdi>;

/** A term from one of Relations' closed vocabularies, translated, with an optional tone. */
export const Term = ({
  t,
  group,
  value,
  tone,
}: RelationsProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone?: Tone;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>
      <span className="whitespace-nowrap">{t(`relations.${group}.${value}`)}</span>
    </Badge>
  );

/**
 * The tone a case state carries.
 *
 * `action_issued` is the one state that wants attention — a decision has been taken and something
 * outside this module may need to carry it out. Every other state is muted: a station in a
 * lifecycle, not a fault. No state is `danger` — an allegation is a claim an investigation can
 * refute, and colouring one red would be this screen deciding what the record has not. (Rendering
 * found `under_investigation` in the brand tone, which on this palette reads as exactly that
 * alarm, so it is muted like its neighbours.)
 */
export const stateTone = (state: string): Tone => (state === 'action_issued' ? 'warning' : 'muted');

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
export const Region = ({
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
 * `reason` names *which* permission was refused. Unlike the Assets screens, nearly every section
 * here rides on one grant — `relations.violation.read` answers the case, its history, its
 * inquiries, its repeat position and its issued action — so one sentence covering them all is the
 * accurate statement, not a shortcut.
 */
export const Refused = ({
  t,
  title,
  reason,
}: RelationsProps & { readonly title: string; readonly reason?: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(reason ?? 'admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: RelationsProps & { readonly title: string; readonly message: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(message)}</p>
  </Section>
);

/**
 * A table, in the design system's own shape.
 *
 * `Table` brings its own `overflow-x-auto` container, and that container is the mobile answer. A
 * case event carries an actor, two states, a reason and an instant, and at 390 px those either
 * scroll inside the table or squash the page into an unreadable column. The page never scrolls
 * sideways; the table does.
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
 * date any more.
 */
export const When = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="whitespace-nowrap">
    <Wrote>{children}</Wrote>
  </TD>
);

/**
 * A cell holding a reference to something another module owns.
 *
 * Monospaced, muted and **never shortened**. Relations publishes an employment identifier and a
 * membership identifier and nothing about either person — a disciplinary view that carried a name
 * would be a directory of accused people, in the module's own words — so a reference here is an
 * identifier, and the screen says so rather than inventing a lookup.
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
      <Isolated>{label}</Isolated>
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
}: RelationsProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('relations.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);
