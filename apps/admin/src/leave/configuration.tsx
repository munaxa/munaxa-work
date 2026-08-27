import type { ReactNode } from 'react';
import type { AccrualRunView, LeavePolicyView, LeaveTypeView } from '@work/leave/contracts';

import {
  Cell,
  Clear,
  Identifier,
  Isolated,
  LeaveSection,
  Note,
  Refused,
  Row,
  Rows,
  Reference,
  Term,
  When,
  type LeaveProps,
} from './frame';
import { count, day, instant, reference } from './exact';
import { nameIn, type Language } from './locale';
import { DEFINITION_TONE } from './tones';

/**
 * What the register is calculated from: the leave types a tenant configured, the policies published
 * against them, and the accrual runs that wrote entitlement into the ledger.
 *
 * This is configuration rather than work, so it sits below the register rather than beside it. It
 * is here at all because a balance nobody can trace to a policy is a number, and the point of this
 * screen is that a number is explainable.
 *
 * **No leave type ships with this product.** Annual, sick, maternity, Hajj and Iddah are every one
 * of them a type a tenant or a country pack configures; the module seeds none and branches on none.
 * A tenant that has configured none gets an empty list and the screen says so rather than
 * suggesting any.
 *
 * **A code is never translated.** A leave type's code, a policy's code, a statutory source and a
 * reason code are tenant or country-pack values, so the screen renders what the customer stored.
 */

export interface ConfigurationProps extends LeaveProps {
  readonly language: Language;
}

export const TypesSection = ({
  t,
  language,
  types,
}: ConfigurationProps & { readonly types: readonly LeaveTypeView[] | undefined }): ReactNode => {
  const title = t('leave.label.types');

  if (types === undefined) return <Refused t={t} title={title} />;
  if (types.length === 0) return <Clear t={t} title={title} message="leave.label.noTypes" />;

  return (
    <LeaveSection title={title} description={<Isolated>{count(types.length)}</Isolated>}>
      <Rows
        headings={[
          t('leave.label.code'),
          t('leave.label.name'),
          t('leave.label.unit'),
          t('leave.label.status'),
          t('leave.label.statutorySource'),
        ]}
      >
        {types.map((type) => (
          <Row key={type.leaveTypeId}>
            <Cell>
              <Isolated>{type.code}</Isolated>
            </Cell>
            <Cell>{nameIn(type.name, language)}</Cell>
            <Cell>
              <Term t={t} group="unit" value={type.unit} tone="muted" />
            </Cell>
            <Cell>
              <Term
                t={t}
                group="definition"
                value={type.status}
                tone={DEFINITION_TONE[type.status]}
              />
            </Cell>
            <Cell>
              <Reference value={reference(type.statutorySourceCode)} />
            </Cell>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="leave.label.noStatutory" />
    </LeaveSection>
  );
};

export const PoliciesSection = ({
  t,
  language,
  policies,
}: ConfigurationProps & {
  readonly policies: readonly LeavePolicyView[] | undefined;
}): ReactNode => {
  const title = t('leave.label.policies');

  if (policies === undefined) return <Refused t={t} title={title} />;
  if (policies.length === 0) return <Clear t={t} title={title} message="leave.label.noPolicies" />;

  return (
    <LeaveSection title={title} description={<Isolated>{count(policies.length)}</Isolated>}>
      <Rows
        headings={[
          t('leave.label.code'),
          t('leave.label.name'),
          t('leave.label.status'),
          t('leave.label.durationBasis'),
          t('leave.label.accrualMethod'),
          t('leave.label.carryOverMethod'),
          t('leave.label.calendar_'),
          t('leave.label.approvalsRequired'),
        ]}
        numeric={[7]}
      >
        {policies.map((policy) => (
          <Row key={policy.leavePolicyId}>
            <Cell>
              <Isolated>{policy.code}</Isolated>
            </Cell>
            <Cell>{nameIn(policy.name, language)}</Cell>
            <Cell>
              <Term
                t={t}
                group="definition"
                value={policy.status}
                tone={DEFINITION_TONE[policy.status]}
              />
            </Cell>
            <Cell>
              <Term t={t} group="basis" value={policy.durationBasis} tone="muted" />
            </Cell>
            <Cell>
              <Term t={t} group="accrual" value={policy.accrualMethod} tone="muted" />
            </Cell>
            <Cell>
              <Term t={t} group="carryOver" value={policy.carryOverMethod} tone="muted" />
            </Cell>
            <Cell>
              <Term t={t} group="year" value={policy.leaveYearCalendar} tone="muted" />
            </Cell>
            <Cell numeric>{count(policy.approvalsRequired)}</Cell>
          </Row>
        ))}
      </Rows>
    </LeaveSection>
  );
};

/**
 * The accrual runs that wrote entitlement into the ledger.
 *
 * `refusals` is on the contract and is shown: a run that examined four hundred employments and
 * refused eleven of them is a run whose result nobody should read as complete.
 */
export const AccrualRunsSection = ({
  t,
  language,
  runs,
}: ConfigurationProps & { readonly runs: readonly AccrualRunView[] | undefined }): ReactNode => {
  const title = t('leave.label.accrualRuns');

  if (runs === undefined) return <Refused t={t} title={title} />;
  if (runs.length === 0) return <Clear t={t} title={title} message="leave.label.noAccrualRuns" />;

  return (
    <LeaveSection title={title} description={<Isolated>{count(runs.length)}</Isolated>}>
      <Rows
        headings={[
          t('leave.label.leaveType'),
          t('leave.label.from'),
          t('leave.label.to'),
          t('leave.label.examined'),
          t('leave.label.entriesWritten'),
          t('leave.label.entriesSkipped'),
          t('leave.label.refusals'),
          t('leave.label.runAt'),
        ]}
        numeric={[3, 4, 5, 6]}
      >
        {runs.map((run) => (
          <Row key={run.accrualRunId}>
            <Identifier value={reference(run.leaveTypeId)} />
            <When>
              <Isolated>{day(run.periodStart)}</Isolated>
            </When>
            <When>
              <Isolated>{day(run.periodEnd)}</Isolated>
            </When>
            <Cell numeric>{count(run.employmentsExamined)}</Cell>
            <Cell numeric>{count(run.entriesWritten)}</Cell>
            <Cell numeric>{count(run.entriesSkipped)}</Cell>
            <Cell numeric>{count(run.refusals)}</Cell>
            <When>
              <Isolated>{instant(run.runAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
    </LeaveSection>
  );
};
