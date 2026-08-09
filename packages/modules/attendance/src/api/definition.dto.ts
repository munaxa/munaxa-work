import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  EVENT_KINDS,
  ROUNDING_MODES,
  SEGMENT_KINDS,
  SHIFT_KINDS,
} from '../domain/attendance-vocabulary.js';

import {
  BilingualName,
  CIVIL_DATE_PATTERN,
  CODE_PATTERN,
  WALL_CLOCK_PATTERN,
} from './attendance.dto.js';

/**
 * The wire shapes for defining what people are measured against, and for importing punches.
 *
 * **A schedule's zone is required and there is no default.** Wall-clock times mean nothing without
 * the zone they are meant in, and a defaulted zone would silently file a night shift in Riyadh
 * against UTC — the exact failure this module is built to avoid (ADR-0055).
 *
 * **Nothing statutory ships.** Every tolerance on `DefinePolicyBody` is optional and every
 * unconfigured value is the inert one. A shipped grace period would be this product deciding a
 * labour-relations question for a customer who never asked, and in several markets the answer is
 * statutory and belongs to a country pack (00B).
 *
 * **The import body carries normalized rows, never a vendor payload.** A biometric reader, a
 * turnstile and a QR gate all arrive here as the same shape, produced by an adapter outside this
 * module (ADR-0057).
 */

const MAX_GRACE_MINUTES = 240;
const MAX_FLEX_MINUTES = 720;
const MAX_MINUTES_IN_DAY = 1440;
const MAX_IMPORT_ROWS = 2000;

export class DefineShiftBody {
  @ApiProperty({ example: 'day-shift' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualName })
  @ValidateNested()
  @Type(() => BilingualName)
  public readonly name!: BilingualName;

  @ApiProperty({ enum: SHIFT_KINDS })
  @IsIn(SHIFT_KINDS)
  public readonly kind!: (typeof SHIFT_KINDS)[number];

  @ApiProperty({ example: '08:00', description: 'Wall clock. The schedule says in which zone.' })
  @Matches(WALL_CLOCK_PATTERN)
  public readonly startLocal!: string;

  @ApiProperty({
    example: '17:00',
    description: 'Earlier than the start means it crosses midnight.',
  })
  @Matches(WALL_CLOCK_PATTERN)
  public readonly endLocal!: string;

  @ApiPropertyOptional({ description: 'Required on a flexible shift, forbidden on any other.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FLEX_MINUTES)
  public readonly flexWindowMinutes?: number;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @Matches(WALL_CLOCK_PATTERN)
  public readonly coreStartLocal?: string;

  @ApiPropertyOptional({ example: '15:00' })
  @IsOptional()
  @Matches(WALL_CLOCK_PATTERN)
  public readonly coreEndLocal?: string;

  @ApiPropertyOptional({ description: 'Zero unless the tenant configures one. Nothing ships.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_MINUTES)
  public readonly graceInMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_MINUTES)
  public readonly graceOutMinutes?: number;

  @ApiPropertyOptional({
    description: 'Defaults to the span, less whatever unpaid break it holds.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES_IN_DAY)
  public readonly expectedMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AddSegmentBody {
  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly sequence!: number;

  @ApiProperty({ enum: SEGMENT_KINDS })
  @IsIn(SEGMENT_KINDS)
  public readonly kind!: (typeof SEGMENT_KINDS)[number];

  @ApiProperty({ example: '12:00' })
  @Matches(WALL_CLOCK_PATTERN)
  public readonly startLocal!: string;

  @ApiProperty({ example: '13:00' })
  @Matches(WALL_CLOCK_PATTERN)
  public readonly endLocal!: string;

  @ApiPropertyOptional({
    description: 'Whether a break is paid is a property of the shift, never of the punches.',
  })
  @IsOptional()
  @IsBoolean()
  public readonly paid?: boolean;
}

export class DefineScheduleBody {
  @ApiProperty({ example: 'weekly-office' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualName })
  @ValidateNested()
  @Type(() => BilingualName)
  public readonly name!: BilingualName;

  @ApiProperty({
    example: 'Asia/Riyadh',
    description: 'An IANA zone. Required — and the reason this module needs no location model.',
  })
  @IsString()
  @Length(1, 64)
  public readonly zone!: string;

  @ApiProperty({ description: 'Seven for a week, twenty-eight for a four-week rotation.' })
  @IsInt()
  @Min(1)
  @Max(366)
  public readonly cycleLengthDays!: number;

  @ApiProperty({ example: '2026-05-04', description: 'The date cycle position zero begins on.' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly cycleAnchorDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class PlaceShiftBody {
  @ApiProperty({
    description: 'A position left empty is a rest day, and the absence is the answer.',
  })
  @IsInt()
  @Min(0)
  @Max(365)
  public readonly cyclePosition!: number;

  @ApiProperty()
  @IsUUID()
  public readonly shiftId!: string;
}

export class AssignScheduleBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class EndAssignmentBody {
  @ApiProperty({ example: '2026-05-31', description: 'The last date the assignment covers.' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class DefinePolicyBody {
  @ApiProperty({ example: 'standard' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualName })
  @ValidateNested()
  @Type(() => BilingualName)
  public readonly name!: BilingualName;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional({ description: 'Zero means no rounding, which is what ships.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  public readonly roundingMinutes?: number;

  @ApiPropertyOptional({ enum: ROUNDING_MODES })
  @IsOptional()
  @IsIn(ROUNDING_MODES)
  public readonly roundingMode?: (typeof ROUNDING_MODES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_MINUTES)
  public readonly lateToleranceMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GRACE_MINUTES)
  public readonly earlyDepartureToleranceMinutes?: number;

  @ApiPropertyOptional({ description: 'Two punches of one kind inside this window are flagged.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly duplicateWindowSeconds?: number;

  @ApiPropertyOptional({ description: 'Beyond this drift a client clock is disbelieved.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly clockSkewToleranceSeconds?: number;

  @ApiPropertyOptional({
    description: 'Worked time beyond the expected day plus this is candidate.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES_IN_DAY)
  public readonly overtimeThresholdMinutes?: number;

  @ApiPropertyOptional({
    description: 'Whether unapproved overtime blocks sign-off. A jurisdiction question, not ours.',
  })
  @IsOptional()
  @IsBoolean()
  public readonly overtimeRequiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly absenceBlocksApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

/** One normalized punch from an adapter. No vendor field reaches this module (ADR-0057). */
export class ImportRowBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ enum: EVENT_KINDS })
  @IsIn(EVENT_KINDS)
  public readonly kind!: (typeof EVENT_KINDS)[number];

  @ApiProperty({ description: 'When it happened, as the originating system recorded it.' })
  @Type(() => Date)
  @IsDate()
  public readonly reportedAt!: Date;

  @ApiPropertyOptional({
    description: "The row's own identifier. What makes a re-run skip rather than duplicate.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly sourceReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly deviceReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class ImportEventsBody {
  @ApiPropertyOptional({ description: 'What produced this batch, for the operator who reads it.' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly sourceLabel?: string;

  @ApiProperty({ type: [ImportRowBody], description: 'Bounded, so one request cannot be a job.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowBody)
  public readonly rows!: ImportRowBody[];
}

export const IMPORT_ROW_LIMIT = MAX_IMPORT_ROWS;
