import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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

import {
  BilingualNameBody,
  CIVIL_DATE_PATTERN,
  CODE_PATTERN,
  MoneyBody,
  PayRangeBody,
} from './compensation.dto.js';

/**
 * The wire shapes for the salary hierarchy: structures, grades, scales and steps.
 *
 * Apart from `compensation.dto.ts` because a single DTO file for a fourteen-table module runs well
 * past its budget, and apart from `record.dto.ts` because these are the *catalogue* rather than
 * somebody's pay.
 */

export class DefineStructureBody {
  @ApiProperty()
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly description?: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;
}

export class DefineGradeBody {
  @ApiPropertyOptional({ description: 'Optional. A grade may stand outside any structure.' })
  @IsOptional()
  @IsUUID()
  public readonly salaryStructureId?: string;

  @ApiProperty()
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly description?: string;

  @ApiProperty({ type: PayRangeBody })
  @ValidateNested()
  @Type(() => PayRangeBody)
  public readonly range!: PayRangeBody;

  @ApiPropertyOptional({
    description:
      "Organization's opaque job-architecture label, as a label rather than a foreign key.",
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly positionGradeLabel?: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;
}

export class DefineScaleBody {
  @ApiProperty()
  @IsUUID()
  public readonly payGradeId!: string;

  @ApiProperty()
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualNameBody })
  @ValidateNested()
  @Type(() => BilingualNameBody)
  public readonly name!: BilingualNameBody;

  @ApiProperty({ type: PayRangeBody })
  @ValidateNested()
  @Type(() => PayRangeBody)
  public readonly range!: PayRangeBody;

  @ApiProperty({
    description: 'A code, stored and never acted on. Nothing here moves anybody between steps.',
  })
  @Matches(CODE_PATTERN)
  public readonly progressionModel!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly effectiveTo?: string;
}

export class DefineStepBody {
  @ApiPropertyOptional({ description: 'A step belongs to a scale **or** a grade — exactly one.' })
  @IsOptional()
  @IsUUID()
  public readonly payScaleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly payGradeId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly stepNumber!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly code?: string;

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
}
