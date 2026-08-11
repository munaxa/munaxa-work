import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * What a caller may send, and the shapes that refuse a malformed request before it reaches a
 * handler.
 *
 * **Every monetary amount arrives as a string**, matched against `^\d+$`. That is not a
 * convenience: a JSON number loses precision above 2^53, and a payroll is exactly the place where
 * that matters. The repository's convention is string minor units plus a currency code and an
 * exponent (ADR-0061), and this module does not invent a second one.
 *
 * Nothing here is a persistence model. A DTO is the request's shape; the view a handler returns is
 * assembled separately, so a column rename is not an API change.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR_UNITS = /^\d+$/;
const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export class MoneyBody {
  /** Exact minor units as a decimal string. **Never a JSON number.** */
  @ApiProperty({ example: '1000000' })
  @Matches(MINOR_UNITS)
  public readonly amountMinor!: string;

  @ApiProperty({ example: 'JOD' })
  @Matches(/^[A-Z]{3}$/)
  public readonly currencyCode!: string;

  /** Carried per amount because nothing in this product publishes a currency's exponent. */
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(4)
  public readonly currencyExponent!: number;
}

export class PermittedCurrencyBody {
  @ApiProperty({ example: 'JOD' })
  @Matches(/^[A-Z]{3}$/)
  public readonly code!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(4)
  public readonly exponent!: number;
}

export class DefineGroupBody {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly legalEntityId!: string;

  @ApiProperty({ example: 'monthly-staff' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ example: { en: 'Monthly staff', ar: 'الموظفون الشهريون' } })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiProperty({ enum: ['monthly', 'semi_monthly', 'biweekly', 'weekly', 'custom'] })
  @IsIn(['monthly', 'semi_monthly', 'biweekly', 'weekly', 'custom'])
  public readonly payFrequency!: string;

  @ApiProperty({ type: [PermittedCurrencyBody] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermittedCurrencyBody)
  public readonly permittedCurrencies!: PermittedCurrencyBody[];

  /** No universal formula. The basis is stated here and recorded on every prorated line. */
  @ApiProperty({ enum: ['calendar_days', 'working_days', 'scheduled_minutes'] })
  @IsIn(['calendar_days', 'working_days', 'scheduled_minutes'])
  public readonly prorationBasis!: string;

  @ApiProperty({ enum: ['half-up', 'half-even', 'down', 'up'] })
  @IsIn(['half-up', 'half-even', 'down', 'up'])
  public readonly roundingMode!: string;

  /** No default: whether a suspended employment is paid is a contract question. */
  @ApiProperty()
  @IsBoolean()
  public readonly paysSuspended!: boolean;

  /** An opaque tenant code. **Payroll owns no chart of accounts** (ADR-0067). */
  @ApiProperty({ example: 'payroll-expense' })
  @IsString()
  @IsNotEmpty()
  public readonly expenseAccount!: string;

  @ApiProperty({ example: 'payroll-deductions' })
  @IsString()
  @IsNotEmpty()
  public readonly deductionAccount!: string;

  @ApiProperty({ example: 'payroll-payable' })
  @IsString()
  @IsNotEmpty()
  public readonly payableAccount!: string;

  @ApiProperty({ example: 'bank-transfer' })
  @IsString()
  @IsNotEmpty()
  public readonly paymentMethodCode!: string;

  /** Which country pack would supply statutory rules. **Nothing implements one.** */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly countryPackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  public readonly countryPackVersion?: number;
}

export class DefineDeductionBody {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly payrollGroupId!: string;

  @ApiProperty({ example: 'union-dues' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty()
  @IsObject()
  public readonly name!: Record<string, string>;

  /**
   * `statutory`, `benefit` and `loan_advance` may be **declared** and have no producer in this
   * phase: no country pack, no Benefits domain and no Loans domain exists (ADR-0067).
   */
  @ApiProperty({
    enum: [
      'unpaid_leave',
      'voluntary',
      'payroll_adjustment',
      'statutory',
      'benefit',
      'loan_advance',
    ],
  })
  @IsIn(['unpaid_leave', 'voluntary', 'payroll_adjustment', 'statutory', 'benefit', 'loan_advance'])
  public readonly deductionSource!: string;

  @ApiProperty({ example: 'voluntary' })
  @IsString()
  @IsNotEmpty()
  public readonly payrollTreatmentCode!: string;

  @ApiProperty({ enum: ['fixed_amount', 'basis_points_of_gross'] })
  @IsIn(['fixed_amount', 'basis_points_of_gross'])
  public readonly basis!: string;

  @ApiPropertyOptional({ type: MoneyBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly fixedAmount?: MoneyBody;

  @ApiPropertyOptional({ example: 250 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  public readonly basisPoints?: number;

  @ApiProperty({ enum: ['half-up', 'half-even', 'down', 'up'] })
  @IsIn(['half-up', 'half-even', 'down', 'up'])
  public readonly roundingMode!: string;

  /** Lower runs first, and is what a statutory net floor would reduce in reverse. */
  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(0)
  @Max(999)
  public readonly priority!: number;
}

export class OpenPeriodBody {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly payrollGroupId!: string;

  @ApiProperty({ example: '2026-06' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ example: '2026-06-01' })
  @Matches(ISO_DATE)
  public readonly periodStart!: string;

  @ApiProperty({ example: '2026-06-30' })
  @Matches(ISO_DATE)
  public readonly periodEnd!: string;

  /** May fall outside the period, and usually does: work in June is paid in July. */
  @ApiProperty({ example: '2026-07-05' })
  @Matches(ISO_DATE)
  public readonly paymentDate!: string;
}

export class MovePeriodBody {
  @ApiProperty({
    enum: ['draft', 'open', 'calculating', 'calculated', 'approved', 'finalized', 'reversed'],
  })
  @IsIn(['draft', 'open', 'calculating', 'calculated', 'approved', 'finalized', 'reversed'])
  public readonly status!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class CalculateBody {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly payrollPeriodId!: string;

  /** Present resumes or recalculates an existing run. A **finalized** run is refused. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly payrollRunId?: string;

  /** Present on a recalculation: only these employments are recomputed. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public readonly employmentIds?: string[];

  /** How many batches this call runs. A long run is driven by repeated calls, never one request. */
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  public readonly maxBatches?: number;
}

export class DecisionBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly comment?: string;
}

export class ReversalBody {
  @ApiProperty({ example: 'incorrect-input' })
  @Matches(CODE)
  public readonly reasonCode!: string;
}

export class AdjustmentBody {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly payrollRunId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  public readonly employmentId!: string;

  @ApiProperty({ enum: ['earning', 'deduction'] })
  @IsIn(['earning', 'deduction'])
  public readonly kind!: string;

  @ApiProperty({ example: 'late-bonus' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ example: 'ordinary' })
  @IsString()
  @IsNotEmpty()
  public readonly payrollTreatmentCode!: string;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly amount!: MoneyBody;

  @ApiProperty({ example: 'agreed-correction' })
  @Matches(CODE)
  public readonly reasonCode!: string;

  /**
   * The sentence somebody wrote about why a person's pay changed. **Required**, and readable only
   * with `payroll.adjust` — reading a figure is not reading the reason behind it.
   */
  @ApiProperty({ example: 'Agreed with the line manager on 3 July.' })
  @IsString()
  @IsNotEmpty()
  public readonly note!: string;

  /** Set where this corrects a prior period. The closed period's figures never move. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly retroactiveOfPeriodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly retroactiveOfRunId?: string;
}
