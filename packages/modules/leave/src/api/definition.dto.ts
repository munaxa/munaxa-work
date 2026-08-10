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

import { LEAVE_UNITS } from '../domain/leave-vocabulary.js';

/**
 * The wire shapes for configuring what may be requested, and the patterns every DTO here shares.
 *
 * **No body carries a figure this product owns.** There is no pay rate, no entitlement default and
 * no statutory threshold here: every limit is a value a tenant or a country pack supplies, and one
 * this product shipped would be wrong in the second country (00B). The `limits`, `accrual`,
 * `carryOver` and `leaveYear` groups are open objects validated by the domain rather than
 * enumerated here, because enumerating thirty optional numbers at the edge would mean maintaining
 * the policy model twice.
 */

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

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

export class DefineLeaveTypeBody {
  @ApiProperty({ description: "The tenant's own code, or a country pack's. Never one we ship." })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiProperty({
    enum: LEAVE_UNITS,
    description: 'What the type is expressed in. Storage is minutes.',
  })
  @IsIn([...LEAVE_UNITS])
  public readonly unit!: string;

  @ApiProperty({
    description: 'A code Leave stores and never interprets. What "paid" costs is Payroll\'s.',
  })
  @Matches(CODE_PATTERN)
  public readonly paidTreatmentCode!: string;

  @ApiPropertyOptional({ description: 'Whether the type has entitlement at all.' })
  @IsOptional()
  @IsBoolean()
  public readonly accrues?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly requiresAttachment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly requiresReplacement?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly requiresContact?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly requiresAddress?: boolean;

  @ApiPropertyOptional({
    description: 'A code, not an enumeration: maternity and Iddah exist without us naming them.',
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly genderRestriction?: string;

  @ApiPropertyOptional({ description: 'Set by a country pack. Null for a tenant-defined type.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly statutorySourceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class DefineLeavePolicyBody {
  @ApiProperty()
  @IsUUID()
  public readonly leaveTypeId!: string;

  @ApiProperty()
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiProperty({ description: 'A civil date, in the form YYYY-MM-DD.' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional({
    description: 'How many distinct humans must decide. Zero means no approval is required.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly approvalsRequired?: number;

  @ApiPropertyOptional({ description: 'Limits. Every one is optional and inert until set.' })
  @IsOptional()
  @IsObject()
  public readonly limits?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Accrual. Nothing statutory; the amount is configuration.' })
  @IsOptional()
  @IsObject()
  public readonly accrual?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly carryOver?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Which calendar the leave year is reckoned in, and when.' })
  @IsOptional()
  @IsObject()
  public readonly leaveYear?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AssignPolicyBody {
  @ApiProperty({ enum: ['tenant', 'legal_entity', 'unit', 'employment'] })
  @IsIn(['tenant', 'legal_entity', 'unit', 'employment'])
  public readonly scope!: string;

  @ApiPropertyOptional({ description: 'Absent for the tenant scope; required for every other.' })
  @IsOptional()
  @IsUUID()
  public readonly scopeId?: string;

  @ApiProperty()
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
