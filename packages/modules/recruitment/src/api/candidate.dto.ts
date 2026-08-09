import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PROFILE_ENTRY_KINDS, type ProfileEntryKind } from '../domain/recruitment-vocabulary.js';

import { CIVIL_DATE_PATTERN, CODE_PATTERN, VersionedBody } from './requisition.dto.js';

/**
 * The wire shapes for candidates, their profiles and their applications.
 *
 * **No body here carries a national identifier, a date of birth or a nationality**, and none ever
 * should. A candidate is not a Person (ADR-0044): identity-sensitive data is collected by People at
 * hire, from somebody who has agreed to join, behind protections built for exactly that (A-2).
 *
 * **No body carries a candidate number or an application number.** Both are generated, and a request
 * that could supply one would be a request that could reuse one.
 */

const TELEPHONE_PATTERN = /^\+[1-9]\d{6,17}$/;

export class CreateCandidateBody {
  @ApiProperty({ example: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' } })
  @IsObject()
  public readonly displayName!: Record<string, string>;

  @ApiProperty({ description: 'Stored as entered and matched normalized.' })
  @IsEmail()
  public readonly email!: string;

  @ApiPropertyOptional({ example: '+966501234567' })
  @IsOptional()
  @Matches(TELEPHONE_PATTERN)
  public readonly phone?: string;

  @ApiProperty({ example: 'referral', description: 'A tenant or country-pack code (00B).' })
  @Matches(CODE_PATTERN)
  public readonly sourceCode!: string;

  @ApiPropertyOptional({
    description:
      'Set only when a recruiter already knows the Person — an internal applicant, or a returner. Never inferred.',
  })
  @IsOptional()
  @IsUUID()
  public readonly personId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AmendCandidateBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly displayName?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  public readonly email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE_PATTERN)
  public readonly phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly sourceCode?: string;
}

export class LinkPersonBody extends VersionedBody {
  @ApiProperty({
    description:
      'The Person this candidate is. Explicit and permissioned: a link inferred from a shared family address would attach somebody’s career to their spouse.',
  })
  @IsUUID()
  public readonly personId!: string;
}

export class ProfileEntryBody {
  @ApiProperty({ enum: PROFILE_ENTRY_KINDS })
  @IsIn(PROFILE_ENTRY_KINDS)
  public readonly kind!: ProfileEntryKind;

  @ApiPropertyOptional({ example: 'welding-tig' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly code?: string;

  @ApiProperty({ example: { en: 'TIG welding', ar: 'لحام التنجستن' } })
  @IsObject()
  public readonly title!: Record<string, string>;

  @ApiPropertyOptional({ example: { en: 'Arabian Contracting', ar: 'المقاولات العربية' } })
  @IsOptional()
  @IsObject()
  public readonly organizationName?: Record<string, string>;

  @ApiPropertyOptional({ example: '2019-04-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly fromDate?: string;

  @ApiPropertyOptional({ example: '2024-03-31' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly toDate?: string;

  @ApiPropertyOptional({ example: 'advanced' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly levelCode?: string;

  @ApiPropertyOptional({
    description: 'A reference into the document store. Recruitment holds no bytes.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly documentReference?: string;
}

export class SubmitApplicationBody {
  @ApiProperty()
  @IsUUID()
  public readonly candidateId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly vacancyId!: string;

  @ApiProperty({ example: 'careers-site' })
  @Matches(CODE_PATTERN)
  public readonly sourceCode!: string;

  @ApiPropertyOptional({ example: '2026-09-04' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly appliedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

const MOVABLE_STATUSES = [
  'received',
  'screening',
  'shortlisted',
  'interviewing',
  'evaluated',
  'offered',
] as const;

export class MoveApplicationBody extends VersionedBody {
  @ApiProperty({
    enum: MOVABLE_STATUSES,
    description:
      'Hiring and rejecting are not here: each is its own operation, because each carries something a status change does not — an employment, or a reason.',
  })
  @IsIn(MOVABLE_STATUSES)
  public readonly status!: (typeof MOVABLE_STATUSES)[number];

  @ApiPropertyOptional({
    example: 'phone-screen',
    description:
      'A tenant-defined stage inside the status. The status set is closed; this is open.',
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly stageCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class RecordScreeningBody extends VersionedBody {
  @ApiProperty({
    enum: ['passed', 'failed', 'on_hold'],
    description:
      'A result, not a status. Screening somebody out still requires rejecting them explicitly, with a reason.',
  })
  @IsIn(['passed', 'failed', 'on_hold'])
  public readonly outcome!: 'passed' | 'failed' | 'on_hold';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class CloseApplicationBody extends VersionedBody {
  @ApiProperty({ enum: ['rejected', 'withdrawn'] })
  @IsIn(['rejected', 'withdrawn'])
  public readonly outcome!: 'rejected' | 'withdrawn';

  @ApiPropertyOptional({
    example: 'not-enough-experience',
    description:
      'Required for a rejection: an unexplained rejection answers the one question asked.',
  })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;
}

export class ImportCandidateRow {
  @ApiProperty()
  @IsObject()
  public readonly displayName!: Record<string, string>;

  @ApiProperty()
  @IsEmail()
  public readonly email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE_PATTERN)
  public readonly phone?: string;

  @ApiProperty({ example: 'agency' })
  @Matches(CODE_PATTERN)
  public readonly sourceCode!: string;
}

export class ImportCandidatesBody {
  @ApiProperty({
    type: [ImportCandidateRow],
    description:
      'Bounded and synchronous. Beyond the limit the command refuses by name rather than timing out halfway through a migration.',
  })
  @ValidateNested({ each: true })
  @Type(() => ImportCandidateRow)
  public readonly rows!: ImportCandidateRow[];
}
