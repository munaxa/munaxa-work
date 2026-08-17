import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
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
