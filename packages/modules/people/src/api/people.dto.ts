import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PERSON_STATUSES, type PersonStatus } from '../domain/people-vocabulary.js';

/**
 * The wire shapes.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler and
 * a rejection is a 400 with field detail rather than an exception from somewhere deeper. The
 * global `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused
 * rather than silently dropped — which is what stops a client believing it set something the
 * server ignored, and what makes a caller's attempt to supply `authoredBy` on a note a 400 rather
 * than a quietly discarded field.
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`, required rather
 * than optional: a client that cannot say which version it read cannot be protected from
 * overwriting somebody else's change.
 *
 * Names arrive as objects keyed by language tag, never as a bare string. An endpoint that accepted
 * one would be an endpoint through which a register acquires English-only people, and no amount of
 * translating afterwards recovers a name nobody was asked for.
 *
 * **No example in this file is a real identifier.** The `example` values on identifier and contact
 * fields are obviously synthetic, because an OpenAPI document is published, indexed and pasted
 * into support tickets.
 */

/** A code: ASCII, because it travels into payroll files and government uploads. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A civil date. A date of birth is the same date in every time zone. */
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BilingualTextBody {
  @ApiProperty({ example: 'Sara Al-Amri' })
  @IsString()
  @Length(1, 512)
  public readonly en!: string;

  @ApiProperty({ example: 'سارة العامري' })
  @IsString()
  @Length(1, 512)
  public readonly ar!: string;
}

export class CreatePersonBody {
  @ApiProperty({ example: 'E-1001', description: "The tenant's own reference for this person." })
  @Matches(CODE_PATTERN)
  public readonly personNumber!: string;

  @ApiProperty({ type: BilingualTextBody, description: 'Required in both first-class languages.' })
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

  @ApiPropertyOptional({ example: 'Riyadh' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  public readonly placeOfBirth?: string;

  @ApiPropertyOptional({ description: 'A tenant-supplied code, never a list this product ships.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly genderCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly maritalStatusCode?: string;

  @ApiPropertyOptional({ description: 'When this identity record comes into force.' })
  @IsOptional()
  @IsISO8601()
  public readonly effectiveFrom?: string;

  @ApiPropertyOptional({
    description:
      'The caller has seen the duplicate candidates and is creating anyway. Explicit rather than a default, because a default that skips the check is a check nobody runs.',
  })
  @IsOptional()
  @IsBoolean()
  public readonly acknowledgedDuplicates?: boolean;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class AmendPersonBody {
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

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class ChangePersonStatusBody {
  @ApiProperty({ enum: PERSON_STATUSES })
  @IsIn([...PERSON_STATUSES])
  public readonly status!: PersonStatus;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class RecordNameBody {
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

  @ApiProperty({
    description:
      'When the new name took effect. A marriage certificate has a date, and it is rarely today.',
  })
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class ReviseMetadataBody {
  @ApiProperty({ type: Object })
  @IsObject()
  public readonly metadata!: Record<string, string>;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class SetPhotoBody {
  @ApiPropertyOptional({ description: 'A document reference. Absent removes the photograph.' })
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly documentId?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class MergePeopleBody {
  @ApiProperty({ description: 'The record everything redirects to.' })
  @IsString()
  public readonly survivorPersonId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class RecordIdentifierBody {
  @ApiProperty({
    example: 'national-id',
    description:
      'A code the tenant or a country pack supplies. Identity document types are country-pack content, never a list this product ships.',
  })
  @Matches(CODE_PATTERN)
  public readonly identifierType!: string;

  @ApiProperty({ example: '0000000000', description: 'Never echoed in an event or a refusal.' })
  @IsString()
  @Length(1, 64)
  public readonly value!: string;

  @ApiPropertyOptional({ example: 'SA', description: 'ISO 3166-1 alpha-2.' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  public readonly issuingCountry?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly issuedOn?: string;

  @ApiPropertyOptional({ example: '2034-01-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly expiresOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly acknowledgedDuplicates?: boolean;
}

export class AmendIdentifierBody {
  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly issuedOn?: string;

  @ApiPropertyOptional({ example: '2034-01-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly expiresOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly isPrimary?: boolean;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class VersionedBody {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class RecordNationalityBody {
  @ApiProperty({ example: 'SA', description: 'ISO 3166-1 alpha-2, validated by shape only.' })
  @Matches(/^[A-Z]{2}$/)
  public readonly countryCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly isPrimary?: boolean;

  @ApiPropertyOptional({ example: '2015-06-01' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly acquiredOn?: string;
}
