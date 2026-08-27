import type { ReactNode } from 'react';
import type { AssignmentView, ContractView, ReportingLineView } from '@work/employment/contracts';
import type { PersonProfileView } from '@work/people/contracts';

import type { Language } from '../shell/locale';

import {
  Cell,
  DASH,
  Fact,
  Facts,
  Identifier,
  NothingToShow,
  RecordSection,
  Row,
  Rows,
  Withheld,
  orDash,
  type SectionProps,
} from './record-frame';
import { nameIn } from './locale';
import { dayOf, short, textIn } from './record-locale';
import type { EmployeeRecord } from './record-api';

/**
 * Who this person is, where they sit, and what they signed.
 *
 * **Identity is People's and employment is Employment's, and they stay that way.** The record shows
 * them together because that is what a reader needs; nothing here merges them into one object, and
 * the person's identifier and the employment's identifier are both available because they are
 * different things and an administrator raising a support call needs the right one.
 *
 * **Sensitive fields are the API's decision, not this screen's.** `PersonView` carries
 * `sensitiveWithheld` and the profile carries a `withheld` list; where either says a field was held
 * back the record says so rather than rendering a blank that reads as missing data. It never asks
 * "may I show this" and then shows it — a caller without the permission does not receive the value.
 */

const Identity = ({
  t,
  language,
  profile,
}: SectionProps & {
  readonly language: Language;
  readonly profile: PersonProfileView;
}): ReactNode => {
  const person = profile.person;
  const withheld = person.sensitiveWithheld || profile.withheld.length > 0;

  return (
    <RecordSection title={t('admin.record.identity')}>
      <Facts>
        <Fact
          label={t('people.label.legalName')}
          value={textIn(person.legalName, language) ?? short(person.personId)}
        />
        <Fact label={t('people.label.personNumber')} value={person.personNumber} />
        <Fact label={t('people.label.status')} value={t(`people.status.${person.status}`)} />
        <Fact label={t('admin.label.personId')} value={short(person.personId)} />
        <Fact label={t('people.label.asOf')} value={person.asOf} />
        <Fact
          label={t('people.label.nationalities')}
          value={orDash(profile.nationalities?.length)}
        />
      </Facts>

      {withheld ? (
        <p className="text-xs text-muted-foreground">{t('people.hint.sensitiveWithheld')}</p>
      ) : null}
    </RecordSection>
  );
};

export const IdentitySection = ({
  t,
  language,
  record,
}: SectionProps & {
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode =>
  record.profile === undefined ? (
    <Withheld t={t} title={t('admin.record.identity')} />
  ) : (
    <Identity t={t} language={language} profile={record.profile} />
  );

const AssignmentRows = ({
  t,
  assignments,
}: SectionProps & { readonly assignments: readonly AssignmentView[] }): ReactNode => (
  <Rows
    headings={[
      t('employment.label.assignmentType'),
      t('employment.label.unit'),
      t('employment.label.position'),
      t('employment.label.fte'),
      t('employment.label.effectiveFrom'),
      t('employment.label.effectiveTo'),
    ]}
    numeric={[3]}
  >
    {assignments.map((assignment) => (
      <Row key={assignment.assignmentId}>
        <Cell>{t(`employment.assignmentType.${assignment.assignmentType}`)}</Cell>
        <Identifier value={short(assignment.unitId)} />
        <Identifier value={short(assignment.positionId)} />
        <Cell numeric>{assignment.fte}</Cell>
        <Cell>{dayOf(assignment.effectiveFrom)}</Cell>
        <Cell>{dayOf(assignment.effectiveTo)}</Cell>
      </Row>
    ))}
  </Rows>
);

const ReportingRows = ({
  t,
  lines,
  managerName,
}: SectionProps & {
  readonly lines: readonly ReportingLineView[];
  readonly managerName: string | undefined;
}): ReactNode => (
  <Rows
    headings={[
      t('employment.label.lineType'),
      t('employment.label.manager'),
      t('employment.label.effectiveFrom'),
      t('employment.label.effectiveTo'),
    ]}
  >
    {lines.map((line) => (
      <Row key={line.reportingLineId}>
        <Cell>{t(`employment.lineType.${line.lineType}`)}</Cell>
        <Cell>{managerName ?? short(line.managerEmploymentId)}</Cell>
        <Cell>{dayOf(line.effectiveFrom)}</Cell>
        <Cell>{dayOf(line.effectiveTo)}</Cell>
      </Row>
    ))}
  </Rows>
);

/**
 * Where this employment sits, and who it reports to — both **as at a date**, never "now".
 *
 * The manager is a name, because Employment publishes a bounded read for one employment and that
 * read carries the person's name when the caller may see it. The unit and the position are not:
 * resolving either needs a lookup by identifier that Organization does not publish, so the record
 * shows the identifier and the notice under the tables says exactly why rather than leaving a
 * reader to conclude the data is missing.
 */
export const PlacementSection = ({
  t,
  language,
  record,
}: SectionProps & {
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode => {
  const assignments = record.assignments;
  const lines = record.reportingLines;

  if (assignments === undefined && lines === undefined) {
    return <Withheld t={t} title={t('admin.record.placement')} />;
  }

  return (
    <RecordSection title={t('admin.record.placement')}>
      <AssignmentRows t={t} assignments={assignments ?? []} />
      <ReportingRows t={t} lines={lines ?? []} managerName={nameIn(record.managerName, language)} />
      <p className="text-xs text-muted-foreground">{t('admin.notice.identifiersNotNames')}</p>
    </RecordSection>
  );
};

const ContractRows = ({
  t,
  contracts,
}: SectionProps & { readonly contracts: readonly ContractView[] }): ReactNode => (
  <Rows
    headings={[
      t('employment.label.contractType'),
      t('employment.label.startDate'),
      t('employment.label.endDate'),
      t('employment.label.probationEndDate'),
      t('employment.label.probationOutcome'),
    ]}
  >
    {contracts.map((contract) => (
      <Row key={contract.contractId}>
        <Cell>{contract.contractTypeCode}</Cell>
        <Cell>{contract.startDate}</Cell>
        <Cell>{orDash(contract.endDate)}</Cell>
        <Cell>{orDash(contract.probationEndDate)}</Cell>
        <Cell>
          {contract.probationOutcome === undefined
            ? DASH
            : t(`employment.probationOutcome.${contract.probationOutcome}`)}
        </Cell>
      </Row>
    ))}
  </Rows>
);

export const ContractsSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode => {
  const contracts = record.contracts;

  if (contracts === undefined) return <Withheld t={t} title={t('admin.record.contracts')} />;
  if (contracts.length === 0) return <NothingToShow t={t} title={t('admin.record.contracts')} />;

  return (
    <RecordSection title={t('admin.record.contracts')}>
      <ContractRows t={t} contracts={contracts} />
    </RecordSection>
  );
};
