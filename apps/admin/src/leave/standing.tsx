import type { ReactNode } from 'react';
import type { LeaveBalanceView, LeaveTypeView, ProjectedBalanceView } from '@work/leave/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Duration,
  Fact,
  Facts,
  Isolated,
  LeaveSection,
  Named,
  Note,
  Refused,
  Reference,
  Row,
  Rows,
  Term,
  When,
  shownOf,
  type LeaveProps,
} from './frame';
import { count, day, instant, minutes, reference } from './exact';
import { nameIn, type Language } from './locale';
import type { Listing, Outcome, StandingForDisplay } from './api';

/**
 * One employment's leave standing: every balance it holds, and the movements that produced them.
 *
 * This is the screen the whole slice exists for. A leave balance is the number people argue about,
 * and until now the product could show the number and never the arithmetic behind it — so a
 * disputed figure had no answer other than "that is what the system says".
 *
 * **The ledger is the answer, and it is entirely the server's.** `LedgerEntryView` publishes
 * `balanceBeforeMinutes` and `balanceAfterMinutes` on **every** entry, alongside what moved it
 * (`kind`), what caused it (`sourceKind`, `sourceId`) and what it reverses. So the page walks a
 * balance movement by movement without adding a single number: no running total, no sum of a
 * column, no derived opening figure. A screen that computed the running balance would be a second
 * arithmetic beside the ledger's own, and the first time they disagreed the ledger would be right.
 *
 * **A projection is calculated for one leave type at a time, and never chosen on the reader's
 * behalf.** `leave.projected-balance` is keyed on an employment, a leave type and a date. Picking a
 * leave type silently would be the defect the payroll slice removed in another module. So the page
 * shows the projection when a type has been chosen, and otherwise says plainly that one must be.
 *
 * **Two permissions, two different refusals.** Balances, the ledger and the projection answer to
 * `leave.balance.read`; entitlements, adjustments and requests answer to `leave.read`. A caller
 * holding one and not the other sees half this page and is told which half was withheld.
 */

export interface StandingProps extends LeaveProps {
  readonly language: Language;
}

export const narrowedHref = (
  employmentId: string,
  language: Language,
  leaveTypeId: string | undefined,
): string =>
  `/leave/balances/${employmentId}?lang=${language}${
    leaveTypeId === undefined ? '' : `&leaveTypeId=${leaveTypeId}`
  }`;

/** Who this page is about, as far as the modules that own the answer will say. */
export const StandingIdentity = ({
  t,
  language,
  standing,
  employmentId,
}: StandingProps & {
  readonly standing: StandingForDisplay;
  readonly employmentId: string;
}): ReactNode => (
  <Facts>
    <Fact
      label={t('leave.label.employment')}
      value={<Reference value={reference(employmentId)} />}
    />
    <Fact
      label={t('leave.label.person')}
      value={
        standing.employment?.personName === undefined
          ? t('admin.label.notResolved')
          : nameIn(standing.employment.personName as { en: string; ar: string }, language)
      }
    />
    <Fact
      label={t('leave.label.employmentNumber')}
      value={<Reference value={reference(standing.employment?.employmentNumber)} />}
    />
  </Facts>
);

/**
 * The leave types this page can be narrowed to.
 *
 * Links rather than a control, because this portal ships no client component and a `<select>` that
 * needed JavaScript to do anything would be a control that does nothing. Every link is a real
 * address a reader can bookmark.
 */
export const TypeChooser = ({
  t,
  language,
  types,
  employmentId,
  selected,
}: StandingProps & {
  readonly types: readonly LeaveTypeView[] | undefined;
  readonly employmentId: string;
  readonly selected: string | undefined;
}): ReactNode => {
  if (types === undefined || types.length === 0) return undefined;

  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-medium uppercase tracking-wide text-muted-foreground">
        {t('leave.label.leaveTypeFilter')}
      </span>
      <a
        href={narrowedHref(employmentId, language, undefined)}
        className={
          selected === undefined
            ? 'font-medium text-foreground'
            : 'text-muted-foreground underline underline-offset-4'
        }
      >
        {t('leave.label.allLeaveTypes')}
      </a>
      {types.map((type) => (
        <a
          key={type.leaveTypeId}
          href={narrowedHref(employmentId, language, type.leaveTypeId)}
          className={
            selected === type.leaveTypeId
              ? 'font-medium text-foreground'
              : 'text-muted-foreground underline underline-offset-4'
          }
        >
          {nameIn(type.name, language)}
        </a>
      ))}
    </nav>
  );
};

