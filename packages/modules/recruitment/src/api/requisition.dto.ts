import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
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

/**
 * The wire shapes for requisitions and vacancies.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and a
 * rejection is a 400 with field detail rather than an exception from somewhere deeper. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused rather
 * than silently dropped.
 *
 * **No body carries a requisition number**, and none carries a decider. The number is generated
 * (A-8), and the human who approved a requisition is taken from the authenticated context — an
 * approval a caller could attribute to a colleague is not evidence of anything (ADR-0045).
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`, required rather than
 * optional: a client that cannot say which version it read cannot be protected from overwriting
 * somebody else's change.
 *
 * Codes are **tenant or country-pack values**, and the examples below are illustrative rather than a
 * list this product ships (00B).
 */

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HEADCOUNT = 1000;

export class CreateRequisitionBody {
  @ApiProperty({ description: "Organization's position identifier. No title is cached here." })
  @IsUUID()
  public readonly positionId!: string;

  @ApiProperty({ description: "Organization's unit identifier." })
  @IsUUID()
  public readonly unitId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly costCenterId?: string;

  @ApiProperty({ example: 2, description: 'How many people this requisition authorizes hiring.' })
  @IsInt()
  @Min(1)
  @Max(MAX_HEADCOUNT)
  public readonly headcountRequested!: number;

  @ApiProperty({ example: 'growth', description: 'A tenant or country-pack code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;

  @ApiPropertyOptional({ example: 'urgent' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly priorityCode?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly targetStartDate?: string;

  @ApiProperty({ description: 'The employment raising the request. Not a user, and not a person.' })
  @IsUUID()
  public readonly requestedByEmploymentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly hiringManagerEmploymentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class VersionedBody {
  @ApiProperty({ description: 'The version the client read. A stale value is refused with 409.' })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class DecideRequisitionBody extends VersionedBody {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  public readonly decision!: 'approved' | 'rejected';

  @ApiPropertyOptional({ example: 'budget-not-available' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class ReverseDecisionBody extends VersionedBody {
  @ApiPropertyOptional({ description: 'Why the decision is being reversed.' })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class CloseRequisitionBody extends VersionedBody {
  @ApiPropertyOptional({ example: 'position-filled' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional({
    description: 'Cancelling is the business changing its mind; closing is the work finishing.',
  })
  @IsOptional()
  @IsBoolean()
  public readonly cancel?: boolean;
}

export class OpenVacancyBody {
  @ApiProperty({ description: 'The approved requisition this opening recruits against.' })
  @IsUUID()
  public readonly requisitionId!: string;

  @ApiProperty({
    example: { en: 'Field engineer', ar: 'مهندس ميداني' },
    description: 'Both languages. A posting in one is unreadable to half the workforce (00B).',
  })
  @IsObject()
  public readonly title!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional({ example: ['careers-site', 'linkedin'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public readonly channels?: string[];

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly openedOn?: string;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly closesOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class PublishVacancyBody extends VersionedBody {
  @ApiPropertyOptional({ example: ['careers-site'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public readonly channels?: string[];

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly openedOn?: string;
}

export class CloseVacancyBody extends VersionedBody {
  @ApiPropertyOptional({ example: 'filled' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}
