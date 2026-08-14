import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
  CAREER_PATH_KINDS,
  CAREER_PLAN_STATUSES,
  MAX_STAGE_SEQUENCE,
  TALENT_POOL_KINDS,
} from '../domain/career-vocabulary.js';

/**
 * The wire shapes Career accepts, and the five rules that run through every one of them.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and a
 * rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped — which is what stops a client from smuggling a field the API never declared
 * into a command, and in this module the field somebody would try is a criticality or a band.
 *
 * **A civil date is `YYYY-MM-DD` and stays a string.** Matched as a pattern here and passed through
 * untouched: a start day, a target day, an assessment day and an expiry are the same day in every
 * time zone, the domain compares them as strings, and there is no `Date` anywhere on this path to
 * get wrong.
 *
 * **The pattern is a shape check, not a calendar.** `2026-02-30` matches `\d{4}-\d{2}-\d{2}`, and it
 * is the domain's `isCivilDate` — which parses and compares the result back to the string it came
 * from — that refuses it, as a named 422 rather than a driver error from PostgreSQL. Repeating a
 * calendar here would be a second implementation of the rule, and the two would eventually disagree.
 * What this file must never do is *normalize* one: rolling February 30th into March would answer a
 * question nobody asked.
 *
 * **Every number is a small whole ordinal with the domain's own bound**, imported rather than
 * retyped. There is no money, no rate, no percentage and nothing computed in this module
 * (ADR-0074) — so there is no decimal on any shape below, nothing here is parsed as a float, and no
 * value in a Career response has ever been through arithmetic.
 *
 * **Every shape that touches an existing row carries `expectedVersion`**, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change, and the refusal it earns is a 409.
 *
 * **No shape here carries an actor, an employment the caller claims to be, or a tenant.** The acting
 * identity comes from the authenticated request context and nowhere else. An `employmentId` in a
 * body below always names *the person the record is about* and never *the person asking*: it is a
 * subject, never a credential (ADR-0032). Self-service routing is `NOT VERIFIED`, and a body that
 * could name its own author is a body that could name somebody else's.
 *
 * Every enumeration is **derived from the domain vocabulary rather than retyped**, so a value the
 * domain adds is one this file offers and one it removes is a compile error here.
 *
 * The shapes that name a *person* — succession, readiness, development and mobility — live in
 * `career-people.dto.ts`, and every rule above applies to them unchanged.
 */

/** A stable, human-authored code. ASCII, because it travels into exports and configuration. */
export const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** A civil date's *shape*. The calendar is the domain's; see the file note. */
export const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The free-text bounds, shared with `career-people.dto.ts`.
 *
 * Exported rather than duplicated: two files that each decided how long a reason may be would
 * eventually disagree, and the shorter one would be the accidental rule.
 */
export const TITLE = 500;
export const NOTES = 4000;
export const REASON = 1024;

export class LocalizedTextBody {
  @ApiProperty({ example: 'Finance' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public readonly en!: string;

  @ApiProperty({ example: 'المالية' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public readonly ar!: string;
}

/** Present on every shape that changes an existing row. See the file note. */
export class VersionedBody {
  @ApiProperty({ example: 1, description: 'The version the client read. A stale value is a 409.' })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

// ------------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------------

export class CreatePathBody {
  @ApiProperty({ example: 'finance' })
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

  @ApiProperty({ enum: CAREER_PATH_KINDS })
  @IsIn(CAREER_PATH_KINDS)
  public readonly kind!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE)
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly effectiveTo?: string;
}

export class AddStageBody {
  @ApiProperty({ example: 1, maximum: MAX_STAGE_SEQUENCE })
  @IsInt()
  @Min(1)
  @Max(MAX_STAGE_SEQUENCE)
  public readonly sequence!: number;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  /** Organization's identifier. Confirmed by exact lookup; no property of it is read (D-4). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly targetPositionId?: string;
}

// ------------------------------------------------------------------------------------------------
// Plans
// ------------------------------------------------------------------------------------------------

export class CreatePlanBody {
  /** Who the plan is *about*. Never who is asking — see the file note and ADR-0032. */
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly pathId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly currentStageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly targetStageId?: string;

  @ApiProperty({ example: '2026-03-01' })
  @Matches(CIVIL_DATE)
  public readonly startedOn!: string;

  @ApiPropertyOptional({ example: '2027-03-01' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly targetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly notes?: string;
}

export class AmendPlanBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly currentStageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly targetStageId?: string;

  @ApiPropertyOptional({ example: '2027-06-30' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly targetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly notes?: string;
}

export class MovePlanBody extends VersionedBody {
  @ApiProperty({ enum: CAREER_PLAN_STATUSES })
  @IsIn(CAREER_PLAN_STATUSES)
  public readonly to!: string;
}

// ------------------------------------------------------------------------------------------------
// Talent pools
// ------------------------------------------------------------------------------------------------

export class CreatePoolBody {
  @ApiProperty({ example: 'future-finance-leaders' })
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

  @ApiProperty({ enum: TALENT_POOL_KINDS })
  @IsIn(TALENT_POOL_KINDS)
  public readonly kind!: string;
}

export class AddToPoolBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ example: '2026-04-01' })
  @Matches(CIVIL_DATE)
  public readonly from!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, REASON)
  public readonly reason?: string;
}

export class RemoveFromPoolBody extends VersionedBody {
  @ApiProperty({ example: '2026-10-01' })
  @Matches(CIVIL_DATE)
  public readonly on!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, REASON)
  public readonly reason?: string;
}