const BalanceRow = ({
  t,
  language,
  balance,
  names,
}: StandingProps & {
  readonly balance: LeaveBalanceView;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => (
  <Row>
    <Named name={names.get(balance.leaveTypeId)} value={reference(balance.leaveTypeId)} />
    <When>
      <Isolated>{day(balance.leaveYearStart)}</Isolated>
    </When>
    <Cell numeric>
      <Duration>{minutes(t, balance.openingMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.carriedInMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.accruedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.consumedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.adjustedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.expiredMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.availableMinutes)}</Duration>
    </Cell>
    <Cell>
      {balance.inputsChangedAt === undefined ? (
        <Isolated>{instant(balance.calculatedAt, language)}</Isolated>
      ) : (
        <span className="text-warning-foreground">{t('leave.label.stale')}</span>
      )}
    </Cell>
  </Row>
);

const BALANCE_HEADINGS = [
  'leave.label.leaveType',
  'leave.label.leaveYear',
  'leave.label.opening',
  'leave.label.carriedIn',
  'leave.label.accrued',
  'leave.label.consumed',
  'leave.label.adjusted',
  'leave.label.expired',
  'leave.label.available',
  'leave.label.calculatedAt',
] as const;

/**
 * Every bucket this employment holds: the leave type, the leave year, and the seven published
 * figures that make up the eighth.
 *
 * The seven components are shown beside the available figure rather than instead of it, because
 * "available" on its own is the number people dispute and the components are the first half of the
 * answer. The ledger below is the second half. Nothing here adds the components up to check the
 * total — that is the server's arithmetic and this page is not a second opinion on it.
 */
export const BalancesSection = ({
  t,
  language,
  balances,
  names,
}: StandingProps & {
  readonly balances: Listing<LeaveBalanceView> | undefined;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => {
  const title = t('leave.label.balances');

  if (balances === undefined) {
    return <Refused t={t} title={title} reason="leave.notice.balanceIsOwnPermission" />;
  }
  if (balances.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noBalances" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(balances)}>
      <Rows headings={BALANCE_HEADINGS.map(t)} numeric={[2, 3, 4, 5, 6, 7, 8]}>
        {balances.items.map((balance) => (
          <BalanceRow
            key={`${balance.leaveTypeId}-${balance.leaveYearStart}`}
            t={t}
            language={language}
            balance={balance}
            names={names}
          />
        ))}
      </Rows>
      {balances.items.some((balance) => balance.inputsChangedAt !== undefined) ? (
        <Note t={t} message="leave.notice.staleBalance" />
      ) : undefined}
    </LeaveSection>
  );
};

/** The year-end figure, marked on the contract as a projection and marked here as one too. */
export const ProjectionSection = ({
  t,
  projection,
}: LeaveProps & { readonly projection: Outcome<ProjectedBalanceView> | undefined }): ReactNode => {
  const title = t('leave.label.projection');

  if (projection === undefined) {
    return <Clear t={t} title={title} message="leave.notice.chooseLeaveType" />;
  }
  if (projection.kind === 'refused') {
    return <Refused t={t} title={title} reason="leave.notice.balanceIsOwnPermission" />;
  }
  if (projection.kind === 'missing') {
    return <Clear t={t} title={title} message="leave.label.noBalances" />;
  }

  const value = projection.value;

  return (
    <LeaveSection title={title}>
      <Facts>
        <Fact
          label={t('leave.label.available')}
          value={<Duration>{minutes(t, value.availableMinutes)}</Duration>}
        />
        <Fact
          label={t('leave.label.projectedAccrual')}
          value={<Duration>{minutes(t, value.projectedAccrualMinutes)}</Duration>}
        />
        <Fact
          label={t('leave.label.projectedAvailable')}
          value={<Duration>{minutes(t, value.projectedAvailableMinutes)}</Duration>}
        />
        <Fact
          label={t('leave.label.projectionBasis')}
          value={<Term t={t} group="accrual" value={value.projectionBasis} tone="muted" />}
        />
        <Fact
          label={t('leave.label.leaveYear')}
          value={<Isolated>{`${day(value.leaveYearStart)} — ${day(value.leaveYearEnd)}`}</Isolated>}
        />
        <Fact
          label={t('leave.label.entryCount')}
          value={<Isolated>{count(value.entryCount)}</Isolated>}
        />
      </Facts>
      <Note t={t} message="leave.notice.projectionAssumes" />
    </LeaveSection>
  );
};

/** What the standing does not do. */
const STANDING_BOUNDARIES = [
  'leave.notice.minutesAsPublished',
  'leave.notice.asOfNotPublished',
  'leave.label.noMoney',
  'leave.label.noEmploymentStatus',
  'leave.notice.recalculationIsApi',
  'admin.notice.readOnly',
] as const;

export const StandingBoundaries = ({ t }: LeaveProps): ReactNode => (
  <Boundaries t={t} keys={STANDING_BOUNDARIES} />
);
