import type { ReactNode } from 'react';
import type { AssetClearanceView } from '@work/assets/contracts';
import type { CareerSummaryView } from '@work/career/contracts';
import type { ViolationView } from '@work/relations/contracts';

import {
  Cell,
  Empty,
  Fact,
  Facts,
  Row,
  Rows,
  Section,
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
  >
    {violations.map((violation) => (
      <Row key={violation.violationId}>
        <Cell>{violation.occurredOn}</Cell>
        <Cell>{violation.categoryCode}</Cell>
        <Cell>{violation.severity}</Cell>
        <Cell>{violation.state}</Cell>
        <Cell>{orDash(violation.occurrence)}</Cell>
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
  if (violations.length === 0) return <Empty t={t} title={t('admin.record.relations')} />;

  return (
    <Section title={t('admin.record.relations')}>
      <ViolationRows t={t} violations={violations} />
    </Section>
  );
};

const Custody = ({
  t,
  clearance,
}: SectionProps & { readonly clearance: AssetClearanceView }): ReactNode => (
  <Section title={t('admin.record.assets')}>
    <Facts>
      <Fact label={t('assets.label.outstanding')} value={clearance.outstandingCount} />
      <Fact label={t('relations.label.asAt')} value={clearance.asAt} />
    </Facts>

    <Rows
      headings={[
        t('assets.label.assetTag'),
        t('assets.label.category'),
        t('assets.label.issuedOn'),
        t('assets.label.daysOutstanding'),
      ]}
    >
      {clearance.blockers.map((blocker) => (
        <Row key={blocker.assetCustodyId}>
          <Cell>{blocker.assetTag}</Cell>
          <Cell>{short(blocker.assetCategoryId)}</Cell>
          <Cell>{blocker.issuedOn}</Cell>
          <Cell>{orDash(blocker.daysOutstanding)}</Cell>
        </Row>
      ))}
    </Rows>

    <p className="text-xs opacity-70">{t('assets.note.custodyIsPeriod')}</p>
  </Section>
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
    <Section title={t('admin.record.career')}>
      <CareerFacts t={t} summary={record.career} />
    </Section>
  );

/**
 * What this record does not show, said rather than left as an absence.
 *
 * Every line is a boundary this repository actually holds, not a wish list. A reader who finds no
 * payslip on an employee record needs to know whether payroll is missing or withheld, and a reader
 * who finds no review needs to know that Performance publishes no per-employment read at all.
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

export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Section title={t('admin.record.boundaries')}>
    <ul className="flex list-disc flex-col gap-1 ps-5 text-sm opacity-80">
      {BOUNDARIES.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </Section>
);
