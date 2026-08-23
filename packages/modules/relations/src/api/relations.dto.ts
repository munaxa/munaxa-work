import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * What a caller may send, and the shapes that refuse a malformed request before a handler sees it.
 *
 * Three rules run through this file, and each is a thing a caller must **not** be able to send.
 *
 * **No `tenantId`.** Not on any body, not on any route. Tenancy comes from the execution context and
 * row-level security filters beneath it — a caller who could name a tenant could file a disciplinary
 * record into somebody else's organisation.
 *
 * **No actor, reporter or author.** `reported_by` is the authenticated caller, taken from the
 * context. A field here would let anyone file an allegation under a colleague's name, which is the
 * one forgery this record must not permit.
 *
 * **No instant.** `occurredOn` is the civil day the conduct happened, and the moment of recording is
 * the server's. A caller who could set the recording time could backdate a disciplinary record.
 *
 * Nothing in this file is a persistence model. A DTO is the request's shape; the view a handler
 * returns is assembled separately, so a column rename is not an API change.
 */

const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LocalizedNameBody {
  @ApiProperty({ example: 'Unauthorized absence' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public en!: string;

  @ApiProperty({ example: 'غياب غير مصرح به' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public ar!: string;
}

/**
 * A new catalogue entry.
 *
 * `severity` is a free string on purpose: a closed list would be this product deciding what counts
 * as serious for every customer in every jurisdiction, which AD-002 forbids. It is bounded in length
 * and required to be non-blank, and **nothing sorts by it**.
 *
 * `source` accepts `country_pack`, and the domain then requires a pack identifier with it. **No pack
 * exists yet** — Phase 11.1 supplies them — so in practice every entry written today is `tenant`.
 * The value is here so provenance is recorded rather than guessed once packs arrive.
 */
export class DefineCategoryBody {
  @ApiProperty({ pattern: CODE.source, example: 'unauthorized-absence' })
  @Matches(CODE)
  public code!: string;

  @ApiProperty({ type: LocalizedNameBody })
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public name!: LocalizedNameBody;

  @ApiProperty({ description: "The tenant's own word. Never interpreted or ordered by." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  public severity!: string;

  @ApiProperty({ minimum: 0, description: 'Ordering, as data. Ties break on code.' })
  @IsInt()
  @Min(0)
  public sequence!: number;

  @ApiProperty({
    minimum: 0,
    description: 'How far back a prior violation counts. Configuration; nothing reads it yet.',
  })
  @IsInt()
  @Min(0)
  public repeatWindowDays!: number;

  @ApiProperty({ enum: ['tenant', 'country_pack'], example: 'tenant' })
  @IsIn(['tenant', 'country_pack'])
  public source!: string;

  @ApiPropertyOptional({ description: 'Required when source is country_pack. No pack exists yet.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  public countryPackId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  public countryPackVersion?: number;
}

/**
 * An amendment. **`code` and `source` are absent, and that is the contract.**
 *
 * Recorded violations froze a copy of the code, so changing it would leave the frozen copy
 * disagreeing with the entry it came from; and `source` is a claim about which authority wrote the
 * rule, which a tenant cannot change by editing a field.
 */
export class AmendCategoryBody {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public expectedVersion!: number;

  @ApiPropertyOptional({ type: LocalizedNameBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public name?: LocalizedNameBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  public severity?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  public sequence?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  public repeatWindowDays?: number;

  @ApiPropertyOptional({
    description: 'Deactivation is how an entry leaves service. There is no delete.',
  })
  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

/**
 * A violation, as a caller may state it.
 *
 * Four fields. There is no reporter, no recording time, no tenant, no state and no evidence — each
 * absent for a reason given at the top of this file or excluded from Checkpoint 1 entirely.
 */
export class RecordViolationBody {
  @ApiProperty({ format: 'uuid', description: 'An employment. Never a person (AD-001).' })
  @IsUUID()
  public employmentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public violationCategoryId!: string;

  @ApiProperty({ pattern: ISO_DATE.source, example: '2026-08-14' })
  @Matches(ISO_DATE)
  public occurredOn!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  public description!: string;
}
