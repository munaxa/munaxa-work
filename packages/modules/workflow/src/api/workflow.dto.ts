import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { BRANCH_RULES, CONDITION_OPERATORS } from '../domain/workflow-vocabulary.js';
import { SERVICE_LEVEL_UNITS } from '../domain/service-level.js';

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

/**
 * How long a step is expected to take once it becomes awaiting.
 *
 * **A whole count and a unit, and no third field.** Not a duration string, not milliseconds, not a
 * business-day flag and not a deadline: `2 days` and `48 hours` are the same length of time and not
 * the same sentence, so both survive to the screen that has to show an administrator what they
 * typed.
 *
 * `@Min(1)` and no `@Max`, exactly as `ordinal` above: zero is not a duration and a ceiling would be
 * a policy about how long an approval may take, invented at the edge. `@IsInt` refuses a fraction
 * here rather than letting the domain round one — half a day is a question about working hours this
 * module cannot answer.
 *
 * The unit enumeration is derived from the domain's own `SERVICE_LEVEL_UNITS`, so `business-days`
 * and `weeks` are refused by the same list that refuses them three layers down.
 */
export class ServiceLevelBody {
  @ApiProperty({ minimum: 1, description: 'A whole number of the unit beside it.' })
  @IsInt()
  @Min(1)
  public readonly count!: number;

  @ApiProperty({ enum: SERVICE_LEVEL_UNITS })
  @IsIn([...SERVICE_LEVEL_UNITS])
  public readonly unit!: (typeof SERVICE_LEVEL_UNITS)[number];
}

/** A stable, human-authored code. The same shape the domain's `isCode` enforces. */
export const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** What a business module calls the thing being decided. Shape only; never a list of modules. */
export const SUBJECT_TYPE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

export const TEXT = 500;
export const COMMENT = 4000;

/**
 * A bound on how many conditions one branch may carry.
 *
 * Not a rule about approvals — the domain has none — but a bound on an unbounded array arriving from
 * an untrusted edge, which is the same reason every collection read in this module is paged. Twenty
 * `all-of` clauses on one branch is already past what anybody could read on a screen.
 */
const CONDITIONS = 20;

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
 * One condition on a branch, in the closed form the domain evaluates.
 *
 * **The shape is checked here and the meaning is not.** A key, one of five operators, and a value —
 * that is all this class can honestly assert, because whether `'50000'` suits `greater-than` and
 * whether a key exists in a particular request's payload are questions about an operator's semantics
 * and about facts that arrive later. `conditionIsWellFormed` answers the first when a version is
 * published and `evaluateCondition` answers the second when an approval starts, each with a reason
 * that names the mistake. A 400 here for either would be telling a client its request was malformed
 * when it was well formed and declined.
 *
 * `value` is deliberately untyped beyond "present": the domain takes a string, a whole number, or a
 * list of one kind for `in`, and there is no `class-validator` decorator for that union. Declaring it
 * as a string would refuse the numeric comparison the feature exists for.
 */
export class BranchConditionBody {
  @ApiProperty({ maxLength: TEXT, description: 'A top-level key of the instance’s context.' })
  @IsString()
  @IsNotEmpty()
  @Length(1, TEXT)
  public readonly key!: string;

  @ApiProperty({ enum: CONDITION_OPERATORS })
  @IsIn([...CONDITION_OPERATORS])
  public readonly operator!: (typeof CONDITION_OPERATORS)[number];

  @ApiProperty({ description: 'Text, a whole number, or a list of one kind for `in`.' })
  @IsDefined()
  public readonly value!: string | number | readonly (string | number)[];
}

