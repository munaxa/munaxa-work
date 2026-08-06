import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
  ADDRESS_KINDS,
  CONTACT_CHANNELS,
  CONTACT_PURPOSES,
  type AddressKind,
  type ContactChannel,
  type ContactPurpose,
} from '../domain/people-vocabulary.js';

import { BilingualTextBody } from './people.dto.js';

/**
 * The wire shapes for the versioned children: contacts, addresses, emergency contacts and
 * preferences.
 *
 * Split from `people.dto.ts` so neither file exceeds the budget a source file is held to, and
 * split by concern rather than by line count: everything here records a *period* rather than a
 * fact, so every one of these carries an `effectiveFrom` and none of them carries a version — a
 * new period supersedes rather than overwrites, and there is nothing to be stale against.
 */

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class RecordContactBody {
  @ApiProperty({ enum: CONTACT_CHANNELS })
  @IsIn([...CONTACT_CHANNELS])
  public readonly channel!: ContactChannel;

  @ApiProperty({ enum: CONTACT_PURPOSES })
  @IsIn([...CONTACT_PURPOSES])
  public readonly purpose!: ContactPurpose;

  @ApiProperty({ example: 'person@example.com' })
  @IsString()
  @Length(1, 320)
  public readonly value!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly isPrimary?: boolean;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly acknowledgedDuplicates?: boolean;
}

export class CloseAtBody {
  @ApiProperty()
  @IsISO8601()
  public readonly effectiveTo!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class RecordAddressBody {
  @ApiProperty({ enum: ADDRESS_KINDS })
  @IsIn([...ADDRESS_KINDS])
  public readonly kind!: AddressKind;

  @ApiProperty({ type: [BilingualTextBody], description: 'The lines, as the customer wrote them.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BilingualTextBody)
  public readonly lines!: readonly BilingualTextBody[];

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly city!: BilingualTextBody;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly region?: BilingualTextBody;

  @ApiPropertyOptional({ example: '11564' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  public readonly postalCode?: string;

  @ApiProperty({ example: 'SA' })
  @Matches(/^[A-Z]{2}$/)
  public readonly countryCode!: string;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class RecordEmergencyContactBody {
  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  @ValidateNested()
  @Type(() => BilingualTextBody)
  public readonly name!: BilingualTextBody;

  @ApiProperty({
    example: 'sister',
    description: 'A tenant-supplied code. Family structures differ.',
  })
  @Matches(CODE_PATTERN)
  public readonly relationshipCode!: string;

  @ApiProperty({ example: '+966500000000' })
  @IsString()
  @Length(1, 32)
  public readonly telephone!: string;

  @ApiPropertyOptional({ example: '+966500000001' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  public readonly alternateTelephone?: string;

  @ApiPropertyOptional({ example: 'contact@example.com' })
  @IsOptional()
  @IsString()
  @Length(1, 320)
  public readonly email?: string;

  @ApiPropertyOptional({ example: 1, description: '1 is called first.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  public readonly priority?: number;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class RecordPreferenceBody {
  @ApiProperty({ example: 'dietary' })
  @Matches(CODE_PATTERN)
  public readonly preferenceKey!: string;

  @ApiProperty({ example: 'vegetarian' })
  @IsString()
  @Length(1, 1024)
  public readonly value!: string;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}
