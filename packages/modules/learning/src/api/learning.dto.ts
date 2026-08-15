import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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

import {
  COURSE_DELIVERIES,
  MAX_RECURRENCE_MONTHS,
  PATH_KINDS,
} from '../domain/learning-vocabulary.js';

/**
 * The wire shapes Learning accepts, and the four rules that run through every one of them.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and a
 * rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped — which is what stops a client from smuggling a field the API never declared
 * into a command.
 *
 * **A civil date is `YYYY-MM-DD` and stays a string.** Matched as a pattern and passed through
 * untouched: a due date, an expiry and a completion day are the same day in every time zone, the
 * domain compares them as strings, and there is no `Date` anywhere on this path to get wrong.
 *
 * **A mark is text, and it is never parsed.** `raw_mark` is the tenant's own value; `18.50` typed by
 * an assessor stays `18.50` through the DTO, the command, the column and the response. Nothing in
 * this module computes with it, so nothing may normalize it — a parse would hand back `18.5`.
 *
 * **Every shape that touches an existing row carries `expectedVersion`**, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change, and the refusal it earns is a 409.
 *
 * **No shape here carries an actor.** The acting identity comes from the authenticated request
 * context and nowhere else; a body that could name its own author is a body that could name somebody
 * else's — and in this module that would be a completion, a waiver or a certificate under a
 * colleague's name.
 *
 * Every enumeration is **derived from the domain vocabulary rather than retyped**, so a value the
 * domain adds is one this file offers and one it removes is a compile error here.
 */

/** A code: ASCII, because it travels into exports and configuration files. */
export const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** A civil date. Somebody's training is due on a date, not at an instant. */
export const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A mark, as the tenant typed it.
 *
 * The same shape the domain enforces — up to twelve integer digits and four decimals — declared here
 * so a malformed value is a 400 at the edge rather than a 422 from the aggregate. It is matched, not
 * parsed: the string that arrives is the string that is stored.
 */
export const EXACT_MARK = /^-?\d{1,12}(\.\d{1,4})?$/;

/** A free-text field a person writes. Bounded so a request cannot be a denial of service. */
export const TEXT = 4000;
const REASON = 1024;

export class LocalizedTextBody {
  @ApiProperty({ example: 'Fire safety' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public readonly en!: string;

  @ApiProperty({ example: 'السلامة من الحرائق' })
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

/** A reason somebody wrote. Required where the act needs one — a waiver, a revocation. */
export class ReasonedBody extends VersionedBody {
  @ApiProperty({ example: 'Holds an equivalent licence' })
  @IsString()
  @IsNotEmpty()
  @Length(1, REASON)
  public readonly reason!: string;
}

// ------------------------------------------------------------------------------------------------
// Catalogue
// ------------------------------------------------------------------------------------------------

export class CreateCategoryBody {
  @ApiProperty({ example: 'safety' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;
}

export class CreateCourseBody {
  @ApiProperty({ example: 'fire-safety' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly categoryId?: string;

  @ApiProperty({ enum: COURSE_DELIVERIES })
  @IsIn([...COURSE_DELIVERIES])
  public readonly delivery!: string;
}

/**
 * What may be amended on a course.
 *
 * `code` and `delivery` are absent deliberately: the code is what a tenant's own records refer to,
 * and a delivery mode changing under an enrolment would misdescribe a course somebody already sat.
 * What a course *teaches* is versioned and unreachable from here.
 */
export class UpdateCourseBody extends VersionedBody {
  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name?: LocalizedTextBody;

  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly description?: LocalizedTextBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly categoryId?: string;
}

const MAX_DURATION_MINUTES = 60 * 24 * 365;
const MAX_VALID_MONTHS = 600;

/**
 * A new version of a course, and the course move that publishes it.
 *
 * The **version number is not on the wire**. It is derived from what is already there, because a
 * caller-supplied number would let two administrators publish "version 4" twice and the unique index
 * would refuse the second with an error nobody could act on. `expectedVersion` is the course's, and
 * it is what actually settles the race.
 */
export class PublishCourseVersionBody extends VersionedBody {
  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly title!: LocalizedTextBody;

  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly objectives?: LocalizedTextBody;

  @ApiPropertyOptional({
    description: 'An opaque key. Nothing in this product resolves, uploads or downloads it.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly contentReference?: string;

  @ApiPropertyOptional({ example: 480 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  public readonly durationMinutes?: number;

  @ApiProperty({
    example: true,
    description: 'Whether completion needs a passed assessment. Tenant configuration, not a rule.',
  })
  @IsBoolean()
  public readonly requiresAssessment!: boolean;

  @ApiPropertyOptional({ example: 12, description: 'Whole months a certification stays valid.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VALID_MONTHS)
  public readonly certificationValidMonths?: number;
}

// ------------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------------

export class CreatePathBody {
  @ApiProperty({ example: 'induction' })
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

  @ApiProperty({ enum: PATH_KINDS, description: 'A label. Nothing in this module branches on it.' })
  @IsIn([...PATH_KINDS])
  public readonly kind!: string;
}

const MAX_SEQUENCE = 500;

export class AddPathStepBody {
  @ApiProperty()
  @IsUUID()
  public readonly courseId!: string;

  @ApiProperty({ example: 1, description: 'An order, not a gate. No prerequisite is enforced.' })
  @IsInt()
  @Min(1)
  @Max(MAX_SEQUENCE)
  public readonly sequence!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  public readonly optional!: boolean;
}

// ------------------------------------------------------------------------------------------------
// Mandatory rules
// ------------------------------------------------------------------------------------------------

const MAX_DUE_WITHIN_DAYS = 3650;

export class DefineMandatoryRuleBody {
  @ApiProperty()
  @IsUUID()
  public readonly courseId!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty({ enum: ['compliance', 'safety', 'policy', 'orientation', 'role_based'] })
  @IsIn(['compliance', 'safety', 'policy', 'orientation', 'role_based'])
  public readonly kind!: string;

  @ApiProperty({ enum: ['everybody', 'organization_unit', 'position'] })
  @IsIn(['everybody', 'organization_unit', 'position'])
  public readonly audience!: string;

  @ApiPropertyOptional({
    description: 'Required where the audience is a unit. Confirmed upstream.',
  })
  @IsOptional()
  @IsUUID()
  public readonly organizationUnitId?: string;

  @ApiPropertyOptional({ description: 'Required where the audience is a position.' })
  @IsOptional()
  @IsUUID()
  public readonly positionId?: string;

  @ApiProperty({ example: '2024-01-01' })
  @Matches(CIVIL_DATE)
  public readonly effectiveFrom!: string;

  @ApiProperty({ example: 12, description: 'Whole months. `0` never repeats.' })
  @IsInt()
  @Min(0)
  @Max(MAX_RECURRENCE_MONTHS)
  public readonly recurrenceMonths!: number;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(0)
  @Max(MAX_DUE_WITHIN_DAYS)
  public readonly dueWithinDays!: number;
}

/**
 * One page of a reconciliation run.
 *
 * **Paged, not offset**, because every published search contract in this repository is page-based
 * and the audience is resolved through one of them. Nothing schedules this: an administrator sends
 * it, and scheduled execution is `NOT VERIFIED`.
 */
export class ReconcileBody {
  @ApiPropertyOptional({
    example: 200,
    description: 'Employments to examine. Clamped by the handler.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  public readonly limit?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'One-based. The result says whether more remain.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly page?: number;
}
