import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import {
  cycleAmong,
  loadDetailContext,
  loadEmployments,
  loadReview,
} from '../../../../performance/api';
import {
  directionOf,
  isLanguage,
  performanceTranslator,
  type Language,
} from '../../../../performance/locale';
import { Boundaries } from '../../../../performance/frame';
import { RatingSection, ReviewHeader, WorkingSection } from '../../../../performance/review';
import {
  AssessmentsSection,
  PanelSection,
  SnapshotSection,
} from '../../../../performance/assessments';

/**
 * One review, opened by its own identifier.
 *
 * **A 404 here does not mean the review is absent.** `GET /performance/reviews/:reviewId` answers
 * 404 both for a review that does not exist and for one outside the caller's scope — the module
 * says why: "confirming a review exists is the disclosure, because it says somebody is being
 * appraised". A colleague who learned that a review existed for a named employment in a named cycle
 * would have learned the thing the permission was protecting.
 *
 * So this route calls `notFound()` on `missing` and the not-found page is written to be true in
 * both cases. It is the only detail route in this product where the two are deliberately
 * indistinguishable, and it is the reason the page cannot say "no such review".
 *
 * A **refusal** is different and is rendered here rather than as a not-found page: a 401 or a 403
 * from this route means the caller lacks `performance.review.read-team` outright, which is a
 * permission boundary and not a statement about any review.
 *
 * **Two bounded employment reads, and only on this page.** One for the subject, one for the manager
 * the review names. The queue keeps identifiers precisely so that opening it costs one request per
 * page rather than one per row.
 */

export const metadata: Metadata = { title: 'Review' };

interface PageProps {
  readonly params: Promise<{ readonly reviewId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * What this screen does not do, said once.
 *
 * `calibrationKept` and `exactScore` are not here: the rating block and the working say each of
 * them beside the numbers they qualify, and a page that said the same sentence twice would be the
 * duplication the coherence review found on the screens this replaced.
 */
const BOUNDARIES = [
  'performance.notice.notAnonymous',
  'performance.notice.reviewNotFoundIsAlsoRefusal',
  'performance.notice.noDocumentBytes',
  'performance.notice.noNotifications',
];

const ReviewPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { reviewId } = await params;
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = performanceTranslator(language);
  const answer = await loadReview(reviewId);

  if (answer.kind === 'missing') notFound();

  if (answer.kind === 'refused') {
    return (
      <div dir={directionOf(language)} lang={language}>
        <Page width="wide">
          <PageHeader title={t('performance.label.review')} />
          <EmptyState
            title={t('performance.label.nothingReadable')}
            description={t('performance.withheld.reviews')}
          />
        </Page>
      </div>
    );
  }

  const detail = answer.value;
  const [context, employments] = await Promise.all([
    loadDetailContext(),
    loadEmployments(detail.review.employmentId, detail.review.managerEmploymentId),
  ]);
  const props = { t, language };

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('performance.label.review')}
          description={t('performance.label.reviewLead')}
        />

        <ReviewHeader
          {...props}
          review={detail.review}
          cycle={cycleAmong(context.cycles, detail.review.cycleId)}
          subject={employments.subject}
          manager={employments.manager}
        />

        <Stack gap={8}>
          <RatingSection {...props} review={detail.review} calibration={detail.calibration} />
          <WorkingSection t={t} detail={detail} />
          <PanelSection {...props} reviewers={detail.reviewers} aggregate={detail.peerAggregate} />
          <AssessmentsSection {...props} assessments={detail.assessments} />
          <SnapshotSection {...props} snapshot={detail.snapshot} />
        </Stack>

        <a className="text-sm underline underline-offset-4" href="/performance">
          {t('performance.label.backToPerformance')}
        </a>

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default ReviewPage;