/**
 * A step on a draft version.
 *
 * `approverMembershipId` names **the person being asked**, not the person asking. It is a subject
 * rather than a credential: an administrator configuring a workflow states who must decide, and the
 * caller's own identity is never read from a body (ADR-0032).
 *
 * **There is still no `approverKind`, and it is more load-bearing now than in 16B.** The domain has
 * three kinds since Phase 16C, and the application *derives* which one this is. A client that could
 * send the kind could send one that disagrees with the field beside it — `group` with a membership,
 * `membership` with a group — and something would have to pick a reading. `forbidNonWhitelisted`
 * refuses the property outright, so the derivation cannot be argued with, and `role` and `external`
 * are unreachable because there is no field either could arrive in.
 *
 * **A manager is declared rather than named**, and `routeToRequestersManager` is deliberately a
 * boolean rather than a kind. A manager template names nobody — whose manager it means is the person
 * who raised the approval, fixed rather than configured (P-1) — so there is no identifier to derive
 * the kind from and it has to be stated. A `boolean` can carry exactly one capability and cannot be
 * widened by a client into `role` or `external` the way a free `approverKind` string could. The
 * server maps it; the wire never carries a kind.
 *
 * **No manager identifier is accepted anywhere.** There is no `managerEmploymentId`, no
 * `managerMembershipId`, no `workforceUserId` and no `platformUserId` on this body or any other, so
 * there is no field through which a client could route to somebody else's manager or bypass the
 * approved resolution. `forbidNonWhitelisted` turns each of those from a convention into a 400.
 *
 * Naming **both** approvers, neither, or a manager *and* an identifier is the domain's refusal
 * (`step-approver-ambiguous`, `step-approver-required`) rather than a 400: every one of those bodies
 * is well formed, and which one a caller meant is a question about the process they are configuring.
 */
export class AddStepBody {
  @ApiProperty({ minimum: 1, description: 'The branch. Several steps may share one ordinal.' })
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

  @ApiPropertyOptional({ format: 'uuid', description: 'The membership asked to decide.' })
  @IsOptional()
  @IsUUID()
  public readonly approverMembershipId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The list resolved at instance start.' })
  @IsOptional()
  @IsUUID()
  public readonly approverGroupId?: string;

  @ApiPropertyOptional({ enum: BRANCH_RULES, description: 'Absent means unanimous.' })
  @IsOptional()
  @IsIn([...BRANCH_RULES])
  public readonly branchRule?: (typeof BRANCH_RULES)[number];

  /** Responses before the rule is consulted. A count of people, bounded below and not above. */
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly quorum?: number;

  @ApiPropertyOptional({ type: [BranchConditionBody], maxItems: CONDITIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => BranchConditionBody)
  public readonly condition?: readonly BranchConditionBody[];

  /**
   * Route this step to the **requester's** manager. There is no other manager it could mean.
   *
   * A boolean rather than an identifier, and rather than a kind: whose manager is fixed (P-1), so
   * there is nothing to configure and nothing a client could point somewhere else.
   */
  @ApiPropertyOptional({ description: 'Ask the requester’s immediate manager. Names nobody.' })
  @IsOptional()
  @IsBoolean()
  public readonly routeToRequestersManager?: boolean;

  /** How long this step is expected to take. Absent means it has no due time at all. */
  @ApiPropertyOptional({ type: ServiceLevelBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceLevelBody)
  public readonly serviceLevel?: ServiceLevelBody;
}

/**
 * A named list of memberships a tenant maintains.
 *
 * Two fields, and the absences are the design: no status, no owner, no effective period, no role and
 * no query. A group is a list somebody wrote down, and every one of those would make it something
 * else — the directory ADR-0001 places with Platform.
 */
export class CreateApprovalGroupBody {
  @ApiProperty({ pattern: CODE.source })
  @IsString()
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;
}

/**
 * Putting somebody on a list.
 *
 * One field. `membershipId` is **the person being added**, not the person adding — a subject rather
 * than a credential, exactly as a step's approver is. Nothing resolves it: Workflow does not ask
 * Identity whether this membership exists, holds a position or reports to anybody, because a lookup
 * here would be the first half of a directory this product has committed not to build.
 */
export class AddGroupMemberBody {
  @ApiProperty({ format: 'uuid', description: 'Identity’s identifier, held as an opaque value.' })
  @IsUUID()
  public readonly membershipId!: string;
}
