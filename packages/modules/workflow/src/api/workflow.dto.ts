import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
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

import { APPROVAL_DECISIONS } from '../domain/workflow-vocabulary.js';

/**
 * The wire shapes Workflow accepts, and the rules that run through every one of them.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and a
 * rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped — which in this module is the difference between a rejected request and a
 * client smuggling `approverMembershipId` into a decision.
 *
 * **No shape here carries an identity.** Not an actor, not a membership, not a workforce user, not a
 * delegate and not somebody to act on behalf of. The acting membership comes from the authenticated
 * request and nowhere else (Checkpoint 4), and whether a delegation is in force is Identity's answer
 * asked inside the handler (Checkpoint 6). A body that could name its approver is a body that could
 * name somebody else's, and `forbidNonWhitelisted` is what turns that from a convention into a 400.
 *
 * **There is no date on any shape below.** Workflow holds no civil date — a request, a decision and
 * a step becoming current are moments — so there is no date to parse, no format to agree on, and no
 * converter to get wrong. Instants leave as ISO strings from the published views and never arrive.
 *
 * **Every shape that touches an existing row carries `expectedVersion`**, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change, and the refusal it earns is a 409 from the shared filter.
 *
 * **Every number is a whole ordinal bounded below and not above.** AD-004 forbids a hardcoded
 * approval limit, so `ordinal` has `@Min(1)` and no `@Max` — the `integer` column's range is a
 * property of the storage rather than a rule about approvals, and inventing a ceiling here would be
 * inventing the rule the domain refused. There is no money, no rate, no percentage and nothing
 * computed in this module, so no shape below is parsed as a float.
 *
 * The one enumeration is **derived from the domain vocabulary rather than retyped**, so a decision
 * the domain adds is one this file offers and one it removes is a compile error here.
 */

/** A stable, human-authored code. The same shape the domain's `isCode` enforces. */
export const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** What a business module calls the thing being decided. Shape only; never a list of modules. */
export const SUBJECT_TYPE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

const TEXT = 500;
const COMMENT = 4000;

/**
 * Bilingual text a tenant authored.
 *
 * Both languages are required, matching the domain's `isLocalizedName`: a name present in one
 * language renders as nothing on half the organization's screens, and a blank is not a translation.
 */
export class LocalizedTextBody {
  @ApiProperty({ maxLength: TEXT })
  @IsString()
  @IsNotEmpty()
  @Length(1, TEXT)
  public readonly en!: string;

  @ApiProperty({ maxLength: TEXT })
  @IsString()
  @IsNotEmpty()
  @Length(1, TEXT)
  public readonly ar!: string;
}

/** Everything that changes an existing row. Never optional; see the file note. */
export class VersionedBody {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class CreateDefinitionBody {
  @ApiProperty({ pattern: CODE.source })
  @IsString()
  @Matches(CODE)
  public readonly code!: string;

  /**
   * `@IsDefined` as well as `@ValidateNested`, because the two check different things.
   *
   * `class-validator` skips a nested validator entirely when the property is absent, so a body with
   * no `name` at all would pass the edge and be refused by the domain instead — a 422 where a 400
   * belongs, telling a client its well-formed request was declined rather than that it left a
   * required field out.
   */
  @ApiProperty({ type: LocalizedTextBody })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty({ pattern: SUBJECT_TYPE.source, example: 'recruitment.requisition' })
  @IsString()
  @Matches(SUBJECT_TYPE)
  public readonly subjectType!: string;

  @ApiPropertyOptional({ type: LocalizedTextBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly description?: LocalizedTextBody;
}

/**
 * A step on a draft version.
 *
 * `approverMembershipId` names **the person being asked**, not the person asking. It is a subject
 * rather than a credential: an administrator configuring a workflow states who must decide, and the
 * caller's own identity is never read from a body (ADR-0032).
 *
 * There is no `approverKind` here. The domain has exactly one — `membership` — and offering a field
 * with a single legal value would imply a choice the product does not have; adding a kind in 16B is
 * a vocabulary change somebody reviews rather than a new meaning given to an existing field.
 */
export class AddStepBody {
  @ApiProperty({ minimum: 1, description: 'Position in the chain. Bounded below, never above.' })
  @IsInt()
  @Min(1)
  public readonly ordinal!: number;

  /**
   * `@IsDefined` as well as `@ValidateNested`, because the two check different things.
   *
   * `class-validator` skips a nested validator entirely when the property is absent, so a body with
   * no `name` at all would pass the edge and be refused by the domain instead — a 422 where a 400
   * belongs, telling a client its well-formed request was declined rather than that it left a
   * required field out.
   */
  @ApiProperty({ type: LocalizedTextBody })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty({ format: 'uuid', description: 'The membership asked to decide.' })
  @IsUUID()
  public readonly approverMembershipId!: string;
}

/**
 * Raising an approval about a subject another module owns.
 *
 * `context` is the requesting module's own payload, stored for audit and **read by nothing** in
 * Phase 16A: branching is 16B, so there are no routing rules to read it. It is accepted as an opaque
 * object rather than a declared shape, because declaring one would make Workflow know something
 * about a business module (AD-001).
 */
export class StartInstanceBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public readonly definitionId!: string;

  @ApiProperty({ pattern: SUBJECT_TYPE.source, example: 'recruitment.requisition' })
  @IsString()
  @Matches(SUBJECT_TYPE)
  public readonly subjectType!: string;

  @ApiProperty({ maxLength: TEXT, description: 'The owning module’s identifier. Opaque here.' })
  @IsString()
  @IsNotEmpty()
  @Length(1, TEXT)
  public readonly subjectId!: string;

  @ApiPropertyOptional({ type: Object, description: 'Stored for audit. Nothing reads it in 16A.' })
  @IsOptional()
  @IsObject()
  public readonly context?: Record<string, unknown>;
}

/**
 * Stopping an approval nobody decided.
 *
 * A reason is required, because "why did this approval stop" is the question somebody asks later and
 * the organization should have written it down at the time. Cancellation is not a rejection: the
 * requesting module learns that nobody decided, rather than that somebody refused.
 */
export class CancelInstanceBody extends VersionedBody {
  @ApiProperty({ maxLength: TEXT })
  @IsString()
  @IsNotEmpty()
  @Length(1, TEXT)
  public readonly reason!: string;
}

/**
 * An approver answering the step they were asked to answer.
 *
 * Four fields and no fifth. There is no approver, no delegate, no "on behalf of", no score, no
 * tally, no due date and no escalation — the caller is the membership the request resolved, and
 * whether they are acting for somebody else is Identity's answer rather than a field.
 *
 * The **comment stays on the decision**, which is where the permission to read it is decided, rather
 * than travelling into the timeline a queue screen renders.
 */
export class DecideStepBody extends VersionedBody {
  @ApiProperty({ enum: APPROVAL_DECISIONS })
  @IsIn([...APPROVAL_DECISIONS])
  public readonly decision!: (typeof APPROVAL_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: COMMENT })
  @IsOptional()
  @IsString()
  @Length(1, COMMENT)
  public readonly comment?: string;
}
