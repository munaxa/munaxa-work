import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
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

import { DAY_PORTIONS, DECISIONS, ENTITLEMENT_SOURCES } from '../domain/leave-vocabulary.js';

import {
  CIVIL_DATE_PATTERN,
  CODE_PATTERN,
  VersionedBody,
  WALL_CLOCK_PATTERN,
} from './definition.dto.js';

/**
 * The wire shapes for asking for leave, deciding it, and moving a balance by hand.
 *
 * **No body names an approver and no body names a requester.** Both are taken from the
 * authenticated context. An approval a caller could attribute to a colleague is not evidence that
 * anybody looked at the request, and the database refuses a decision whose `decided_by` equals its
 * `requested_by` — a comparison that is only meaningful because neither value came from the wire.
 *
 * **A `justification` is sensitive.** On a sick-leave request it is close to health data, which is
 * why it is optional, bounded, and never echoed into an event or a history row (§30).
 */

const MAX_TEXT = 1024;
const MAX_REFERENCE = 512;

export class PortionBody {
  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly onDate!: string;

  @ApiProperty({ enum: DAY_PORTIONS })
  @IsIn([...DAY_PORTIONS])
  public readonly portion!: string;

  @ApiPropertyOptional({ description: 'Wall clock, for an hourly portion only.' })
  @IsOptional()
  @Matches(WALL_CLOCK_PATTERN)
  public readonly startLocal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(WALL_CLOCK_PATTERN)
  public readonly endLocal?: string;
}

export class RaiseRequestBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly leaveTypeId!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly fromDate!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly toDate!: string;

  @ApiPropertyOptional({
    type: [PortionBody],
    description: 'Per-date portions. A date not named here is a full day.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PortionBody)
  public readonly portions?: readonly PortionBody[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional({
    description: "The requester's own words. Sensitive; bounded; never logged.",
  })
  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT)
  public readonly justification?: string;

  @ApiPropertyOptional({ description: 'Who covers the work. Not who covers the authority.' })
  @IsOptional()
  @IsUUID()
  public readonly replacementEmploymentId?: string;

  @ApiPropertyOptional({ description: "A reference to Identity's delegation. Never created here." })
  @IsOptional()
  @IsUUID()
  public readonly delegationId?: string;

  @ApiPropertyOptional({ description: 'A reference. Leave stores no bytes and verifies nothing.' })
  @IsOptional()
  @IsString()
  @Length(0, MAX_REFERENCE)
  public readonly attachmentReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 255)
  public readonly contactDuringAbsence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, MAX_REFERENCE)
  public readonly addressDuringAbsence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class DecideBody extends VersionedBody {
  @ApiProperty({
    enum: DECISIONS,
    description: 'The decision. The decider comes from the context.',
  })
  @IsIn([...DECISIONS])
  public readonly decision!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT)
  public readonly comment?: string;
}

export class CancelBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class AmendBody extends VersionedBody {
  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly fromDate!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly toDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly leaveTypeId?: string;

  @ApiPropertyOptional({ type: [PortionBody] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PortionBody)
  public readonly portions?: readonly PortionBody[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class GrantEntitlementBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly leaveTypeId!: string;

  @ApiProperty({ description: 'Any date inside the leave year the grant belongs to.' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly onDate!: string;

  @ApiProperty({ description: 'Integer minutes. Never a fractional day.' })
  @IsInt()
  @Min(1)
  public readonly grantedMinutes!: number;

  @ApiProperty({ enum: ENTITLEMENT_SOURCES })
  @IsIn([...ENTITLEMENT_SOURCES])
  public readonly source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class AdjustBalanceBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly leaveTypeId!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveOn!: string;

  @ApiProperty({ description: 'Signed integer minutes. Zero is refused: it moves nothing.' })
  @IsInt()
  public readonly minutes!: number;

  @ApiProperty({
    description: 'Required. An adjustment nobody can explain is one nobody can defend.',
  })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;

  @ApiProperty({ description: 'Required, and written by a human rather than chosen from a list.' })
  @IsString()
  @Length(1, MAX_TEXT)
  public readonly note!: string;
}

export class RunAccrualBody {
  @ApiProperty()
  @IsUUID()
  public readonly leavePolicyId!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly periodStart!: string;

  @ApiProperty()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly periodEnd!: string;

  @ApiPropertyOptional({
    description: 'The page of employments a run covers. Bounded, so it finishes.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly limit?: number;
}

export class LeaveYearBody {
  @ApiProperty()
  @IsUUID()
  public readonly leavePolicyId!: string;

  @ApiProperty({ description: 'Any date inside the year.' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly onDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly limit?: number;
}
