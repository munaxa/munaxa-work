import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PayGradeState, SalaryStructureState } from '../domain/salary-structure.js';
import type { PayScaleState, SalaryStepState } from '../domain/pay-scale.js';
import type {
  PayGradeStore,
  PayScaleStore,
  SalaryStepStore,
  StructureStore,
} from '../application/compensation-ports.js';

import {
  GRADE_COLUMNS,
  SCALE_COLUMNS,
  STEP_COLUMNS,
  STRUCTURE_COLUMNS,
  gradeValues,
  scaleValues,
  stepValues,
  structureValues,
  toGrade,
  toScale,
  toStep,
  toStructure,
  type GradeRow,
  type ScaleRow,
  type StepRow,
  type StructureRow,
} from './structure-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The four hierarchy tables, in PostgreSQL.
 *
 * Every one is reference data: read to constrain and to explain, never to compute a payment. The
 * step repository in particular offers no method that could rewrite an amount an assignment already
 * copied, which is what keeps last year's payroll re-run producing last year's figure.
 */
export class SalaryStructureRepository
  extends Repository<{ id: string; version: number }>
  implements StructureStore
{
  public constructor() {
    super('compensation_salary_structure');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<SalaryStructureState | undefined> {
    const rows = await transaction.execute<StructureRow>(
      `select ${STRUCTURE_COLUMNS} from compensation_salary_structure s
        where s.id = $1 and s.tenant_id = $2 and s.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toStructure(row);
  }

  public async all(transaction: Transaction): Promise<readonly SalaryStructureState[]> {
    const rows = await transaction.execute<StructureRow>(
      `select ${STRUCTURE_COLUMNS} from compensation_salary_structure s
        where s.tenant_id = $1 and s.deleted_at is null order by s.code`,
      [transaction.tenantId],
    );
    return rows.map(toStructure);
  }

  public async insert(transaction: Transaction, state: SalaryStructureState): Promise<void> {
    await insertRow(
      transaction,
      'compensation_salary_structure',
      structureValues(state),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: SalaryStructureState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(structureValues(state)));
  }
}

export class PayGradeRepository
  extends Repository<{ id: string; version: number }>
  implements PayGradeStore
{
  public constructor() {
    super('compensation_pay_grade');
  }

  public async byId(transaction: Transaction, id: string): Promise<PayGradeState | undefined> {
    const rows = await transaction.execute<GradeRow>(
      `select ${GRADE_COLUMNS} from compensation_pay_grade g
        where g.id = $1 and g.tenant_id = $2 and g.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toGrade(row);
  }

  public async all(transaction: Transaction): Promise<readonly PayGradeState[]> {
    const rows = await transaction.execute<GradeRow>(
      `select ${GRADE_COLUMNS} from compensation_pay_grade g
        where g.tenant_id = $1 and g.deleted_at is null order by g.code, g.effective_from`,
      [transaction.tenantId],
    );
    return rows.map(toGrade);
  }

  public async forStructure(
    transaction: Transaction,
    salaryStructureId: string,
  ): Promise<readonly PayGradeState[]> {
    const rows = await transaction.execute<GradeRow>(
      `select ${GRADE_COLUMNS} from compensation_pay_grade g
        where g.tenant_id = $1 and g.salary_structure_id = $2 and g.deleted_at is null
        order by g.code, g.effective_from`,
      [transaction.tenantId, salaryStructureId],
    );
    return rows.map(toGrade);
  }

  public async insert(transaction: Transaction, state: PayGradeState): Promise<void> {
    await insertRow(transaction, 'compensation_pay_grade', gradeValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PayGradeState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(gradeValues(state)));
  }
}

export class PayScaleRepository implements PayScaleStore {
  public async byId(transaction: Transaction, id: string): Promise<PayScaleState | undefined> {
    const rows = await transaction.execute<ScaleRow>(
      `select ${SCALE_COLUMNS} from compensation_pay_scale s
        where s.id = $1 and s.tenant_id = $2 and s.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toScale(row);
  }

  public async all(transaction: Transaction): Promise<readonly PayScaleState[]> {
    const rows = await transaction.execute<ScaleRow>(
      `select ${SCALE_COLUMNS} from compensation_pay_scale s
        where s.tenant_id = $1 and s.deleted_at is null order by s.code`,
      [transaction.tenantId],
    );
    return rows.map(toScale);
  }

  public async forGrade(
    transaction: Transaction,
    payGradeId: string,
  ): Promise<readonly PayScaleState[]> {
    const rows = await transaction.execute<ScaleRow>(
      `select ${SCALE_COLUMNS} from compensation_pay_scale s
        where s.tenant_id = $1 and s.pay_grade_id = $2 and s.deleted_at is null order by s.code`,
      [transaction.tenantId, payGradeId],
    );
    return rows.map(toScale);
  }

  public async insert(transaction: Transaction, state: PayScaleState): Promise<void> {
    await insertRow(transaction, 'compensation_pay_scale', scaleValues(state), new Date());
  }
}

/**
 * Salary steps.
 *
 * `forParent` matches a scale **or** a grade, because a step belongs to exactly one of the two and
 * the schema refuses anything else. Passing neither returns nothing rather than everything — a
 * silent full scan is how a catalogue read becomes a table scan.
 */
export class SalaryStepRepository implements SalaryStepStore {
  public async byId(transaction: Transaction, id: string): Promise<SalaryStepState | undefined> {
    const rows = await transaction.execute<StepRow>(
      `select ${STEP_COLUMNS} from compensation_salary_step t
        where t.id = $1 and t.tenant_id = $2 and t.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toStep(row);
  }

  public async all(transaction: Transaction): Promise<readonly SalaryStepState[]> {
    const rows = await transaction.execute<StepRow>(
      `select ${STEP_COLUMNS} from compensation_salary_step t
        where t.tenant_id = $1 and t.deleted_at is null order by t.step_number`,
      [transaction.tenantId],
    );
    return rows.map(toStep);
  }

  public async forParent(
    transaction: Transaction,
    parent: { readonly payScaleId?: string; readonly payGradeId?: string },
  ): Promise<readonly SalaryStepState[]> {
    const rows = await transaction.execute<StepRow>(
      `select ${STEP_COLUMNS} from compensation_salary_step t
        where t.tenant_id = $1 and t.deleted_at is null
          and ($2::uuid is not null and t.pay_scale_id = $2::uuid
            or $3::uuid is not null and t.pay_grade_id = $3::uuid)
        order by t.step_number`,
      [transaction.tenantId, parent.payScaleId ?? null, parent.payGradeId ?? null],
    );
    return rows.map(toStep);
  }

  public async insert(transaction: Transaction, state: SalaryStepState): Promise<void> {
    await insertRow(transaction, 'compensation_salary_step', stepValues(state), new Date());
  }
}
