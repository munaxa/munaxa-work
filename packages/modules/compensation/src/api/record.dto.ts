import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { DECISIONS, IMPORT_SOURCES, SUBJECT_KINDS } from '../domain/compensation-vocabulary.js';

import { CIVIL_DATE_PATTERN, CODE_PATTERN, MoneyBody } from './compensation.dto.js';

/**
 * The bodies that carry **somebody's pay**: assignments, amendments, one-time items, adjustments,
 * decisions and imports.
 *
 * Apart from `structure.dto.ts`, which carries the catalogue. The distinction is worth being able to
 * see in the file list: a malformed grade is a configuration mistake, and a malformed assignment is
 * a mistake about a person's salary.
 */

export class AssignRecurringBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly componentId!: string;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly amount!: MoneyBody;

  @ApiProperty({ example: '2026-03-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional({ description: 'The amount is checked against this grade at that date.' })
  @IsOptional()
  @IsUUID()
  public readonly payGradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly payScaleId?: string;

  @ApiPropertyOptional({ description: "The step's amount is copied, never joined." })
  @IsOptional()
  @IsUUID()
  public readonly salaryStepId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class AmendRecurringBody {
  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly amount!: MoneyBody;

  @ApiProperty({ example: '2026-07-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;

  @ApiProperty({
    description: 'The version read. A write that lost a race is refused, not merged.',
  })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class EndRecurringBody {
  @ApiProperty({ example: '2026-12-31' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class RecordOneTimeBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly componentId!: string;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly amount!: MoneyBody;

  @ApiProperty({
    example: '2026-03-15',
    description: "When it becomes payable. Which period pays it is Payroll's decision.",
  })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly payableOn!: string;

  @ApiProperty({ description: 'Required. A discretionary payment needs an explanation.' })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;

  @ApiPropertyOptional({
    description: "The caller's own identifier. Makes a resubmission a no-op.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly sourceId?: string;
}

export class RecordAdjustmentBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly componentId!: string;

  @ApiProperty({
    description: 'A code — merit, promotion, correction, market. The tenant names it.',
  })
  @Matches(CODE_PATTERN)
  public readonly adjustmentType!: string;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly newAmount!: MoneyBody;

  @ApiProperty({ example: '2026-04-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiProperty({ description: 'Required. This is the movement no rule produced.' })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;

  @ApiProperty({ description: 'Required, and written by a human. What an auditor reads first.' })
  @IsString()
  @Length(1, 1024)
  public readonly note!: string;
}

export class DecisionBody {
  @ApiProperty({ enum: SUBJECT_KINDS })
  @IsIn([...SUBJECT_KINDS])
  public readonly subjectKind!: string;

  @ApiProperty()
  @IsUUID()
  public readonly subjectId!: string;

  @ApiProperty({ enum: DECISIONS, description: 'Two outcomes. "Deferred" is not a decision.' })
  @IsIn([...DECISIONS])
  public readonly decision!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly comment?: string;
}

export class ReverseDecisionBody {
  @ApiProperty({ description: 'The decision being reversed. It stays in the chain.' })
  @IsUUID()
  public readonly decisionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly comment?: string;
}

export class ImportRowBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly componentId!: string;

  @ApiProperty({ type: MoneyBody })
  @ValidateNested()
  @Type(() => MoneyBody)
  public readonly amount!: MoneyBody;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly payGradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly salaryStepId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiProperty({ description: "The caller's own row identifier. What makes a retry write once." })
  @IsString()
  @Length(1, 128)
  public readonly sourceId!: string;
}

export class ImportBody {
  @ApiProperty({ enum: IMPORT_SOURCES })
  @IsIn([...IMPORT_SOURCES])
  public readonly source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly sourceLabel?: string;

  @ApiProperty({ type: [ImportRowBody], description: 'Bounded. A batch takes a page.' })
  @ValidateNested({ each: true })
  @Type(() => ImportRowBody)
  public readonly rows!: readonly ImportRowBody[];
}
