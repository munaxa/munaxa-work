import { success, type Command, type CommandHandler } from '@work/kernel';

import { payGrade, salaryStructure, type PayRangeInput } from '../domain/salary-structure.js';
import { payScale, salaryStep } from '../domain/pay-scale.js';
import { sameCurrency } from '../domain/money-amount.js';
import type { MoneyInput } from '../domain/money-amount.js';
import type { BilingualInput, Metadata } from '../domain/compensation-aggregate.js';
import { conflicted, currentTenant, notFound, refusedBy } from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The optional salary hierarchy: structures, grades, scales and steps.
 *
 * **Every level is optional and none implies another.** A tenant may configure a structure with
 * grades and no scales, grades with steps directly beneath them, or nothing at all and pay simple
 * salaries. Forcing a government-style grade/step model on a forty-person business is the failure
 * this shape prevents, and it is why each of these four commands stands alone.
 *
 * **Nothing here computes a payment.** A grade constrains an amount; it never supplies one. A scale
 * records a progression model and never acts on it. A step supplies an amount that an assignment
 * *copies*, so revising the step next year cannot restate last year's payroll.
 */

export interface DefineSalaryStructureCommand extends Command {
  readonly commandName: 'compensation.define-structure';
  readonly code: string;
  readonly name: BilingualInput;
  readonly description?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export interface SalaryStructureDefined {
  readonly salaryStructureId: string;
}

export const defineSalaryStructureHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefineSalaryStructureCommand, SalaryStructureDefined> => ({
  commandName: 'compensation.define-structure',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const built = salaryStructure(
        { ...command, tenantId: currentTenant() },
        dependencies.clock.now(),
      );

      if (!built.ok) return refusedBy<SalaryStructureDefined>(built.error);

      await dependencies.stores.structures.insert(transaction, built.value);
      return success({ salaryStructureId: built.value.id });
    }),
});

export interface DefinePayGradeCommand extends Command {
  readonly commandName: 'compensation.define-grade';
  readonly salaryStructureId?: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly description?: string;
  readonly range: PayRangeInput;
  readonly positionGradeLabel?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export interface PayGradeDefined {
  readonly payGradeId: string;
}

export const definePayGradeHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefinePayGradeCommand, PayGradeDefined> => ({
  commandName: 'compensation.define-grade',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (command.salaryStructureId !== undefined) {
        const structure = await dependencies.stores.structures.byId(
          transaction,
          command.salaryStructureId,
        );

        if (structure === undefined) return notFound<PayGradeDefined>('salary structure');
      }

      const built = payGrade({ ...command, tenantId: currentTenant() }, dependencies.clock.now());

      if (!built.ok) return refusedBy<PayGradeDefined>(built.error);

      await dependencies.stores.grades.insert(transaction, built.value);
      return success({ payGradeId: built.value.id });
    }),
});

export interface DefinePayScaleCommand extends Command {
  readonly commandName: 'compensation.define-scale';
  readonly payGradeId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly range: PayRangeInput;
  readonly progressionModel: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export interface PayScaleDefined {
  readonly payScaleId: string;
}

/**
 * A scale within a grade.
 *
 * The scale's range must sit in the grade's currency — a scale priced in another currency is not a
 * band of its grade, and nothing in this module converts (§20.4). Whether it sits *inside* the
 * grade's range is deliberately not enforced: a tenant revising a grade upward mid-year would
 * otherwise find its own scales refused, and a scale outside its grade is a configuration a screen
 * can show rather than a contradiction the data cannot hold.
 */
export const definePayScaleHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefinePayScaleCommand, PayScaleDefined> => ({
  commandName: 'compensation.define-scale',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const grade = await dependencies.stores.grades.byId(transaction, command.payGradeId);

      if (grade === undefined) return notFound<PayScaleDefined>('pay grade');

      const built = payScale({ ...command, tenantId: currentTenant() }, dependencies.clock.now());

      if (!built.ok) return refusedBy<PayScaleDefined>(built.error);
      if (!sameCurrency(built.value.range.minimum, grade.range.minimum)) {
        return conflicted<PayScaleDefined>('compensation.rejection.scale_currency_differs');
      }

      await dependencies.stores.scales.insert(transaction, built.value);
      return success({ payScaleId: built.value.id });
    }),
});

export interface DefineSalaryStepCommand extends Command {
  readonly commandName: 'compensation.define-step';
  readonly payScaleId?: string;
  readonly payGradeId?: string;
  readonly stepNumber: number;
  readonly code?: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export interface SalaryStepDefined {
  readonly salaryStepId: string;
}

/**
 * A step under a scale or under a grade.
 *
 * **No automatic progression.** Moving an employment from step 3 to step 4 is an ordinary
 * effective-dated compensation change, made by a person or by an import and recorded as one. There
 * is no tenure rule, no anniversary trigger and no statutory ladder in this module (00B).
 */
export const defineSalaryStepHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefineSalaryStepCommand, SalaryStepDefined> => ({
  commandName: 'compensation.define-step',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const parent = await parentExists(dependencies, transaction, command);

      if (!parent) return notFound<SalaryStepDefined>('step parent');

      const built = salaryStep({ ...command, tenantId: currentTenant() }, dependencies.clock.now());

      if (!built.ok) return refusedBy<SalaryStepDefined>(built.error);

      await dependencies.stores.steps.insert(transaction, built.value);
      return success({ salaryStepId: built.value.id });
    }),
});

const parentExists = async (
  dependencies: CompensationDependencies,
  transaction: Parameters<Parameters<CompensationDependencies['unitOfWork']['execute']>[0]>[0],
  command: DefineSalaryStepCommand,
): Promise<boolean> => {
  if (command.payScaleId !== undefined) {
    return (await dependencies.stores.scales.byId(transaction, command.payScaleId)) !== undefined;
  }
  if (command.payGradeId !== undefined) {
    return (await dependencies.stores.grades.byId(transaction, command.payGradeId)) !== undefined;
  }
  // Neither named: the domain refuses it by name, so let it produce the refusal rather than a 404.
  return true;
};
