import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
} from 'class-validator';

import { APPROVAL_DECISIONS } from '../domain/workflow-vocabulary.js';

import { COMMENT, SUBJECT_TYPE, TEXT, VersionedBody } from './workflow.dto.js';

/**
 * The wire shapes a **running** approval accepts: raising one, stopping one, deciding one.
 *
 * Split from `workflow.dto.ts` at the file-size budget, on the seam the module itself keeps: that
 * file is the configuration an administrator writes before anybody is asked anything, and this one
 * is what happens once somebody is. Every rule stated there still applies here, and two of them are
 * load-bearing enough to restate.
 *
 * **No shape below carries an identity.** Not an actor, not a membership, not a workforce user, not
 * a delegate and not somebody to act on behalf of. The acting membership comes from the
 * authenticated request and nowhere else, and whether a delegation is in force is Identity's answer
 * asked inside the handler. `forbidNonWhitelisted` is what turns that from a convention into a 400.
 *
 * **No shape below carries a reading instant.** Whether a step is past its service-level target is
 * answered from the application's own clock, so there is no `asOf` here and no field a client could
 * use to choose the moment its own approval is judged against.
 */

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

  /**
   * Which of the caller's **own** open steps this answers, and it is not an identity.
   *
   * Almost no request carries it: a caller asked once — every 16A approval, and every branch a person
   * appears in once — has their step resolved from the membership on the request, exactly as before.
   * It exists for the one case a branch asks the same person twice, which a version naming somebody
   * individually *and* through a group at one ordinal produces, where answering "one of them" would
   * record a decision against a step nobody chose.
   *
   * **It can only narrow.** The handler computes the caller's own steps first and then filters by
   * this; naming a colleague's step earns the same refusal as sending nothing would.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  public readonly stepId?: string;

  @ApiPropertyOptional({ maxLength: COMMENT })
  @IsOptional()
  @IsString()
  @Length(1, COMMENT)
  public readonly comment?: string;
}

/**
 * Bringing one more approver into a branch that is stuck.
 *
 * **Two fields, and the third is the path.** The approval is `:instanceId`, exactly as it is for a
 * cancellation — the closest sibling to this route, and for the same reason: both are an
 * administrator acting on somebody else's approval that is already under way.
 *
 * **`approverMembershipId` is the person being added, never the person asking.** Whoever asked comes
 * from the authenticated request, as it does for every other shape in this file. That is what makes
 * the field safe: it names a subject rather than an identity, and there is no shape here through
 * which a caller could claim to be somebody.
 *
 * **No `expectedVersion`, and its absence is deliberate.** Every other shape that touches an existing
 * row carries one, because it *updates* that row and a caller who cannot say which version they read
 * cannot be protected from overwriting somebody's change. Escalation updates nothing: it inserts one
 * step beside the ones already there, and the original approvers' rows are not read back, rewritten
 * or versioned. A version here would be protecting against a write that does not happen.
 *
 * **No reason, no `escalateAfter`, no due date and no level.** Why somebody escalated is a sentence
 * nobody approved a column for, and the timeline already records who did it and when. The rest are
 * the automatic capability this phase deliberately did not build, and `forbidNonWhitelisted` turns
 * every one of them into a 400 rather than a silently ignored field.
 */
export class EscalateBranchBody {
  @ApiProperty({ minimum: 1, description: 'The branch. Several steps may share one ordinal.' })
  @IsInt()
  @Min(1)
  public readonly ordinal!: number;

  @ApiProperty({ format: 'uuid', description: 'The approver being added. Never the caller.' })
  @IsUUID()
  public readonly approverMembershipId!: string;
}
