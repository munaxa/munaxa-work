import type { ReactNode } from 'react';
import { Badge, Inline } from '@munaxa/ui';
import type {
  DeductionDefinitionView,
  PayrollGroupView,
  PayrollPeriodView,
} from '@work/payroll/contracts';

import {
  Cell,
  Clear,
  Identifier,
  Isolated,
  Money,
  PayrollSection,
  Refused,
  Row,
  Rows,
  Term,
  shownOf,
  type PayrollProps,
} from './frame';
import { DASH, amountOf, count, day, reference } from './exact';
import { nameIn } from './locale';
import { PERIOD_TONE } from './tones';
import type { Listing } from './api';
import type { WorkspaceProps } from './workspace';

/**
 * What runs are calculated *from*: the periods, the groups, and one group's deductions.
 *
 * These are configuration rather than work, which is why they sit below the runs rather than above
 * them — a payroll operator opens this screen to look at a payroll, not at a pay frequency.
 *
 * **Deduction definitions are scoped to a payroll group and the screen says which.** Payroll
 * publishes no tenant-wide read of them, so this shows the first group's and names that group;
 * presenting them unlabelled would imply a tenant-wide rule the module deliberately does not have.
 */

export const PeriodsSection = ({
  t,
  periods,
}: PayrollProps & { readonly periods: Listing<PayrollPeriodView> | undefined }): ReactNode => {
  const title = t('payroll.label.periods');

  if (periods === undefined) return <Refused t={t} title={title} />;
  if (periods.items.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noPeriods" />;
  }

  return (
    <PayrollSection title={title} description={shownOf(periods)}>
      <Rows
        headings={[
          t('payroll.label.code'),
          t('payroll.label.status'),
          t('payroll.label.periodStart'),
          t('payroll.label.periodEnd'),
          t('payroll.label.paymentDate'),
          t('payroll.label.group'),
        ]}
      >
        {periods.items.map((period) => (
          <Row key={period.payrollPeriodId}>
            <Cell>
              <Isolated>{period.code}</Isolated>
            </Cell>
            <Cell>
              <Term t={t} group="status" value={period.status} tone={PERIOD_TONE[period.status]} />
            </Cell>
            <Cell>
              <Isolated>{day(period.periodStart)}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{day(period.periodEnd)}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{day(period.paymentDate)}</Isolated>
            </Cell>
            <Identifier value={reference(period.payrollGroupId)} />
          </Row>
        ))}
      </Rows>
    </PayrollSection>
  );
};

export const GroupsSection = ({
  t,
  language,
  groups,
}: WorkspaceProps & { readonly groups: readonly PayrollGroupView[] | undefined }): ReactNode => {
  const title = t('payroll.label.groups');

  if (groups === undefined) return <Refused t={t} title={title} />;
  if (groups.length === 0) return <Clear t={t} title={title} message="payroll.label.noGroups" />;

  return (
    <PayrollSection title={title}>
      <Rows
        headings={[
          t('payroll.label.code'),
          t('payroll.label.name'),
          t('payroll.label.payFrequency'),
          t('payroll.label.currency'),
          t('payroll.label.roundingMode'),
        ]}
      >
        {groups.map((group) => (
          <Row key={group.payrollGroupId}>
            <Cell>
              <Isolated>{group.code}</Isolated>
            </Cell>
            <Cell>{nameIn(group.name, language)}</Cell>
            <Cell>
              <Isolated>{group.payFrequency}</Isolated>
            </Cell>
            <Cell>
              {group.permittedCurrencies.length === 0 ? (
                DASH
              ) : (
                <Inline gap={1} wrap>
                  {group.permittedCurrencies.map((code) => (
                    <Badge key={code} tone="muted">
                      <Isolated>{code}</Isolated>
                    </Badge>
                  ))}
                </Inline>
              )}
            </Cell>
            <Cell>
              <Isolated>{group.roundingMode}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
    </PayrollSection>
  );
};

export const DefinitionsSection = ({
  t,
  language,
  definitions,
  group,
}: WorkspaceProps & {
  readonly definitions: readonly DeductionDefinitionView[] | undefined;
  readonly group: PayrollGroupView | undefined;
}): ReactNode => {
  const title = t('payroll.label.deductionDefinitions');

  if (group === undefined) return <Clear t={t} title={title} message="payroll.label.noGroups" />;
  if (definitions === undefined) return <Refused t={t} title={title} />;
  if (definitions.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noDefinitions" />;
  }

  return (
    <PayrollSection
      title={title}
      description={`${t('payroll.label.group')}: ${nameIn(group.name, language)}`}
    >
      <Rows
        headings={[
          t('payroll.label.code'),
          t('payroll.label.name'),
          t('payroll.label.source'),
          t('payroll.label.basis'),
          t('payroll.label.rate'),
          t('payroll.label.amount'),
          t('payroll.label.priority'),
        ]}
        numeric={[4, 5, 6]}
      >
        {definitions.map((definition) => (
          <Row key={definition.deductionDefinitionId}>
            <Cell>
              <Isolated>{definition.code}</Isolated>
            </Cell>
            <Cell>{nameIn(definition.name, language)}</Cell>
            <Cell>
              <Isolated>{definition.deductionSource}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{definition.basis}</Isolated>
            </Cell>
            <Cell numeric>{count(definition.basisPoints)}</Cell>
            <Cell numeric>
              <Money amount={amountOf(definition.fixedAmount)} />
            </Cell>
            <Cell numeric>{count(definition.priority)}</Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.label.definitionsArePerGroup')}</p>
    </PayrollSection>
  );
};
