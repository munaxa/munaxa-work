import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { LeaveTypeView } from '@work/leave/contracts';

import { nameIn, type Language, type Translate } from './locale';
import { DASH } from './exact';

/**
 * The pieces all three leave screens are built from — the design language the four completed slices
 * established, applied to a fifth destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and the muted
 * header row, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is
 * Leave's own vocabulary: a published duration, a term from one of Leave's closed status sets, a
 * section that was refused rather than empty, and a value that must keep its own direction inside
 * translated text.
 *
 * Four rules, stated once.
 *
 * **Refused, empty, withheld and populated are four answers, not two.** Leave gates its reads with
 * *two different permissions*, and the separation is a privacy decision the module states plainly:
 * `leave.read` sees a request and the requester's own words — which on a sick-leave request is
 * close to health data — while `leave.balance.read` sees only the figure a manager needs to work
 * out whether somebody can be away next week. A caller can hold the second and not the first. The
 * screen that collapsed them back into one empty state would undo that in presentation.
 *
 * **A duration is rendered, never computed.** No balance is summed from its entries, no request
 * length derived from two dates, no minutes converted to days. Leave already did that arithmetic
 * once, against a policy and a working pattern this screen cannot see.
 *
 * **The word is always the status.** An approved request and a rejected one differ by a word, and
 * the tone is a reading aid on top of it, never instead of it.
 *
 * **There are no controls.** Raising, submitting, withdrawing, amending, approving, rejecting,
 * adjusting and recalculating are writes, and no request from this portal carries a principal, so a
 * button here would post unauthenticated and answer 401.
 */

export interface LeaveProps {
  readonly t: Translate;
}

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * A duration, a civil date, an instant, a digest or an identifier sitting inside an Arabic sentence
 * is a left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will
 * reorder the characters around it. `<bdi>` isolates the run so it keeps its own direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A published duration, isolated **and forced left to right**.
 *
 * `<bdi>` alone is not enough for a negative one. A leading minus sign is a *neutral* character, so
 * inside a right-to-left paragraph it takes the paragraph's direction and is placed after the
 * digits: `-480 دقيقة` renders as `480- دقيقة`, which reads as four hundred and eighty rather than
 * minus four hundred and eighty. On a leave balance that is the difference between owing days and
 * being owed them. `dir="ltr"` pins the isolate's own direction, so the sign leads and the
 * translated unit still follows the number.
 *
 * Every duration goes through here, not only the negative ones: a column whose sign placement
 * depended on the value would be a column nobody could scan.
 */
export const Duration = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi dir="ltr">{children}</bdi>
);

/** A term from one of Leave's closed status vocabularies, translated, with an optional tone. */
export const Term = ({
  t,
  group,
  value,
  tone,
}: LeaveProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>
      <span className="whitespace-nowrap">{t(`leave.${group}.${value}`)}</span>
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
export const LeaveSection = ({
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
 * `reason` names *which* permission was refused where Leave separates them, so somebody who can see
 * that leave was requested but not what the balance is learns that, rather than concluding the
 * balance is zero.
 */
export const Refused = ({
  t,
  title,
  reason,
}: LeaveProps & { readonly title: string; readonly reason?: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(reason ?? 'admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: LeaveProps & { readonly title: string; readonly message: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t(message)}</p>
  </Section>
);

/**
 * A table, in the design system's own shape.
 *
 * `Table` brings its own `overflow-x-auto` container, and that container is the mobile answer. A
 * leave row carries an employment identifier in full, two civil dates, a duration and a state, and
 * at 390 px those either scroll inside the table or squash the page into an unreadable column —
 * which is what the screen this replaced did, interleaving three columns' values into strings like
 * `09-0109-03min`, because it used a bare `<table>` rather than this one. The page never scrolls
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
 * `whitespace-nowrap` because `2026-01-01` broken across two lines as `2026-01-` and `01` is not a
 * date any more — which is what the screen this replaced did to every date on it once the columns
 * outgrew the width.
 */
export const When = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <TD className="whitespace-nowrap">{children}</TD>
);

/**
 * A cell holding a reference to something another module owns.
 *
 * Monospaced, muted and **never shortened**. Leave holds no name for anybody, so an employment here
 * is an identifier and the screen says so rather than inventing a lookup — and truncating it would
 * make every row of a page written in one transaction render the same eight characters.
 */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
    <Isolated>{value}</Isolated>
  </TD>
);

/**
 * A cell naming something another module owns, with the identifier kept beneath it.
 *
 * Used only where the name came from a read the page had already made — the configured leave types,
 * fetched once for the whole page. It is never a lookup issued per row: that is the N+1 this
 * product's screens are forbidden, and the reason an employment on these pages stays an identifier.
 * The identifier stays visible under the name because it is what the module published and what
 * somebody quoting a row to support will need.
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
 * The configured leave types as a lookup, built once from the read the page already made.
 *
 * Not a resolver, not a cache and not a service: a `Map` over one array, scoped to one render. The
 * types are Leave's own and were fetched for the chooser regardless, so naming a leave type on a
 * row costs no request at all — which is what separates it from resolving an employment, where the
 * name belongs to another module and there is no batched read to ask.
 */
export const namesOf = (
  types: readonly LeaveTypeView[] | undefined,
  language: Language,
): ReadonlyMap<string, string> =>
  new Map((types ?? []).map((type) => [type.leaveTypeId, nameIn(type.name, language)]));

/** The address of this page with one leave type chosen, or with the choice cleared. */

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
}: LeaveProps & { readonly keys: readonly string[] }): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('leave.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);

/**
 * Free text somebody wrote, isolated so its own language decides its direction.
 *
 * A leave justification and an adjustment note are written by a person, in whichever language they
 * chose, and they are the one kind of value on these screens whose direction is not the page's. An
 * English sentence rendered bare inside an Arabic table has its trailing full stop moved to the
 * front — `.Two days granted for the relocation weekend` — because the punctuation is neutral and
 * takes the paragraph's direction. `<bdi>` infers the run's own direction from its first strong
 * character and keeps the sentence whole.
 */
export const Wrote = ({ children }: { readonly children: ReactNode }): ReactNode =>
  children === undefined ? <span>{DASH}</span> : <bdi>{children}</bdi>;

/** A sentence a section needs to qualify what it just showed. */
export const Note = ({ t, message }: LeaveProps & { readonly message: string }): ReactNode => (
  <p className="text-xs text-muted-foreground">{t(message)}</p>
);
