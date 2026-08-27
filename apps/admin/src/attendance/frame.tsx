import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';
import type { ShiftView } from '@work/attendance/contracts';

import { nameIn, type Language, type Translate } from './locale';
import { DASH } from './exact';

/**
 * The pieces both attendance screens are built from — the design language the five completed slices
 * established, applied to a sixth destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and its own
 * scroll behaviour, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is
 * Attendance's own vocabulary: a published duration, a term from one of its closed status sets, a
 * section that was refused rather than empty, and a value that must keep its own direction inside
 * translated text.
 *
 * Four rules, stated once.
 *
 * **The domain's verdict is rendered, never re-derived.** An exception already carries its kind,
 * its severity, its minutes and a finished sentence in both languages. This screen shows those. It
 * does not decide that somebody was late, by how much, or how much it matters — the module did,
 * against a shift, a grace period and a policy this screen cannot see.
 *
 * **Refused, empty, withheld and populated are four answers.** Attendance separates
 * `attendance.read` from `attendance.event.read`, and the module says why: the events carry device
 * identifiers and, where a tenant enables capture, coordinates, and "a supervisor reviewing worked
 * hours needs neither". A screen that rendered a withheld punch list as an empty one would undo
 * that separation in presentation.
 *
 * **A superseded event is shown, not hidden.** The day read returns them deliberately, so that a
 * corrected day stays auditable from the screen where it matters. Nothing here decides which of two
 * events is correct.
 *
 * **There are no controls.** Recording a punch, resolving an exception, deciding a correction,
 * recalculating, approving and locking a day are writes, and no request from this portal carries a
 * principal, so a button here would post unauthenticated and answer 401.
 */

export interface AttendanceProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * An identifier, a civil date, an instant, a wall clock or a digest sitting inside an Arabic
 * sentence is a left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm
 * will reorder the characters around it. `<bdi>` isolates the run so it keeps its own direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A published duration, isolated **and forced left to right**.
 *
 * `<bdi>` alone is not enough for a signed one. A leading minus is a *neutral* character, so inside
 * a right-to-left paragraph it takes the paragraph's direction and is placed after the digits:
 * `-15 دقيقة` renders as `15- دقيقة`, which reads as fifteen rather than minus fifteen. The Leave
 * slice found this on a balance; on an attendance day a clock-skew figure carries the same risk.
 * `dir="ltr"` pins the isolate's own direction, so the sign leads and the translated unit still
 * follows the number.
 *
 * Every duration goes through here, not only the signed ones: a column whose sign placement
 * depended on the value would be a column nobody could scan.
 */
export const Duration = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi dir="ltr">{children}</bdi>
);

/**
 * Free text somebody wrote, isolated so its own language decides its direction.
 *
 * A correction's justification is written by a person, in whichever language they chose, and it is
 * the one kind of value on these screens whose direction is not the page's. An English sentence
 * rendered bare inside an Arabic table has its trailing full stop moved to the front, because the
 * punctuation is neutral and takes the paragraph's direction. `<bdi>` infers the run's own
 * direction from its first strong character and keeps the sentence whole.
 */
export const Wrote = ({ children }: { readonly children: ReactNode }): ReactNode =>
  children === undefined ? <span>{DASH}</span> : <bdi>{children}</bdi>;

/**
 * A cell holding free text, given room to be a sentence.
 *
 * Without a minimum width a justification wraps to three or four words a line and the row grows to
 * six, which turns a table of four corrections into a page. The table scrolls inside its own
 * container, so the width costs the page nothing.
 */
export const Sentence = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="min-w-64">
    <Wrote>{children}</Wrote>
  </TD>
);

/** A term from one of Attendance's closed status vocabularies, translated, with an optional tone. */
export const Term = ({
  t,
  group,
  value,
  tone,
}: AttendanceProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>
      <span className="whitespace-nowrap">{t(`attendance.${group}.${value}`)}</span>
    </Badge>
  );

/**
 * The domain's own sentence about an exception.
 *
 * Not a `Badge` and not a term: the module ships each of its fifteen exception kinds as a finished
 * sentence in both languages — "Arrived late." / "حضور متأخر." — and a sentence in a pill is a
 * sentence somebody has to read twice. The severity beside it carries the tone; this carries the
 * words, exactly as published and never reassembled.
 */
export const Verdict = ({ t, kind }: AttendanceProps & { readonly kind: string }): ReactNode => (
  <span className="text-sm text-foreground">{t(`attendance.exception.${kind}`)}</span>
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
export const AttendanceSection = ({
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
 * `reason` names *which* permission was refused where Attendance separates them, so somebody who
 * can read a day but not its punches learns that rather than concluding nobody clocked in.
 */
export const Refused = ({
  t,
  title,
  reason,
}: AttendanceProps & { readonly title: string; readonly reason?: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(reason ?? 'admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: AttendanceProps & { readonly title: string; readonly message: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(message)}</p>
  </Section>
);

/**
 * A table, in the design system's own shape.
 *
 * `Table` brings its own `overflow-x-auto` container, and that container is the mobile answer. An
 * attendance row carries an employment identifier in full, a civil date, two instants and a
 * duration, and at 390 px those either scroll inside the table or squash the page into an
 * unreadable column. The page never scrolls sideways; the table does.
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
 * A cell holding a civil date, an instant or a wall clock.
 *
 * `whitespace-nowrap` because `2026-08-24` broken across two lines as `2026-08-` and `24` is not a
 * date any more — which is what the screen this replaced did to every date on it once the columns
 * outgrew the width.
 */
export const When = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="whitespace-nowrap">{children}</TD>
);

/**
 * A cell holding a reference to something another module owns.
 *
 * Monospaced, muted and **never shortened**. Attendance holds no name for anybody, so an employment
 * here is an identifier and the screen says so rather than inventing a lookup.
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
 * A cell naming a shift, with its code kept beneath it.
 *
 * Used only where the name came from a read the page had already made — the configured shifts,
 * fetched once for the whole page. It is never a lookup issued per row: that is the N+1 this
 * product's screens are forbidden, and the reason an employment on these pages stays an identifier.
 */
export const Named = ({
  name,
  value,
}: {
  readonly name: string | undefined;
  readonly value: string;
}): ReactNode =>
  name === undefined ? (
    <Identifier value={value} />
  ) : (
    <TD className="whitespace-nowrap">
      <span className="block text-sm text-foreground">{name}</span>
      <span className="block font-mono text-xs text-muted-foreground">
        <Isolated>{value}</Isolated>
      </span>
    </TD>
  );

/**
 * The configured shifts as a lookup, built once from the read the page already made.
 *
 * Not a resolver, not a cache and not a service: a `Map` over one array, scoped to one render. The
 * shifts are Attendance's own and were fetched for the register regardless, so naming a shift on a
 * row costs no request — which is what separates it from resolving an employment, where the name
 * belongs to another module and there is no batched read to ask.
 */
export const shiftNamesOf = (
  shifts: readonly ShiftView[] | undefined,
  language: Language,
): ReadonlyMap<string, string> =>
  new Map((shifts ?? []).map((shift) => [shift.shiftId, nameIn(shift.name, language)]));

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
}: AttendanceProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('attendance.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);

/** A sentence a section needs to qualify what it just showed. */
export const Note = ({ t, message }: AttendanceProps & { readonly message: string }): ReactNode => (
  <p className="text-xs text-muted-foreground">{t(message)}</p>
);
