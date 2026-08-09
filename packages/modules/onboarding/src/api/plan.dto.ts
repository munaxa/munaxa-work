import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { DUE_ANCHORS, OWNER_KINDS, TASK_KINDS } from '../domain/onboarding-vocabulary.js';

/**
 * The wire shapes for plans, their versions and the templates a version holds.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and a
 * rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped.
 *
 * **No body carries a version number and none carries a publisher.** A version is numbered by the
 * handler, and the human who published it is taken from the authenticated context — a publication a
 * caller could attribute to a colleague is not evidence that anybody reviewed the checklist a
 * hundred joiners are about to be measured against.
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change.
 *
 * `title`, `name` and `description` are **authored text in both languages**, not catalogue keys —
 * checked in the domain rather than here, because "both languages present" is a rule this product
 * keeps rather than a shape the wire enforces.
 *
 * Codes are **tenant or country-pack values**, and the examples below are illustrative rather than a
 * list this product ships (00B).
 */

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DOCUMENT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;

const MAX_SEQUENCE = 1000;
const MAX_OFFSET_DAYS = 365;

export class VersionedBody {
  @ApiProperty({ description: 'The version the client read. Refused if the row moved since.' })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class CreatePlanBody {
  @ApiProperty({ example: 'corporate-joiner', description: 'A tenant code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({
    example: { en: 'Corporate joiner', ar: 'منضم للشركة' },
    description: 'Authored text. Both languages are required — checked in the domain.',
  })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Stored and returned, never interpreted. No personal data.' })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AmendPlanBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly name?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class DraftPlanVersionBody {
  @ApiPropertyOptional({
    description:
      "Copy the published version's templates as a starting point. The published version is untouched.",
  })
  @IsOptional()
  @IsBoolean()
  public readonly copyFromPublished?: boolean;
}

export class DefineTaskTemplateBody {
  @ApiProperty({ example: 'right-to-work', description: 'Unique within the version.' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ example: 10, description: 'Display order within the checklist.' })
  @IsInt()
  @Min(1)
  @Max(MAX_SEQUENCE)
  public readonly sequence!: number;

  @ApiProperty({ example: { en: 'Right-to-work check', ar: 'التحقق من حق العمل' } })
  @IsObject()
  public readonly title!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiProperty({ enum: TASK_KINDS, description: 'Closed at five. A sixth is a schema change.' })
  @IsIn(TASK_KINDS)
  public readonly kind!: (typeof TASK_KINDS)[number];

  @ApiProperty({
    enum: OWNER_KINDS,
    description: '`employee` and `manager` are resolved per onboarding and take no reference.',
  })
  @IsIn(OWNER_KINDS)
  public readonly ownerKind!: (typeof OWNER_KINDS)[number];

  @ApiPropertyOptional({ description: 'Required for `employment` and `unit`.' })
  @IsOptional()
  @IsUUID()
  public readonly ownerRef?: string;

  @ApiPropertyOptional({ example: 'it-onboarding', description: 'Required for `role`: a queue.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly ownerRole?: string;

  @ApiPropertyOptional({ description: 'Defaults to true. Only required tasks gate completion.' })
  @IsOptional()
  @IsBoolean()
  public readonly required?: boolean;

  @ApiPropertyOptional({ enum: DUE_ANCHORS, description: 'Defaults to `employment_start`.' })
  @IsOptional()
  @IsIn(DUE_ANCHORS)
  public readonly dueAnchor?: (typeof DUE_ANCHORS)[number];

  @ApiPropertyOptional({
    example: -3,
    description: 'Calendar days from the anchor. Negative is before it. Not working days (00B).',
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_OFFSET_DAYS)
  @Max(MAX_OFFSET_DAYS)
  public readonly dueOffsetDays?: number;

  @ApiPropertyOptional({ description: 'One predecessor, by code. A graph is a workflow engine.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly dependsOnTemplateCode?: string;

  @ApiPropertyOptional({ example: 'passport', description: 'Required for a `document` task.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly documentTypeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}
