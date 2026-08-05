import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
  MinLength,
} from 'class-validator';

import {
  NUMERAL_SYSTEMS,
  PORTAL_KEYS,
  type NumeralSystem,
  type PortalKey,
} from '../domain/identity-vocabulary.js';

/**
 * The wire shapes.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler
 * and a rejection is a 400 with field detail rather than an exception from somewhere deeper.
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so a property that is not
 * declared here is refused rather than silently dropped — which is what stops a client from
 * believing it set something the server ignored.
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`. It is required
 * rather than optional on purpose: a client that cannot say which version it read cannot be
 * protected from overwriting somebody else's change.
 */

export class InviteMemberBody {
  @ApiProperty({ example: 'sara.haddad@example.com' })
  @IsEmail()
  public readonly email!: string;

  @ApiPropertyOptional({ enum: PORTAL_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PORTAL_KEYS, { each: true })
  public readonly portals?: PortalKey[];
}

export class AcceptInvitationBody {
  @ApiProperty({ description: 'The invitation being accepted.' })
  @IsString()
  @MinLength(1)
  public readonly invitationId!: string;
}

export class ReasonedChangeBody {
  @ApiProperty({ description: 'Why. Recorded, and reviewable later.' })
  @IsString()
  @Length(1, 512)
  public readonly reason!: string;

  @ApiProperty({ description: 'The version the caller read. A stale write is refused.' })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class AdmitMemberBody {
  @ApiProperty({ description: "The person's immutable Platform account identifier." })
  @IsString()
  @Length(1, 255)
  public readonly platformUserId!: string;
}

export class ChangeMembershipBody extends ReasonedChangeBody {
  @ApiProperty({ enum: ['suspend', 'reinstate', 'end'] })
  @IsIn(['suspend', 'reinstate', 'end'])
  public readonly transition!: 'suspend' | 'reinstate' | 'end';
}

export class GrantPortalBody {
  @ApiProperty({ enum: PORTAL_KEYS })
  @IsIn(PORTAL_KEYS)
  public readonly portal!: PortalKey;
}

export class LinkEmploymentBody {
  @ApiProperty({ description: "Employment's identifier. Owned by the Employment module." })
  @IsString()
  @Length(36, 36)
  public readonly employmentId!: string;

  @ApiProperty({ description: 'Whether this becomes the member’s main job.' })
  @IsBoolean()
  public readonly isPrimary!: boolean;
}

export class CreateDelegationBody {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  public readonly delegateMembershipId!: string;

  @ApiProperty({ example: 'leave.approve', description: 'Opaque to this module.' })
  @IsString()
  @Length(1, 128)
  public readonly scope!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsISO8601()
  public readonly effectiveFrom!: string;

  @ApiProperty({ example: '2026-09-15T00:00:00.000Z' })
  @IsISO8601()
  public readonly effectiveTo!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 512)
  public readonly reason!: string;
}

export class ReviseProfileBody {
  @ApiProperty({
    description: 'Language tag to text. Both first-class languages are required.',
    example: { en: 'Sara Haddad', ar: 'سارة حداد' },
  })
  @IsObject()
  public readonly displayName!: Record<string, string>;

  @ApiPropertyOptional({ description: 'Language tag to text.' })
  @IsOptional()
  @IsObject()
  public readonly jobTitle?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  public readonly businessEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly businessPhone?: string;

  @ApiPropertyOptional({ description: 'Omitted when the profile is created for the first time.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly expectedVersion?: number;
}

export class RevisePreferenceBody {
  @ApiPropertyOptional({ example: 'ar' })
  @IsOptional()
  @IsString()
  @Length(2, 35)
  public readonly language?: string;

  @ApiPropertyOptional({ enum: ['gregorian', 'hijri'] })
  @IsOptional()
  @IsIn(['gregorian', 'hijri'])
  public readonly calendar?: 'gregorian' | 'hijri';

  @ApiPropertyOptional({ example: 'Asia/Riyadh' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly timeZone?: string;

  @ApiPropertyOptional({ enum: NUMERAL_SYSTEMS })
  @IsOptional()
  @IsIn(NUMERAL_SYSTEMS)
  public readonly numerals?: NumeralSystem;

  @ApiProperty()
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly status?: string;
}

export class SearchQuery {
  @ApiProperty({ description: 'Matched against every language the profile carries.' })
  @IsString()
  @MinLength(1)
  public readonly term!: string;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly limit?: number;
}
