import type { ReactNode } from 'react';
import type { ReadinessLevelView } from '@work/career/contracts';

import type { ReadinessHistoryForDisplay } from './api';
import { civil, count } from './exact';
import { Empty, Figure, Section, Table, named, short, yesNo, type SectionProps } from './sections';

/**
 * Readiness: the rungs a tenant defined, and the statements people made using them.
 *
 * **Readiness is stated by a person and computed by nothing** (ADR-0074). There is no score on this
 * screen, no percentage and no derived level: an ordinal is a position on a ladder a human chose,
 * and an assessment exists because somebody looked at somebody else and formed a judgement. Nothing
 * here derives a level from a performance rating, a completed course count or a nine-box placement,
 * and nothing infers high potential from any of them.
 *
 * **Nothing is overwritten** (D-14). Every statement made about a person is kept, most recent first,
 * because "we thought she was ready in June and not in September" is the history this module exists
 * to hold. `latest` is a *selection* of the most recent statement and never an average of two — a
 * screen that averaged two assessors' views would produce a third opinion neither of them holds.
 *
 * **No assessment cites a document.** Career has nowhere to keep the reference and no file storage
 * exists, so there is no attachment column, no link and no upload — the status section says so
 * rather than leaving an empty cell to imply a missing file.
 *
 * **The ladder is not paged.** The domain bounds it at a hundred rungs and a ladder shown in halves
 * is not a ladder, so this one listing carries no page position — the API declares no paging on it.
 */

export const LevelsSection = ({
  t,
  language,
  levels,
}: SectionProps & { readonly levels: readonly ReadinessLevelView[] }): ReactNode => (
  <Section t={t} title="levels">
    {levels.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['ordinal', 'code', 'name', 'status', 'version']}>
        {levels.map((level) => (
          <tr key={level.readinessLevelId}>
            {/* An ordinal a human chose, bounded by the domain at a hundred. Not a score. */}
            <td>{count(level.ordinal)}</td>
            <td>{level.code}</td>
            <td>{named(level.name, language)}</td>
            {/* Retired levels stay listed: the assessments citing them must remain explainable. */}
            <td>{yesNo(level.active, t)}</td>
            <td>{count(level.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * Every statement made about one person, most recent first.
 *
 * One person, for the first row of the plan listing — never one request per employee. This is an
 * administrator's read of a record they could already see; it is not somebody's own readiness, and
 * this product cannot tell whose it would be.
 *
 * The subject of each statement — a position or a succession plan — is shown as the identifier it
 * is, because a readiness statement means nothing without saying *ready for what*, and Career stores
 * the reference rather than the thing.
 */
export const ReadinessSection = ({
  t,
  history,
}: SectionProps & { readonly history: ReadinessHistoryForDisplay | undefined }): ReactNode => (
  <Section t={t} title="assessments" note="career.notice.detailIsFirstRow">
    {history === undefined || history.assessments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Figure t={t} label="employment" value={short(history.employmentId)} />
          <Figure
            t={t}
            label="latestReadiness"
            value={
              // A selection, not a computation: the statement somebody wrote most recently.
              history.latest === undefined ? '—' : civil(history.latest.assessedOn)
            }
          />
        </dl>
        <Table t={t} headers={['assessedOn', 'level', 'position', 'succession', 'assessedBy']}>
          {history.assessments.map((assessment) => (
            <tr key={assessment.readinessAssessmentId}>
              <td>{civil(assessment.assessedOn)}</td>
              <td>{short(assessment.readinessLevelId)}</td>
              <td>{short(assessment.positionId)}</td>
              <td>{short(assessment.successionPlanId)}</td>
              {/* Who stated it. A readiness level with no human behind it is the derived score
                  this module exists not to produce. */}
              <td>{assessment.assessedBy}</td>
            </tr>
          ))}
        </Table>
      </>
    )}
  </Section>
);
