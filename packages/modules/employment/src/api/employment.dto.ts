import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '../domain/employment-vocabulary.js';

/**
 * The wire shapes.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and
 * a rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped.
 *
 * **No body here carries an employment number.** It is generated, and a request that could supply
 * one would be a request that could reuse one (ADR-0039). A customer's own number travels in
 * `externalEmployeeNumber`, which is a different field with a different meaning and no uniqueness
 * pretence beyond its own index.
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change.
 *
 * Codes are **tenant or country-pack values**, and the examples below are illustrative rather than
 * a list this product ships — `full-time` is what one customer calls it, not an enumeration (00B).
 */

/** A code: ASCII, because it travels into payroll files and government uploads. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A civil date. A start date is the same date in every time zone. */
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEmploymentBody {
  @ApiProperty({
    description: "The Person this employment is for. People's identifier, not a new one.",
  })
  @IsUUID()
  public readonly personId!: string;

  @ApiPropertyOptional({
    example: 'LEGACY-4471',
    description:
      "The customer's own employee number, carried through a migration. The Munaxa employment number is generated and cannot be supplied.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly externalEmployeeNumber?: string;

  @ApiProperty({ example: 'full-time', description: 'A tenant or country-pack code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly employmentTypeCode!: string;

  @ApiPropertyOptional({ example: 'staff' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentCategoryCode?: string;

  @ApiPropertyOptional({ example: 'grade-b' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentClassCode?: string;

  @ApiPropertyOptional({
    example: '2019-04-01',
    description:
      'The first day this person ever worked here. Supplied on a rehire so accrued service is not reset. Defaults to the start date.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly originalHireDate?: string;

  @ApiProperty({ example: '2026-01-15' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly startDate!: string;

  @ApiPropertyOptional({ description: 'Tenant-authored, stored and never interpreted.' })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AmendEmploymentBody {
  @ApiPropertyOptional({ example: 'part-time' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentTypeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentCategoryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentClassCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly externalEmployeeNumber?: string;

  @ApiPropertyOptional({
    example: '2026-02-01',
    description: 'A correction. Refused once the employment is in force.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly startDate?: string;

  @ApiProperty({ description: 'The version the caller read. Required.' })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class ReviseMetadataBody {
  @ApiProperty()
  @IsObject()
  public readonly metadata!: Record<string, string>;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class ChangeStatusBody {
  @ApiProperty({
    enum: EMPLOYMENT_STATUSES.filter((status) => status !== 'ended'),
    description:
      'Ending is a separate operation with its own permission: it is terminal, and it is what final settlement reads.',
  })
  @IsIn(EMPLOYMENT_STATUSES.filter((status) => status !== 'ended'))
  public readonly status!: Exclude<EmploymentStatus, 'ended'>;

  @ApiPropertyOptional({ example: 'investigation', description: 'A tenant-supplied code (00B).' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;

  @ApiPropertyOptional({ description: 'When the change takes effect. Defaults to now.' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class EndEmploymentBody {
  @ApiProperty({ example: '2026-09-30' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly endDate!: string;

  @ApiProperty({
    example: 'resignation',
    description:
      'A tenant or country-pack code. Resignation, dismissal and end-of-contract carry different statutory consequences in every market, so the list is never one this product ships (00B).',
  })
  @Matches(CODE_PATTERN)
  public readonly endReasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class AssignmentBody {
  @ApiProperty({ description: "An organization unit. Organization's identifier, not a copy." })
  @IsUUID()
  public readonly unitId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly positionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly costCenterId?: string;

  @ApiPropertyOptional({
    enum: ['primary', 'secondary'],
    description: 'Defaults to primary. An employment has at most one primary in force at a time.',
  })
  @IsOptional()
  @IsIn(['primary', 'secondary'])
  public readonly assignmentType?: 'primary' | 'secondary';

  @ApiPropertyOptional({
    example: 1,
    description: "This assignment's share of a working pattern. Never a share of a salary.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(1)
  public readonly fte?: number;

  @ApiPropertyOptional({ example: 'transfer' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional({
    description: 'When the placement takes effect. Back-dating is handled properly.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom?: string;
}

export class ChangeManagerBody {
  @ApiProperty({
    description:
      "The manager's **employment**, never their person. A manager is a job, not a name.",
  })
  @IsUUID()
  public readonly managerEmploymentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom?: string;
}
