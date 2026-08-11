import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
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

import { CYCLE_STATUSES } from '../domain/performance-vocabulary.js';

/**
 * The wire shapes for configuration: rating scales, competency frameworks, templates and goal
 * categories.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and
 * a rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped — which is what stops a client from smuggling a field the API never
 * declared into a command.
 *
 * Three rules run through every DTO in this module.
 *
 * **A score is a whole number of hundredths and a weight a whole number of basis points.** `@IsInt`
 * everywhere, never `@IsNumber`. `4.00` on the wire is `400`, and `40%` is `4000`. The API does not
 * accept a decimal and does not convert one: a float that arrived here would be a float the engine
 * never saw, and the two would disagree in the fourth place years later.
 *
 * **A civil date is `YYYY-MM-DD`.** Matched as a pattern rather than parsed as a `Date`, because a
 * start date is the same date in every time zone and an ISO instant is not.
 *
 * **Every shape that touches an existing row carries `expectedVersion`**, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change.
 *
 * Nothing in this file is a persistence model. A DTO is the request's shape; the view a handler
 * returns is assembled separately, so a column rename is not an API change.
 */

/** A code: ASCII, because it travels into exports and configuration files. */
export const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
/** A civil date. A cycle's start is the same date in every time zone. */
export const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An exact decimal integer, as text. A JSON number above 2^53 is not the number that was sent. */
export const EXACT_INTEGER = /^-?\d{1,30}$/;

/** Basis points: 10,000 is one whole. Nothing in this module weights beyond 100%. */
export const MAX_BASIS_POINTS = 10_000;
/** Hundredths: 1,000,000 is 10,000 points, far beyond any scale a customer would configure. */
export const MAX_SCORE_HUNDREDTHS = 1_000_000;

export class LocalizedTextBody {
  @ApiProperty({ example: 'Annual review' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public readonly en!: string;

  @ApiProperty({ example: 'المراجعة السنوية' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public readonly ar!: string;
}

/** Present on every shape that changes an existing row. See the file comment. */
export class VersionedBody {
  @ApiProperty({ example: 1, description: 'The version the client read. A stale value is a 409.' })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class RatingLevelBody {
  @ApiProperty({ example: 'meets' })
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

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(100)
  public readonly ordinal!: number;

  /** Hundredths. `300` is a rating of 3.00, and the domain refuses a band that overlaps another. */
  @ApiProperty({ example: 300, description: 'Hundredths of a point. 300 is 3.00.' })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly minimumScore!: number;

  @ApiProperty({ example: 399 })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly maximumScore!: number;
}

export class DefineRatingScaleBody {
  @ApiProperty({ example: 'annual-1-5' })
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

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly minimumScore!: number;

  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly maximumScore!: number;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly effectiveTo?: string;

  @ApiProperty({ type: [RatingLevelBody] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RatingLevelBody)
  public readonly levels!: readonly RatingLevelBody[];
}

export class DefineFrameworkBody {
  @ApiProperty({ example: 'core' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  public readonly frameworkVersion!: number;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly description?: LocalizedTextBody;

  @ApiProperty({ description: 'Whether competencies carry their own weights.' })
  @IsBoolean()
  public readonly weighted!: boolean;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly effectiveTo?: string;
}

export class CompetencyLevelBody {
  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(100)
  public readonly ordinal!: number;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiPropertyOptional({ type: [LocalizedTextBody] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LocalizedTextBody)
  public readonly behaviouralIndicators?: readonly LocalizedTextBody[];

  @ApiProperty({ example: 300, description: 'Hundredths of a point.' })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly score!: number;
}

export class DefineCompetencyBody {
  @ApiProperty()
  @IsUUID()
  public readonly frameworkId!: string;

  @ApiProperty({ example: 'collaboration' })
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

  @ApiProperty({ example: 'core', description: 'A tenant value, not an enumeration this ships.' })
  @IsString()
  @Length(1, 64)
  public readonly category!: string;

  /** Refused by the domain unless the framework is weighted. Absent is not zero. */
  @ApiPropertyOptional({ example: 2500, description: 'Basis points. 2500 is 25%.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly weightBasisPoints?: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  public readonly displayOrder!: number;

  @ApiProperty({ type: [CompetencyLevelBody] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CompetencyLevelBody)
  public readonly levels!: readonly CompetencyLevelBody[];
}

export class DefineGoalCategoryBody {
  @ApiProperty({ example: 'business' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;
}

export class SetGoalCategoryActiveBody extends VersionedBody {
  @ApiProperty()
  @IsBoolean()
  public readonly active!: boolean;
}

/**
 * The statuses a generic move may reach.
 *
 * `closed` and `cancelled` are excluded here as well as refused by the handler. Both carry
 * something the generic move has nowhere to put — a closing actor, a cancellation reason — and a
 * cycle that reached `closed` through this route would be a closed cycle with nobody's name against
 * it. Derived from the vocabulary rather than retyped, so a new status is a compile error here
 * rather than a route that silently refuses it.
 */
const MOVEABLE_CYCLE_STATUSES = CYCLE_STATUSES.filter(
  (status) => status !== 'closed' && status !== 'cancelled',
);

export class MoveCycleBody extends VersionedBody {
  @ApiProperty({ enum: MOVEABLE_CYCLE_STATUSES })
  @IsIn(MOVEABLE_CYCLE_STATUSES)
  public readonly status!: string;
}

export class CancelCycleBody extends VersionedBody {
  @ApiProperty({ example: 'Reorganization deferred the cycle.' })
  @IsString()
  @Length(1, 1000)
  public readonly reason!: string;
}
