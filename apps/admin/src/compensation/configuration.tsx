import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  CompensationChangeView,
  CompensationComponentView,
  CompensationPlanView,
  RecurringCompensationView,
  ImportBatchView,
  PayGradeView,
  PayScaleView,
  SalaryStepView,
  SalaryStructureView,
} from '@work/compensation/contracts';

import { textIn, type Language } from './locale';
import { Empty, instant, money, short, type Translate } from './sections';

/**
 * The configuration half of the compensation screen: plans, structures, grades, scales, steps,
 * components, imports — and the boundaries.
 *
 * **Every table here starts empty and stays empty until somebody configures it.** There is no
 * seeded plan, no suggested component set and no starter grade structure. A tenant that has
 * configured nothing sees "nothing configured yet" everywhere, which is the honest answer.
 *
 * **A code is rendered, never translated.** A component code, a payroll-treatment code and a
 * progression model are the customer's or a country pack's values, so the screen shows what was
 * stored rather than looking it up in a list this product ships.
 */

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const PlansSection = ({
  t,
  language,
  plans,
}: SectionProps & { readonly plans: readonly CompensationPlanView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.plans')}</h2>

    {plans.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.code')}</th>
            <th className="text-start">{t('compensation.label.name')}</th>
            <th className="text-start">{t('compensation.label.version')}</th>
            <th className="text-start">{t('compensation.label.status')}</th>
            <th className="text-start">{t('compensation.label.currency')}</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.compensationPlanId}>
              <td>{plan.code}</td>
              <td>{textIn(plan.name, language)}</td>
              <td>{plan.versionNumber}</td>
              <td>{plan.status}</td>
              <td>{plan.defaultCurrencyCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const StructuresSection = ({
  t,
  language,
  structures,
  grades,
  scales,
  steps,
}: SectionProps & {
  readonly structures: readonly SalaryStructureView[];
  readonly grades: readonly PayGradeView[];
  readonly scales: readonly PayScaleView[];
  readonly steps: readonly SalaryStepView[];
}): ReactNode => (
  <Card className="flex flex-col gap-4 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.structures')}</h2>

    {/* Every level is optional. A tenant paying simple salaries configures none of this. */}
    {structures.length === 0 && grades.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <GradeTable t={t} language={language} grades={grades} />
        <ScaleTable t={t} language={language} scales={scales} steps={steps} />
      </>
    )}
  </Card>
);

const GradeTable = ({
  t,
  language,
  grades,
}: SectionProps & { readonly grades: readonly PayGradeView[] }): ReactNode => (
  <table className="w-full text-start text-sm">
    <thead className="opacity-70">
      <tr>
        <th className="text-start">{t('compensation.label.grades')}</th>
        <th className="text-start">{t('compensation.label.minimum')}</th>
        <th className="text-start">{t('compensation.label.midpoint')}</th>
        <th className="text-start">{t('compensation.label.maximum')}</th>
        <th className="text-start">{t('compensation.label.effectiveFrom')}</th>
      </tr>
    </thead>
    <tbody>
      {grades.map((grade) => (
        <tr key={grade.payGradeId}>
          <td>{textIn(grade.name, language)}</td>
          <td>{money(grade.range.minimum)}</td>
          <td>{money(grade.range.midpoint)}</td>
          <td>{money(grade.range.maximum)}</td>
          <td>{grade.effectiveFrom}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ScaleTable = ({
  t,
  language,
  scales,
  steps,
}: SectionProps & {
  readonly scales: readonly PayScaleView[];
  readonly steps: readonly SalaryStepView[];
}): ReactNode => (
  <table className="w-full text-start text-sm">
    <thead className="opacity-70">
      <tr>
        <th className="text-start">{t('compensation.label.scales')}</th>
        <th className="text-start">{t('compensation.label.progressionModel')}</th>
        <th className="text-start">{t('compensation.label.steps')}</th>
        <th className="text-start">{t('compensation.label.amount')}</th>
      </tr>
    </thead>
    <tbody>
      {scales.map((scale) => (
        <tr key={scale.payScaleId}>
          <td>{textIn(scale.name, language)}</td>
          {/* Stored and never acted on: nothing here moves anybody between steps. */}
          <td>{scale.progressionModel}</td>
          <td>—</td>
          <td>—</td>
        </tr>
      ))}
      {steps.map((step) => (
        <tr key={step.salaryStepId}>
          <td>—</td>
          <td>—</td>
          <td>{step.stepNumber}</td>
          <td>{money(step.amount)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const ComponentsSection = ({
  t,
  language,
  components,
}: SectionProps & {
  readonly components: readonly CompensationComponentView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.components')}</h2>

    {components.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.code')}</th>
            <th className="text-start">{t('compensation.label.name')}</th>
            <th className="text-start">{t('compensation.label.kind')}</th>
            <th className="text-start">{t('compensation.label.basis')}</th>
            <th className="text-start">{t('compensation.label.rounding')}</th>
            <th className="text-start">{t('compensation.label.treatment')}</th>
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component.componentId}>
              <td>{component.code}</td>
              <td>{textIn(component.name, language)}</td>
              <td>{component.kind}</td>
              <td>{component.calculationBasis}</td>
              <td>{component.roundingMode}</td>
              {/* Rendered, never interpreted. What it means for tax is Payroll's country pack's. */}
              <td>{component.payrollTreatmentCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const ImportsSection = ({
  t,
  language,
  imports,
}: SectionProps & { readonly imports: readonly ImportBatchView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.imports')}</h2>

    {imports.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.source')}</th>
            <th className="text-start">{t('compensation.label.submittedAt')}</th>
            <th className="text-start">{t('compensation.label.rowsSubmitted')}</th>
            <th className="text-start">{t('compensation.label.rowsCreated')}</th>
            <th className="text-start">{t('compensation.label.rowsSkipped')}</th>
            <th className="text-start">{t('compensation.label.rowsFailed')}</th>
          </tr>
        </thead>
        <tbody>
          {imports.map((batch) => (
            <tr key={batch.importBatchId}>
              <td>{batch.source}</td>
              <td>{instant(batch.submittedAt, language)}</td>
              <td>{batch.rowsSubmitted}</td>
              <td>{batch.rowsCreated}</td>
              {/* The count that demonstrates idempotency rather than merely claiming it. */}
              <td>{batch.rowsSkipped}</td>
              <td>{batch.rowsFailed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{short(imports[0]?.importBatchId)}</p>
  </Card>
);

/**
 * What Compensation does not hold.
 *
 * On the screen rather than only in a document, because a boundary somebody can read is a boundary
 * somebody notices being crossed.
 */
export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-2 p-6 text-sm opacity-80">
    <h2 className="text-lg font-medium opacity-100">{t('compensation.label.boundaries')}</h2>
    <p>{t('compensation.label.noPayroll')}</p>
    <p>{t('compensation.label.noDeductions')}</p>
    <p>{t('compensation.label.noConversion')}</p>
    <p>{t('compensation.label.noStatutory')}</p>
    <p>{t('compensation.label.noBenefits')}</p>
  </Card>
);

/**
 * One employment's change log, and what is scheduled for it.
 *
 * Scoped to an employment rather than to the tenant, because that is how the module publishes it:
 * "why is this number what it is" is a question about a person, and a tenant-wide change feed would
 * be a different and much broader disclosure.
 */
export const HistorySection = ({
  t,
  language,
  history,
  future,
}: SectionProps & {
  readonly history: readonly CompensationChangeView[];
  readonly future: readonly RecurringCompensationView[];
}): ReactNode => (
  <Card className="flex flex-col gap-4 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.history')}</h2>

    {history.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.employment')}</th>
            <th className="text-start">{t('compensation.label.kind')}</th>
            <th className="text-start">{t('compensation.label.effectiveFrom')}</th>
            <th className="text-start">{t('compensation.label.recorded')}</th>
            <th className="text-start">{t('compensation.label.decidedBy')}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((change) => (
            <tr key={change.changeId}>
              <td>{short(change.employmentId)}</td>
              <td>{change.changeKind}</td>
              <td>{change.effectiveFrom ?? '—'}</td>
              <td>{instant(change.recordedAt, language)}</td>
              <td>{change.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    <h3 className="text-base font-medium">{t('compensation.label.future')}</h3>

    <FutureTable t={t} language={language} future={future} />
  </Card>
);

/** What is scheduled and not yet effective. Visible before it takes effect, deliberately. */
const FutureTable = ({
  t,
  future,
}: SectionProps & { readonly future: readonly RecurringCompensationView[] }): ReactNode =>
  future.length === 0 ? (
    <Empty t={t} />
  ) : (
    <table className="w-full text-start text-sm">
      <thead className="opacity-70">
        <tr>
          <th className="text-start">{t('compensation.label.component')}</th>
          <th className="text-start">{t('compensation.label.amount')}</th>
          <th className="text-start">{t('compensation.label.effectiveFrom')}</th>
        </tr>
      </thead>
      <tbody>
        {future.map((record) => (
          <tr key={record.recurringId}>
            <td>{record.componentCode}</td>
            <td>{money(record.amount)}</td>
            <td>{record.effectiveFrom}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
