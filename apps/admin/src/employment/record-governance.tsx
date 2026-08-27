import type { ReactNode } from 'react';
import type { AssetClearanceView } from '@work/assets/contracts';
import type { CareerSummaryView } from '@work/career/contracts';
import type { ViolationView } from '@work/relations/contracts';

import {
  Cell,
  Fact,
  Facts,
  Isolated,
  NothingToShow,
  RecordSection,
  Row,
  Rows,
  Status,
  Withheld,
  orDash,
  type SectionProps,
} from './record-frame';
import { short } from './record-locale';
import type { EmployeeRecord } from './record-api';

/**
 * The two modules that had complete backends and no screen at all until this record existed:
 * employee relations and asset custody. Career joins them here because it is the third module whose
 * per-employment answer had nowhere to appear.
 *
 * **A disciplinary record is the most sensitive thing on this page, and it behaves like it.** Every
 * read of a violation is audited by the module, the record shows only what the module returned, and
 * a caller who may not read one meets a withheld section rather than an empty list — because an
 * empty disciplinary section reads as "this person has a clean record", which is a statement this
 * screen must never make on a refusal.
 *
 * **The severity is the tenant's word and the state is the module's.** `severity` is deliberately
 * not a closed set — a tenant chooses its own grades — so it is rendered as stored and never
 * translated, and nothing here orders by it. `state` *is* one of Relations' closed vocabularies and
 * the module ships it in both languages, so it is translated: an Arabic reader meeting `reported`
 * in Latin is a translation this product owes them.
 *
 * **`occurrence` is the module's derived ordinal, and nothing here acts on it.** What a repeat
 * *produces* is still an open decision (D-5.2-20), so the record shows the number where the module
 * supplied one and says nothing about what it means.
 *
 * **Custody arrives through the published clearance contract.** `CustodyView` is deliberately not
 * part of Assets' public surface; `AssetClearanceView` is, and it carries the outstanding count and
 * every blocking custody with its asset *tag* — a value a human recognises rather than an
 * identifier. It is Assets' contribution to a clearance decision and **not the decision**: whether
 * somebody may leave is Offboarding's, across domains Assets cannot see, and Offboarding is not
 * built.
 *
 * **Ageing is elapsed time, not overdue.** No module owns an expected return date, so this section
 * shows days outstanding and never calls one late.
 */

const ViolationRows = ({
  t,
  violations,
}: SectionProps & { readonly violations: readonly ViolationView[] }): ReactNode => (
  <Rows
    headings={[
      t('relations.label.occurredOn'),
      t('relations.label.category'),
      t('relations.label.severity'),
      t('relations.label.state'),
      t('relations.label.occurrence'),
    ]}
    numeric={[4]}
  >
    {violations.map((violation) => (
      <Row key={violation.violationId}>
        <Cell>
          <Isolated>{violation.occurredOn}</Isolated>
        </Cell>
        <Cell>
          <Isolated>{violation.categoryCode}</Isolated>
        </Cell>
        <Cell>
          <Isolated>{violation.severity}</Isolated>
        </Cell>
        <Cell>
          <Status tone="muted">{t(`relations.state.${violation.state}`)}</Status>
        </Cell>
        <Cell numeric>{orDash(violation.occurrence)}</Cell>
      </Row>
    ))}
  </Rows>
);

export const RelationsSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode => {
  const violations = record.violations;

  if (violations === undefined) return <Withheld t={t} title={t('admin.record.relations')} />;
  if (violations.length === 0) return <NothingToShow t={t} title={t('admin.record.relations')} />;

  return (
    <RecordSection title={t('admin.record.relations')}>
      <ViolationRows t={t} violations={violations} />
    </RecordSection>
  );
};

const Custody = ({
  t,
  clearance,
}: SectionProps & { readonly clearance: AssetClearanceView }): ReactNode => (
  <RecordSection title={t('admin.record.assets')}>
    <Facts>
      <Fact
        label={t('assets.label.outstanding')}
        value={
          clearance.assetsClear ? (
            clearance.outstandingCount
          ) : (
            <Status tone="warning">{clearance.outstandingCount}</Status>
          )
        }
      />
      <Fact label={t('relations.label.asAt')} value={clearance.asAt} />
    </Facts>

    {clearance.blockers.length === 0 ? null : (
      <Rows
        headings={[
          t('assets.label.assetTag'),
          t('assets.label.category'),
          t('assets.label.issuedOn'),
          t('assets.label.daysOutstanding'),
        ]}
        numeric={[3]}
      >
        {clearance.blockers.map((blocker) => (
          <Row key={blocker.assetCustodyId}>
            <Cell>
              <Isolated>{blocker.assetTag}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{short(blocker.assetCategoryId)}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{blocker.issuedOn}</Isolated>
            </Cell>
            <Cell numeric>{orDash(blocker.daysOutstanding)}</Cell>
          </Row>
        ))}
      </Rows>
    )}

    <p className="text-xs text-muted-foreground">{t('assets.note.custodyIsPeriod')}</p>
  </RecordSection>
);

export const AssetsSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode =>
  record.clearance === undefined ? (
    <Withheld t={t} title={t('admin.record.assets')} />
  ) : (
    <Custody t={t} clearance={record.clearance} />
  );

/**
 * What Career publishes about one employment: the pools it is in, the nominations it holds, the
 * recommendations still open and the last readiness somebody stated.
 *
 * Career recommends and executes nothing (ADR-0072) and readiness is stated by a person rather than
 * scored (ADR-0074). Neither is re-stated here as a number: the record shows the level a named human
 * wrote down, and there is no score, no percentage and no nine-box on this page.
 */
const CareerFacts = ({
  t,
  summary,
}: SectionProps & { readonly summary: CareerSummaryView }): ReactNode => (
  <Facts>
    <Fact label={t('career.label.openPools')} value={summary.openPoolMemberships.length} />
    <Fact label={t('career.label.openNominations')} value={summary.openNominations.length} />
    <Fact
      label={t('career.label.openRecommendations')}
      value={summary.openRecommendations.length}
    />
    <Fact
      label={t('career.label.latestReadiness')}
      value={short(summary.latestReadiness?.readinessLevelId)}
    />
    <Fact
      label={t('career.label.developmentPlans')}
      value={summary.activeDevelopmentPlan === undefined ? 0 : 1}
    />
    <Fact label={t('career.label.asOf')} value={summary.asOf} />
  </Facts>
);

export const CareerSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode =>
  record.career === undefined ? (
    <Withheld t={t} title={t('admin.record.career')} />
  ) : (
    <RecordSection title={t('admin.record.career')}>
      <CareerFacts t={t} summary={record.career} />
    </RecordSection>
  );

/**
 * What this record does not show, said rather than left as an absence — and said quietly.
 *
 * Every line is a boundary this repository actually holds, not a wish list. A reader who finds no
 * payslip on an employee record needs to know whether payroll is missing or withheld, and a reader
 * who finds no review needs to know that Performance publishes no per-employment read at all.
 *
 * It is a footnote rather than a section: it competes with nothing, and a reader looking for a fact
 * about an employee never has to scroll past it to reach one.
 */
const BOUNDARIES = [
  'admin.notice.eachSectionIsItsOwnPermission',
  'admin.notice.noPerformanceRead',
  'admin.notice.noCompensationOnRecord',
  'admin.notice.noDocumentContent',
  'admin.notice.noOffboarding',
  'admin.notice.noSelfService',
  'admin.notice.readOnly',
] as const;

export const BoundariesNote = ({ t }: SectionProps): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('admin.record.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {BOUNDARIES.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);
