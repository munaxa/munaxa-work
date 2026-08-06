import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
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
  Min,
} from 'class-validator';

import {
  ORGANIZATION_STATUSES,
  type OrganizationStatus,
} from '../domain/organization-vocabulary.js';

/**
 * The wire shapes.
 *
 * Validated at the edge with `class-validator`, so a malformed request never reaches a handler
 * and a rejection is a 400 with field detail rather than an exception from somewhere deeper. The
 * global `ValidationPipe` runs with `forbidNonWhitelisted`, so an undeclared property is refused
 * rather than silently dropped — which is what stops a client believing it set something the
 * server ignored.
 *
 * Every mutating shape that touches an existing row carries `expectedVersion`, required rather
 * than optional: a client that cannot say which version it read cannot be protected from
 * overwriting somebody else's change.
 *
 * Names arrive as objects keyed by language tag, never as a string. An endpoint that accepted a
 * bare name would be an endpoint through which an organization acquires English-only units, and
 * no amount of translating afterwards recovers a name nobody was asked for.
 */

/** A code: ASCII, because it travels into payroll files and government uploads. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class BilingualTextBody {
  @ApiProperty({ example: 'Riyadh Operations' })
  @IsString()
  @Length(1, 512)
  public readonly en!: string;

  @ApiProperty({ example: 'عمليات الرياض' })
  @IsString()
  @Length(1, 512)
  public readonly ar!: string;
}

export class DefineUnitTypeBody {
  @ApiProperty({ example: 'department' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiProperty({ description: 'Display order. Not a depth — depth is a placement, not a type.' })
  @IsInt()
  @Min(0)
  public readonly ordinal!: number;

  @ApiPropertyOptional({
    description: 'Which type codes may parent this one. Empty or absent means any.',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Matches(CODE_PATTERN, { each: true })
  public readonly allowedParentCodes?: string[];

  @ApiPropertyOptional({ description: 'Whether a unit of this type may sit at the top.' })
  @IsOptional()
  @IsBoolean()
  public readonly allowedAtRoot?: boolean;

  @ApiPropertyOptional({ description: 'Whether units of this type carry a legal registration.' })
  @IsOptional()
  @IsBoolean()
  public readonly carriesLegalEntity?: boolean;
}

export class VersionedBody {
  @ApiProperty({ description: 'The version the caller read. A stale write is refused.' })
  @IsInt()
  @Min(0)
  public readonly expectedVersion!: number;
}

export class CreateUnitBody {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  public readonly unitTypeId!: string;

  @ApiProperty({ example: 'RUH-HR' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Tenant-authored, stored and never interpreted.' })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;

  @ApiProperty({ description: 'When the unit came into existence. Back-dating is ordinary.' })
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class RenameUnitBody extends VersionedBody {
  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;
}

export class ChangeUnitStatusBody extends VersionedBody {
  @ApiProperty({ enum: ORGANIZATION_STATUSES })
  @IsIn(ORGANIZATION_STATUSES)
  public readonly status!: OrganizationStatus;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveAt!: string;
}

export class ReviseMetadataBody extends VersionedBody {
  @ApiProperty()
  @IsObject()
  public readonly metadata!: Record<string, string>;
}

export class PlaceUnitBody {
  @ApiPropertyOptional({ description: 'Absent makes this unit a root of the structure.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly parentUnitId?: string;

  @ApiProperty({ description: 'From when. The period in force at this date is closed at it.' })
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class DetachUnitBody extends VersionedBody {
  @ApiProperty()
  @IsISO8601()
  public readonly effectiveTo!: string;
}

export class RegisterLegalEntityBody {
  @ApiProperty({ description: 'ISO 3166-1 alpha-2. Never validated against a list of countries.' })
  @Matches(/^[A-Z]{2}$/)
  public readonly countryCode!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly registeredName!: Record<string, string>;

  @ApiProperty()
  @IsString()
  @Length(1, 64)
  public readonly registrationNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly taxIdentifier?: string;

  @ApiProperty({ description: 'ISO 4217. Payroll currency, from the entity and not the tenant.' })
  @Matches(/^[A-Z]{3}$/)
  public readonly currencyCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  public readonly incorporatedOn?: string;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class AmendLegalEntityBody extends VersionedBody {
  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly registeredName?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly taxIdentifier?: string;

  @ApiPropertyOptional({ description: 'The country is deliberately not amendable.' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  public readonly currencyCode?: string;
}

export class CloseEffectiveBody extends VersionedBody {
  @ApiProperty()
  @IsISO8601()
  public readonly effectiveTo!: string;
}

export class OpenCenterBody {
  @ApiProperty({ example: 'CC-4400' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiPropertyOptional({ description: 'A shared services centre legitimately belongs to none.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}
