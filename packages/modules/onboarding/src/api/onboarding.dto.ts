import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { OWNER_KINDS } from '../domain/onboarding-vocabulary.js';

import {
  CIVIL_DATE_PATTERN,
  CODE_PATTERN,
  DOCUMENT_REFERENCE_PATTERN,
  VersionedBody,
} from './plan.dto.js';

/**
 * The wire shapes for starting an onboarding, moving it, and moving its tasks.
 *
 * **`StartOnboardingBody` carries no person and no employment fact.** It names an employment that
 * already exists, and nothing else about the human being: Recruitment's hire created the Person and
 * the Employment (ADR-0046), and this module could not create either even if a body asked it to —
 * the instance's foreign keys would refuse the row.
 *
 * **The start endpoint is safe to send twice.** There is no idempotency key here and none is needed:
 * the uniqueness boundary is one live onboarding per employment, enforced by a partial unique index,
 * so a retry converges on the instance the first request created rather than making a second
 * (ADR-0050).
 *
 * **`documentReference` is a reference, never a file.** No endpoint in this module accepts bytes:
 * there is no document adapter wired in this repository, and an upload path that stored nothing
 * would be a completeness claim this product has not earned.
 *
 * **No body names a completer, a waiver's author or a canceller.** Every one of those is taken from
 * the authenticated context. A completion a caller could attribute to a colleague is not evidence
 * that anybody did the safety briefing.
 */

const MAX_NOTE = 1024;

export class StartOnboardingBody {
  @ApiProperty({ description: 'An employment that already exists. Never created here.' })
  @IsUUID()
  public readonly employmentId!: string;

  @ApiPropertyOptional({
    description: 'Optional: an onboarding may start with no plan and have one applied afterwards.',
  })
  @IsOptional()
  @IsUUID()
  public readonly planId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: "Defaults to the employment's start date, read from Employment.",
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly plannedStartOn?: string;

  @ApiPropertyOptional({ description: "Recruitment's application, when the hire came from one." })
  @IsOptional()
  @IsUUID()
  public readonly applicationId?: string;

  @ApiPropertyOptional({ description: 'Stored and returned, never interpreted. No personal data.' })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class CancelOnboardingBody extends VersionedBody {
  @ApiProperty({
    example: 'withdrawn',
    description: 'A tenant or country-pack code (00B). Cancelling ends no employment.',
  })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;
}

export class CompleteTaskBody extends VersionedBody {
  @ApiPropertyOptional({ description: 'What the person recorded. Never a name, never a reason.' })
  @IsOptional()
  @IsString()
  @Length(1, MAX_NOTE)
  public readonly note?: string;

  @ApiPropertyOptional({
    example: 'doc:2026/passport/9f3',
    description: 'A reference into the document store. Required for a `document` task. Never bytes.',
  })
  @IsOptional()
  @Matches(DOCUMENT_REFERENCE_PATTERN)
  public readonly documentReference?: string;
}

export class WaiveTaskBody extends VersionedBody {
  @ApiProperty({
    example: 'not-applicable',
    description: 'Why the task did not apply. A tenant or country-pack code (00B).',
  })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;
}

export class ReassignTaskBody extends VersionedBody {
  @ApiProperty({ enum: OWNER_KINDS })
  @IsIn(OWNER_KINDS)
  public readonly ownerKind!: (typeof OWNER_KINDS)[number];

  @ApiPropertyOptional({ description: 'Required for `employment` and `unit`.' })
  @IsOptional()
  @IsUUID()
  public readonly ownerRef?: string;

  @ApiPropertyOptional({ example: 'it-onboarding', description: 'Required for `role`.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly ownerRole?: string;
}

export class RescheduleTaskBody extends VersionedBody {
  @ApiPropertyOptional({ example: '2026-09-04', description: 'Omit to clear the due date.' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly dueOn?: string;
}

const MAX_RECONCILE_SCAN = 500;

export class ReconcileBody {
  @ApiPropertyOptional({
    description: 'Applied to every onboarding this run starts. Omitted, they start with no tasks.',
  })
  @IsOptional()
  @IsUUID()
  public readonly planId?: string;

  @ApiPropertyOptional({
    description: 'How many employments to scan. Bounded so a run finishes.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RECONCILE_SCAN)
  public readonly limit?: number;
}
