import type { ReactNode } from 'react';
import type { ViolationCategoryView, ViolationView } from '@work/relations/contracts';

import { categoryNamed, type Language } from './locale';
import {
  Cell,
  Clear,
  Isolated,
  Opens,
  Refused,
  Region,
  Row,
  Rows,
  Term,
  When,
  shownOf,
  stateTone,
  type RelationsProps,
} from './frame';
import type { Listing } from './api';

/**
 * One employment's relations record: every violation recorded against it, each opening its case.
 *
 * **This is the whole of the listing this product has**, and its subject is one employment. There
 * is no tenant-wide register behind it and none is assembled from this screen: the module's only
 * collection read takes an employment, because a query for every disciplinary matter in an
 * organisation is a watchlist rather than a case file.
 *
 * **An empty list is a statement about a person, and this screen only makes it when the module
 * did.** "No violations are recorded" reads as a clean record; a caller refused the read sees a
 * withheld section instead, because those mean opposite things about the same human being.
 *
 * **The list carries no occurrence ordinal, deliberately.** The module decorates only the single
 * read — an ordinal per row would cost a window query per item to dress a list nobody counts from
 * — so the column is not here, and the ordinal appears on the case, where the question is asked.
 */

interface SectionProps extends RelationsProps {
  readonly language: Language;
}

const caseHref = (violationId: string, language: Language): string =>
  `/relations/cases/${violationId}?lang=${language}`;

const ViolationRow = ({
  t,
  language,
  violation,
  categories,
}: SectionProps & {
  readonly violation: ViolationView;
  readonly categories: readonly ViolationCategoryView[] | undefined;
}): ReactNode => (
  <Row>
    <Opens
      href={caseHref(violation.violationId, language)}
      label={
        categoryNamed(categories, violation.violationCategoryId, language) ?? violation.categoryCode
      }
      value={violation.violationId}
    />
    <When>{violation.occurredOn}</When>
    <Cell>
      <Isolated>{violation.severity}</Isolated>
    </Cell>
    <Cell>
      <Term t={t} group="state" value={violation.state} tone={stateTone(violation.state)} />
    </Cell>
  </Row>
);

/**
 * The violations, or the sentence that honestly replaces them.
 *
 * The severity column is the tenant's own grading word, rendered as stored and never translated —
 * a catalogue could only make it wrong — and nothing orders by it. The state is the module's
 * closed vocabulary and is translated, because an Arabic reader meeting `under_investigation` in
 * Latin is a translation this product owes them.
 */
export const ViolationsSection = ({
  t,
  language,
  violations,
  categories,
}: SectionProps & {
  readonly violations: Listing<ViolationView> | undefined;
  readonly categories: readonly ViolationCategoryView[] | undefined;
}): ReactNode => {
  const title = t('relations.label.violations');

  if (violations === undefined) {
    return <Refused t={t} title={title} reason="relations.withheld.violationRead" />;
  }
  if (violations.items.length === 0) {
    return <Clear t={t} title={title} message="relations.empty.violations" />;
  }

  return (
    <Region title={title} description={shownOf(violations)}>
      <Rows
        headings={[
          t('relations.label.category'),
          t('relations.label.occurredOn'),
          t('relations.label.severity'),
          t('relations.label.state'),
        ]}
      >
        {violations.items.map((violation) => (
          <ViolationRow
            key={violation.violationId}
            t={t}
            language={language}
            violation={violation}
            categories={categories}
          />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('relations.notice.audited')}</p>
    </Region>
  );
};
