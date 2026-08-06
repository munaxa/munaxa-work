import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  CAPABILITY_KINDS,
  DUPLICATE_STATUSES,
  HISTORY_KINDS,
  LANGUAGE_PROFICIENCIES,
  SKILL_LEVELS,
  type CapabilityKind,
  type DuplicateStatus,
  type HistoryKind,
} from '../domain/people-vocabulary.js';
import { IMPORT_LIMIT } from '../application/transfer.use-case.js';

import { BilingualTextBody } from './people.dto.js';

/**
 * The wire shapes for the profile records, the review queue and the bulk import.
 *
 * Split from `people.dto.ts` so neither file exceeds the budget a source file is held to, and
 * split by concern rather than by line count: everything here is something a person *claims* or
 * something an administrator *decides*, rather than a fact about their identity.
 */

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** A BCP 47 tag. The languages a person speaks are not limited to the two this product ships in. */
const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const ALL_LEVELS = [...LANGUAGE_PROFICIENCIES, ...SKILL_LEVELS];

export class RecordCapabilityBody {
  @ApiProperty({ enum: CAPABILITY_KINDS })
  @IsIn([...CAPABILITY_KINDS])
  public readonly kind!: CapabilityKind;

  @ApiProperty({
    example: 'ar',
    description: 'A BCP 47 tag for a language; a tenant-supplied code for a skill.',
  })
  @Matches(new RegExp(`${LANGUAGE_TAG_PATTERN.source}|${CODE_PATTERN.source}`))
  public readonly capabilityCode!: string;

  @ApiPropertyOptional({
    type: BilingualTextBody,
    description:
      'Required for a skill and refused for a language: a language tag renders from the reader’s own locale data.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly title?: BilingualTextBody;

  @ApiProperty({ enum: ALL_LEVELS, description: 'From the scale matching the kind.' })
  @IsIn(ALL_LEVELS)
  public readonly level!: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(80)
  public readonly yearsOfExperience?: number;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly lastUsedOn?: string;
}

export class RecordHistoryBody {
  @ApiProperty({ enum: HISTORY_KINDS })
  @IsIn([...HISTORY_KINDS])
  public readonly kind!: HistoryKind;

  @ApiProperty({
    type: BilingualTextBody,
    description: 'The university, the previous employer, or the issuing body.',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly organizationName!: BilingualTextBody;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly title!: BilingualTextBody;

  @ApiPropertyOptional({ type: BilingualTextBody, description: 'Education only.' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly fieldOfStudy?: BilingualTextBody;

  @ApiPropertyOptional({ example: 'SA' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  public readonly countryCode?: string;

  @ApiProperty({ example: '2010-09-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly fromDate!: string;

  @ApiPropertyOptional({ example: '2014-06-30' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly toDate?: string;

  @ApiPropertyOptional({ example: '2028-01-01', description: 'Certification only.' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly expiresOn?: string;

  @ApiPropertyOptional({ example: 'CERT-000000' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly reference?: string;
}

export class ApplyTagBody {
  @ApiProperty({ example: 'graduate-intake-2026' })
  @Matches(CODE_PATTERN)
  public readonly tagCode!: string;
}

export class WriteNoteBody {
  @ApiProperty({ example: 'wellbeing' })
  @Matches(CODE_PATTERN)
  public readonly categoryCode!: string;

  @ApiProperty({
    description:
      'The author is taken from the authenticated context and cannot be supplied. A note is never amended and never deleted.',
  })
  @IsString()
  @Length(1, 8192)
  public readonly body!: string;
}

export class ReviewDuplicateBody {
  @ApiProperty({ enum: DUPLICATE_STATUSES.filter((status) => status !== 'pending') })
  @IsIn(['confirmed', 'dismissed'])
  public readonly decision!: Exclude<DuplicateStatus, 'pending'>;

  @ApiPropertyOptional({ description: 'Why. The reviewer is taken from the context.' })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  public readonly note?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class ImportPersonRowBody {
  @ApiProperty({ example: 'E-1001' })
  @Matches(CODE_PATTERN)
  public readonly personNumber!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly legalName!: BilingualTextBody;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly preferredName?: BilingualTextBody;

  @ApiPropertyOptional({ example: '1990-03-14' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  public readonly placeOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly genderCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly maritalStatusCode?: string;
}

export class ImportPeopleBody {
  @ApiProperty({
    type: [ImportPersonRowBody],
    description: `Bounded at ${String(IMPORT_LIMIT)} rows, refused by name rather than discovered at a timeout.`,
  })
  @IsArray()
  @ArrayMaxSize(IMPORT_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => ImportPersonRowBody)
  public readonly rows!: readonly ImportPersonRowBody[];

  @ApiPropertyOptional({
    description:
      'Whether rows matching an existing person are created anyway. Absent means they are reported and not written.',
  })
  @IsOptional()
  public readonly acknowledgedDuplicates?: boolean;
}
