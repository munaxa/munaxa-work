import type { ReactNode } from 'react';
import { Badge, Grid, Section, Surface, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';

import type { Translate } from '../shell/locale';

/**
 * The pieces both approvals screens are built from — the Employee Record's design language, applied
 * to a second destination.
 *
 * `Section` gives the labelled region and its heading, `Table` the bordered container and the muted
 * header row, `Badge` the tones, `Surface` and `Grid` the summary block. What is left here is this
 * screen's own vocabulary: a term from one of Workflow's closed sets, a queue that is refused rather
 * than empty, and a value that must keep its own direction inside translated text.
 *
 * Four rules, stated once.
 *
 * **Refused, empty and populated are three answers, not two.** A caller without
 * `workflow.approval.read-own` is refused by the pipeline before the handler runs; a caller who
 * holds it but resolved no membership receives an empty page. "Nothing is waiting for you" and "you
 * are not allowed to see what is waiting" are opposite statements, and on a queue the first one is
 * the dangerous one to make wrongly.
 *
 * **The word is always the status.** A screen that distinguished a rejected approval from an
 * approved one only by a red or a green pill would be unreadable to somebody who cannot tell them
 * apart, and on an approvals screen that difference is whether an organization committed to
 * something. The tone is a reading aid on top of the word, never instead of it.
 *
 * **Nothing is computed.** No age, no due date, no elapsed time, no tally, no percentage, no clock.
 * Every one of those is published by the application against a reading instant this screen never
 * sees, and recomputing one here would be a second answer that disagrees with the first.
 *
 * **There are no controls.** Deciding is a write, and no request in this deployment carries a
 * principal. A decide button would post unauthenticated and answer 401 — a control that does not do
 * what it appears to do, on the one screen whose whole purpose is acting.
 */

export interface ApprovalsProps {
  readonly t: Translate;
}

export const DASH = '—';

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * A value that must not be reordered by the surrounding text's direction.
 *
 * A workflow code, a subject type, an identifier or an instant sitting inside an Arabic sentence is
 * a left-to-right run inside a right-to-left paragraph, and the bidirectional algorithm will reorder
 * the characters around it. `<bdi>` isolates the run so it keeps its own direction.
 */
export const Isolated = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <bdi>{children}</bdi>
);

/**
 * A term from one of Workflow's closed vocabularies, translated, with an optional tone.
 *
 * `tone` is explicitly nullable rather than optional: a lookup that finds no tone means "no
 * emphasis", which is an answer, not a missing argument.
 */
export const Term = ({
  t,
  group,
  value,
  tone,
}: ApprovalsProps & {
  readonly group: string;
  readonly value: string | undefined;
  readonly tone: Tone | undefined;
}): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <Badge tone={tone ?? 'muted'}>{t(`workflow.vocabulary.${group}.${value}`)}</Badge>
  );

/** The same term with no emphasis at all, for a vocabulary where no value is more urgent. */
export const Plain = ({
  t,
  group,
  value,
}: ApprovalsProps & { readonly group: string; readonly value: string | undefined }): ReactNode =>
  value === undefined ? (
    <span>{DASH}</span>
  ) : (
    <span>{t(`workflow.vocabulary.${group}.${value}`)}</span>
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
export const ApprovalsSection = ({
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
export const Refused = ({ t, title }: ApprovalsProps & { readonly title: string }): ReactNode => (
  <Section title={title}>
    <p className="text-sm text-muted-foreground">{t('admin.notice.sectionWithheld')}</p>
  </Section>
);

/** The API answered, and there is nothing. Deliberately not the same as the above. */
export const Clear = ({
  t,
  title,
  message,
}: ApprovalsProps & { readonly title: string; readonly message: string }): ReactNode => (
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
 * A cell holding an identifier.
 *
 * Monospaced and muted, so it reads as a reference somebody can quote rather than as a value that
 * failed to load. A membership identifier is never shortened — see `member` in the workflow
 * workspace's `exact.ts` for why — and no identifier on these screens is resolved to a name: neither
 * Identity nor the owning module publishes a bounded lookup for one.
 */
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  // `whitespace-nowrap` because a membership is thirty-six characters and must not be shortened:
  // wrapped across four lines in a narrow column it stops being readable as one value. The table
  // scrolls inside its own bounds instead, which is what `Table` is for.
  <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
    <Isolated>{value}</Isolated>
  </TD>
);
