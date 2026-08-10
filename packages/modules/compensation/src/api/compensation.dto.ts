import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { RuleDefinition } from '@work/kernel';

import {
  CALCULATION_BASES,
  COMPONENT_KINDS,
  DECISIONS,
  IMPORT_SOURCES,
  RECURRENCES,
  ROUNDING_MODES,
  SCOPES,
  SUBJECT_KINDS,
} from '../domain/compensation-vocabulary.js';

/**
 * The wire shapes, and the two patterns every DTO here shares.
 *
 * **Money arrives as three fields, and the amount is a string.** `amountMinor` is exact minor units
 * as a decimal string — never a JSON number, which loses precision above 2^53 — and it travels with
 * its currency code and the currency's exponent, because nothing in this product publishes an
 * exponent and two decimal places is a habit rather than a rule (D-2).
 *
 * **No body carries a figure this product owns.** There is no minimum wage here, no mandated
 * allowance and no statutory threshold: every bound is a value a tenant or a country pack supplies,
 * and one this product shipped would be wrong in the second country (00B).
 */

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Whole minor units. A decimal point here is a caller who meant a major unit. */
export const MINOR_UNITS_PATTERN = /^\d{1,19}$/;

const MAX_EXPONENT = 4;

export class VersionedBody {
  @ApiProperty({
    description: 'The version read. A write that lost a race is refused, not merged.',
  })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class BilingualNameBody {
  @ApiProperty({ description: 'English. Authored data, not a catalogue key.' })
  @IsString()
  @Length(1, 200)
  public readonly en!: string;

  @ApiProperty({ description: 'Arabic. Required, because half the workforce reads it.' })
  @IsString()
  @Length(1, 200)
  public readonly ar!: string;
}

/** An exact monetary amount. Three fields, and the amount is a string on purpose. */
export class MoneyBody {
  @ApiProperty({
    description: 'Exact minor units, as a decimal string. Never a JSON number.',
    example: '250000',
  })
  @Matches(MINOR_UNITS_PATTERN)
  public readonly amountMinor!: string;

  @ApiProperty({ description: 'ISO 4217, upper case.', example: 'JOD' })
  @Matches(CURRENCY_PATTERN)
  public readonly currencyCode!: string;

  @ApiProperty({
    description: "The currency's decimal places. 2 for SAR, 3 for KWD, 0 for JPY.",
    example: 3,
  })
  @IsInt()
  @Min(0)
  public readonly currencyExponent!: number;
}

export class PayRangeBody {
  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly minimum!: MoneyBody;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly midpoint!: MoneyBody;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly maximum!: MoneyBody;
}

export class DefinePlanBody {
  @ApiProperty({ description: "The tenant's own code, or a country pack's. Never one we ship." })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiProperty({ description: 'The currency an assignment takes when it names none.' })
  @Matches(CURRENCY_PATTERN)
  public readonly defaultCurrencyCode!: string;

  @ApiProperty({ description: "The default currency's decimal places." })
  @IsInt()
  @Min(0)
  public readonly defaultCurrencyExponent!: number;

  @ApiPropertyOptional({ description: 'Optional. Every level of the hierarchy is optional.' })
  @IsOptional()
  @IsUUID()
  public readonly salaryStructureId?: string;

  @ApiPropertyOptional({ description: 'Whether a change under this plan needs a human decision.' })
  @IsOptional()
  @IsBoolean()
  public readonly approvalRequired?: boolean;

  @ApiPropertyOptional({ description: 'How many approvals. Zero means none is required.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly approvalsRequired?: number;

  @ApiPropertyOptional({
    description: 'Change control in basis points. Inert when absent; nothing statutory is implied.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly maximumIncreaseBasisPoints?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly maximumDecreaseBasisPoints?: number;

  @ApiPropertyOptional({ description: 'Set when a country pack authored this version.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly countryPackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly countryPackVersion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly versionNumber?: number;
}

export class AssignPlanBody {
  @ApiProperty({ enum: SCOPES })
  @IsIn([...SCOPES])
  public readonly scope!: string;

  @ApiPropertyOptional({ description: 'Absent for the tenant scope, which names nobody.' })
  @IsOptional()
  @IsUUID()
  public readonly scopeId?: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class PermitComponentBody {
  @ApiProperty()
  @IsUUID()
  public readonly componentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly mandatory?: boolean;

  @ApiPropertyOptional({ type: MoneyBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly minimum?: MoneyBody;

  @ApiPropertyOptional({ type: MoneyBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly maximum?: MoneyBody;
}

export class DefineComponentBody {
  @ApiProperty({ description: "The tenant's own code, or a country pack's." })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiProperty({
    enum: COMPONENT_KINDS,
    description: '`deduction` is deliberately absent: deductions are out of scope for this phase.',
  })
  @IsIn([...COMPONENT_KINDS])
  public readonly kind!: string;

  @ApiProperty({ enum: CALCULATION_BASES })
  @IsIn([...CALCULATION_BASES])
  public readonly calculationBasis!: string;

  @ApiPropertyOptional({ description: 'Required when the basis is a percentage.' })
  @IsOptional()
  @IsUUID()
  public readonly basisComponentId?: string;

  @ApiPropertyOptional({ description: 'Integer basis points — 40% is 4000. Never a float.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly percentageBasisPoints?: number;

  @ApiProperty({ enum: ROUNDING_MODES, description: 'Stated, never defaulted.' })
  @IsIn([...ROUNDING_MODES])
  public readonly roundingMode!: string;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn([...RECURRENCES])
  public readonly recurrence?: string;

  @ApiProperty({
    description: "A code Compensation stores and never interprets. What it means is Payroll's.",
  })
  @Matches(CODE_PATTERN)
  public readonly payrollTreatmentCode!: string;

  @ApiPropertyOptional({ description: 'Whether Payroll may prorate it. A flag, not arithmetic.' })
  @IsOptional()
  @IsBoolean()
  public readonly proratable?: boolean;

  @ApiPropertyOptional({
    description: 'Set by a country pack; null for a tenant-defined component.',
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly statutorySourceCode?: string;

  /**
   * A `RuleDefinition` the kernel engine evaluates.
   *
   * Validated as an object here and by the engine at evaluation time, rather than mirrored field by
   * field at the edge: the rule schema is the kernel's, and a second copy of it in a DTO is a
   * second copy that will disagree.
   */
  @ApiPropertyOptional({ description: 'A RuleDefinition, evaluated by the kernel rule engine.' })
  @IsOptional()
  @IsObject()
  public readonly eligibilityRule?: RuleDefinition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly versionNumber?: number;
}

export { MAX_EXPONENT, DECISIONS, IMPORT_SOURCES, SUBJECT_KINDS };
