import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
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

import { CODE, LocalizedTextBody, MAX_BASIS_POINTS } from './performance.dto.js';

/**
 * A review template: which components a review has, and what each is worth.
 *
 * Weights are **basis points that the domain requires to total 10,000**, refused rather than
 * normalized. A template whose weights were silently rescaled would produce scores nobody could
 * reconcile against the configuration screen.
 *
 * `requiresSelfAssessment` and `requiresPeerAssessment` say whether one is **expected**, not what it
 * is worth. Neither contributes to the score, there is no weight for either, and no field here
 * invents one.
 */

export class TemplateComponentBody {
  @ApiProperty({ example: 'goals', enum: ['goals', 'competencies', 'values', 'objectives'] })
  @IsString()
  @Length(1, 64)
  public readonly component!: string;

  @ApiProperty({
    example: 6000,
    description: 'Basis points. The domain refuses a total above 100%.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly weightBasisPoints!: number;
}

export class DefineTemplateBody {
  @ApiProperty({ example: 'annual' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly description?: LocalizedTextBody;

  @ApiProperty()
  @IsUUID()
  public readonly ratingScaleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly competencyFrameworkId?: string;

  /**
   * Self and peer assessments are **recorded and readable, and contribute nothing to the score**.
   * These flags say whether one is expected, not what it is worth — there is no weight for either
   * and none is invented here.
   */
  @ApiProperty()
  @IsBoolean()
  public readonly requiresSelfAssessment!: boolean;

  @ApiProperty()
  @IsBoolean()
  public readonly requiresPeerAssessment!: boolean;

  @ApiProperty()
  @IsBoolean()
  public readonly requiresCalibration!: boolean;

  @ApiProperty({ example: 10_000, description: 'Basis points a cycle’s goals must total.' })
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly goalWeightTotalBasisPoints!: number;

  /**
   * Below this many responses the multi-rater aggregate is **withheld**, not anonymized. Withholding
   * a number is the only protection this architecture provides; `created_by` still exists.
   */
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  public readonly minimumPeerResponses?: number;

  @ApiProperty({ type: [TemplateComponentBody] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentBody)
  public readonly components!: readonly TemplateComponentBody[];
}
