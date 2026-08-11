import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { RECOMMENDATIONS, type Recommendation } from '../domain/recruitment-vocabulary.js';

import { CIVIL_DATE_PATTERN, CODE_PATTERN, VersionedBody } from './requisition.dto.js';

/**
 * The wire shapes for interviews, feedback, offers and the hire.
 *
 * **The proposed compensation is an opaque object** (A-5). It is validated as an object and nothing
 * more: this module performs no arithmetic on it, ships no salary structure and applies no statutory
 * rule. Compensation (Phase 10) is authoritative for what anybody is actually paid.
 *
 * **Interviewers are employments** (A-6), never names and never user identifiers. Recruitment stores
 * no copy of an employee's details, and each identifier is verified against Employment before an
 * interview is scheduled.
 */

const MAX_PANEL = 20;
const MAX_SCORE = 5;

export class ScheduleInterviewBody {
  @ApiProperty()
  @IsUUID()
  public readonly applicationId!: string;

  @ApiProperty({
    example: 1,
    description: 'Rounds are numbered from one, and unique per application.',
  })
  @IsInt()
  @Min(1)
  public readonly roundNumber!: number;

  @ApiPropertyOptional({ example: 'panel' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly stageCode?: string;

  @ApiProperty({ example: 'video', description: 'A tenant or country-pack code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly modeCode!: string;

  @ApiPropertyOptional({ example: '2026-09-15T09:00:00Z' })
  @IsOptional()
  @IsISO8601()
  public readonly scheduledFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-15T10:00:00Z' })
  @IsOptional()
  @IsISO8601()
  public readonly scheduledTo?: string;

  @ApiPropertyOptional({ example: 'Meeting room 3' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  public readonly locationText?: string;

  @ApiPropertyOptional({
    description: 'Opaque: a meeting link, a room booking, whatever an external system calls it.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  public readonly meetingReference?: string;

  @ApiProperty({
    description: 'The panel, as employment identifiers. An interview nobody conducts is refused.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PANEL)
  @IsUUID('all', { each: true })
  public readonly interviewerEmploymentIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class RescheduleInterviewBody extends VersionedBody {
  @ApiPropertyOptional({ example: '2026-09-16T09:00:00Z' })
  @IsOptional()
  @IsISO8601()
  public readonly scheduledFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-16T10:00:00Z' })
  @IsOptional()
  @IsISO8601()
  public readonly scheduledTo?: string;
}

export class ConcludeInterviewBody extends VersionedBody {
  @ApiProperty({
    enum: ['completed', 'no_show', 'cancelled'],
    description: 'It happened, nobody came, or it was called off. Three different facts.',
  })
  @IsIn(['completed', 'no_show', 'cancelled'])
  public readonly outcome!: 'completed' | 'no_show' | 'cancelled';

  @ApiPropertyOptional({ example: 'candidate-unavailable' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;
}

export class SubmitFeedbackBody {
  @ApiProperty({ description: 'The interviewer. Must be on the panel; one verdict each, ever.' })
  @IsUUID()
  public readonly interviewerEmploymentId!: string;

  @ApiPropertyOptional({ example: 4, description: 'One to five, or none at all.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SCORE)
  public readonly score?: number;

  @ApiProperty({
    enum: RECOMMENDATIONS,
    description:
      '`no_decision` is not the middle of the scale — it is the interviewer saying they cannot judge.',
  })
  @IsIn(RECOMMENDATIONS)
  public readonly recommendation!: Recommendation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  public readonly strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  public readonly concerns?: string;
}

export class DraftOfferBody {
  @ApiProperty()
  @IsUUID()
  public readonly applicationId!: string;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly proposedStartDate!: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly expiresOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly proposedPositionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly proposedUnitId?: string;

  @ApiPropertyOptional({ example: 'full-time' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly proposedEmploymentTypeCode?: string;

  @ApiPropertyOptional({
    example: { base: '18000', housing: '4500', period: 'monthly' },
    description:
      'Stored as authored and never computed with. Compensation (Phase 10) owns pay; this is what a recruiter proposed.',
  })
  @IsOptional()
  @IsObject()
  public readonly proposedCompensation?: Record<string, string>;

  @ApiPropertyOptional({ example: 'SAR', description: 'ISO 4217, checked as a shape, not a list.' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  public readonly currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly documentReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class DecideOfferBody extends VersionedBody {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  public readonly decision!: 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class IssueOfferBody extends VersionedBody {
  @ApiProperty({
    description:
      'The application version the client read: issuing moves the application to `offered` in the same transaction.',
  })
  @IsInt()
  @Min(1)
  public readonly expectedApplicationVersion!: number;
}

export class OfferResponseBody extends VersionedBody {
  @ApiProperty({
    enum: ['accepted', 'declined'],
    description: 'Recorded by whoever heard it. This phase ships no candidate portal.',
  })
  @IsIn(['accepted', 'declined'])
  public readonly response!: 'accepted' | 'declined';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class CloseOfferBody extends VersionedBody {
  @ApiProperty({ enum: ['withdrawn', 'expired'] })
  @IsIn(['withdrawn', 'expired'])
  public readonly outcome!: 'withdrawn' | 'expired';
}

export class HireCandidateBody extends VersionedBody {
  @ApiPropertyOptional({
    example: '2026-11-05',
    description: 'Overrides the accepted offer’s date when the business agreed a different one.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly startDate?: string;

  @ApiPropertyOptional({
    example: 'full-time',
    description: 'Required when the accepted offer named no employment type.',
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly employmentTypeCode?: string;
}
