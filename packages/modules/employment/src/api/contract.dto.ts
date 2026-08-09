import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PROBATION_OUTCOMES, type ProbationOutcome } from '../domain/employment-vocabulary.js';

/**
 * The contract and probation wire shapes.
 *
 * Two absences are the design rather than an oversight.
 *
 * **No money.** A contract records terms, and salary is Compensation's (Phase 10). A field here
 * would be the first place two modules disagreed about what somebody is paid.
 *
 * **No `failed` probation outcome.** A probation somebody did not pass ends the employment, through
 * the ending operation with its own permission and its own reason. Recording a failure here would
 * leave the employment reading `active` while the business believed it was over.
 */

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;

export class RecordContractBody {
  @ApiPropertyOptional({ example: 'C-2026-0042' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly contractNumber?: string;

  @ApiProperty({ example: 'fixed-term', description: 'A tenant or country-pack code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly contractTypeCode!: string;

  @ApiProperty({ example: '2026-01-15' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly startDate!: string;

  @ApiPropertyOptional({ example: '2027-01-14' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly endDate?: string;

  @ApiPropertyOptional({
    example: '2026-04-15',
    description:
      'Recorded, never validated against a statutory maximum — that is a country pack’s.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly probationEndDate?: string;

  @ApiPropertyOptional({
    example: 30,
    description:
      'What the parties agreed. A statutory minimum that may override it is Phase 11.1’s.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  public readonly noticePeriodDays?: number;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(168)
  public readonly workingHoursPerWeek?: number;

  @ApiPropertyOptional({
    example: 'doc:contract:2026:0042',
    description:
      'A reference into the document store. Employment holds no bytes and owns no documents.',
  })
  @IsOptional()
  @Matches(DOCUMENT_REFERENCE_PATTERN)
  public readonly documentReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom?: string;
}

export class ConcludeProbationBody {
  @ApiProperty({
    enum: PROBATION_OUTCOMES,
    description:
      'There is no failed outcome: a probation somebody did not pass ends the employment, with its own reason and its own permission.',
  })
  @IsIn(PROBATION_OUTCOMES)
  public readonly outcome!: ProbationOutcome;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class ImportRowBody {
  @ApiProperty()
  @IsString()
  @Length(36, 36)
  public readonly personId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly externalEmployeeNumber?: string;

  @ApiProperty({ example: 'full-time' })
  @Matches(CODE_PATTERN)
  public readonly employmentTypeCode!: string;

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
  @Matches(CIVIL_DATE_PATTERN)
  public readonly originalHireDate?: string;

  @ApiProperty({ example: '2026-01-15' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly startDate!: string;
}
