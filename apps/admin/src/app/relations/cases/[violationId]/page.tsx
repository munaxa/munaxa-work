import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadCase, loadCaseContext } from '../../../../relations/api';
import {
  categoryNamed,
  directionOf,
  isLanguage,
  relationsTranslator,
  type Language,
} from '../../../../relations/locale';
import { Boundaries, Isolated, Term, stateTone } from '../../../../relations/frame';
import { CaseFacts, CaseStateSection, InvestigationsSection } from '../../../../relations/case';
import {
  ApplicableSection,
  IssuedActionSection,
  RepeatSection,
} from '../../../../relations/case-discipline';

/**
 * One case, opened by its violation's identifier: the record, its lifecycle, its inquiries, its
 * repeat position, and what was issued on it.
 *
 * This route is where the module's reads were always pointing. Six of them compose it —
 * `GET /relations/violations/:id`, `…/cases/:id/history`, `…/investigations?violationId=`,
 * `…/violations/escalation`, `…/cases/:id/applicable-action` and `…/cases/:id/action` — and every
 * one of them rides on the same grant, `relations.violation.read`, so a caller either reads the
 * case file or none of it. The one addition is the findings grant, which the module applies
 * *inside* the investigation payloads.
 *
 * A 404 here means one thing this tenant can observe: it holds no violation with this identifier.
 * The module answers not-found for another tenant's identifier deliberately, so an identifier
 * cannot be used as a probe — and this page is written to be true in both cases.
 *
 * **Reading this page is being recorded.** Every read behind it writes an access event against the
 * caller's name, inside the read's own transaction (AD-007). The boundary footnote says so in the
 * customer's own words.
 *
 * Like the detail routes before it, this one renders the correct not-found state at HTTP 200 —
 * shared streaming infrastructure, tracked separately, inherited rather than fixed here.
 */

export const metadata: Metadata = { title: 'Violation case' };

interface PageProps {
  readonly params: Promise<{ readonly violationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The statements a reader of a case is most likely to assume otherwise about — each one a boundary
 * this module actually keeps, in the customer's own words from its catalogue.
 */
const BOUNDARIES = [
  'relations.notice.audited',
  'relations.notice.derivedState',
  'relations.notice.occurrenceDerived',
  'relations.notice.findingsRestricted',
  'relations.notice.actionNotExecuted',
  'relations.notice.recommendationIsText',
];

/** The caller may not read this case at all — one page, one sentence, and nothing about anybody. */
const RefusedCase = ({ language }: { readonly language: Language }): ReactNode => {
  const t = relationsTranslator(language);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader title={t('relations.label.violation')} />
        <EmptyState
          title={t('relations.label.nothingReadable')}
          description={t('relations.withheld.violationRead')}
        />
      </Page>
    </div>
  );
};

const CasePage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { violationId } = await params;
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = relationsTranslator(language);
  const answer = await loadCase(violationId);

  if (answer.kind === 'missing') notFound();
  if (answer.kind === 'refused') return <RefusedCase language={language} />;

  const violation = answer.value;
  const context = await loadCaseContext(violation);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/relations/employments/${violation.employmentId}?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('relations.label.backToRelations')}
            </a>
          }
          title={
            <Isolated>
              {categoryNamed(context.categories, violation.violationCategoryId, language) ??
                violation.categoryCode}
            </Isolated>
          }
          description={<Isolated>{violation.occurredOn}</Isolated>}
          actions={
            <Term t={t} group="state" value={violation.state} tone={stateTone(violation.state)} />
          }
        />

        <Stack gap={8}>
          <CaseFacts t={t} language={language} violation={violation} />
          <CaseStateSection t={t} history={context.history} />
          <InvestigationsSection t={t} investigations={context.investigations} />
          <RepeatSection t={t} language={language} escalation={context.escalation} />
          <ApplicableSection t={t} applicable={context.applicable} />
          <IssuedActionSection t={t} action={context.action} />
        </Stack>

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default CasePage;
