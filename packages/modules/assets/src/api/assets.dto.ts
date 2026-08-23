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

import { ASSET_STATUSES } from '../domain/assets-vocabulary.js';
import {
  ASSET_TAG_LIMIT,
  DESCRIPTION_LIMIT,
  LOCATION_NOTE_LIMIT,
  PURCHASE_REFERENCE_LIMIT,
  SERIAL_NUMBER_LIMIT,
} from '../domain/asset.js';

/**
 * What a caller may send, and the shapes that refuse a malformed request before a handler sees it.
 *
 * Three rules run through this file, and each is a thing a caller must **not** be able to send.
 *
 * **No `tenantId`.** Not on any body, not on any route. Tenancy comes from the execution context and
 * row-level security filters beneath it — a caller who could name a tenant could register an asset
 * into somebody else's organisation, or read one out of it.
 *
 * **No actor.** Who registered an item and who last amended it are `created_by` and `updated_by`,
 * written by infrastructure from the authenticated context. There is no field here for either, which
 * is the strongest way to guarantee a caller cannot supply one.
 *
 * **No status on registration.** Every asset starts `registered` and moves through the transition
 * route, which validates the move. A caller who could set the initial status could register an asset
 * directly as `retired` — a disposal nobody recorded.
 *
 * **And no custody, anywhere.** No employment, no person, no holder, no acknowledgement, no condition
 * and no amount. Checkpoint 1 records what the company owns; who holds it is Checkpoint 2's.
 *
 * Nothing in this file is a persistence model. A DTO is the request's shape; the view a handler
 * returns is assembled separately, so a column rename is not an API change.
 */

const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export class LocalizedNameBody {
  @ApiProperty({ example: 'Laptop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public en!: string;

  @ApiProperty({ example: 'حاسوب محمول' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public ar!: string;
}

/**
 * A new catalogue entry.
 *
 * There is no condition scale, no acknowledgement requirement, no return requirement and no valuation
 * basis, because there are none on the table: each configures a capability this checkpoint does not
 * build, and two are downstream of decisions that are still open.
 */
export class DefineAssetCategoryBody {
  @ApiProperty({ pattern: CODE.source, example: 'laptop' })
  @Matches(CODE)
  public code!: string;

  @ApiProperty({ type: LocalizedNameBody })
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public name!: LocalizedNameBody;

  @ApiProperty({ minimum: 0, description: 'Ordering, as data. Ties break on code.' })
  @IsInt()
  @Min(0)
  public sequence!: number;
}

/** An amendment. `code` is absent: it is the entry's identity and assets point at it. */
export class AmendAssetCategoryBody {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public expectedVersion!: number;

  @ApiPropertyOptional({ type: LocalizedNameBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public name?: LocalizedNameBody;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  public sequence?: number;

  @ApiPropertyOptional({ description: 'Deactivation is how an entry leaves service. No delete.' })
  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

/**
 * A new item.
 *
 * `assetTag` is the tenant's own identifier and is required. `serialNumber` is the manufacturer's and
 * is optional — a chair has none — but unique per tenant when it is present.
 */
export class RegisterAssetBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public assetCategoryId!: string;

  @ApiProperty({ maxLength: ASSET_TAG_LIMIT, example: 'IT-00417' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASSET_TAG_LIMIT)
  public assetTag!: string;

  @ApiPropertyOptional({ maxLength: SERIAL_NUMBER_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(SERIAL_NUMBER_LIMIT)
  public serialNumber?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_LIMIT)
  public description?: string;

  @ApiPropertyOptional({
    maxLength: LOCATION_NOTE_LIMIT,
    description: 'A note. Deliberately not an Organization unit reference.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_NOTE_LIMIT)
  public locationNote?: string;

  @ApiPropertyOptional({
    maxLength: PURCHASE_REFERENCE_LIMIT,
    description: 'A note. Deliberately not a Finance reference, and never an amount.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_REFERENCE_LIMIT)
  public purchaseReference?: string;
}

/**
 * An amendment. **`assetCategoryId`, `assetTag` and `status` are absent, and that is the contract.**
 *
 * The first two are the item's identity; the third moves only through the transition route.
 */
export class AmendAssetBody {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: SERIAL_NUMBER_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(SERIAL_NUMBER_LIMIT)
  public serialNumber?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_LIMIT)
  public description?: string;

  @ApiPropertyOptional({ maxLength: LOCATION_NOTE_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_NOTE_LIMIT)
  public locationNote?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_REFERENCE_LIMIT })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_REFERENCE_LIMIT)
  public purchaseReference?: string;
}

/**
 * A move through the in-service lifecycle.
 *
 * The four values are the ones an asset can actually be in. `issued`, `in_custody` and `returned` are
 * **not** here and are not statuses: they are facts about custody, and a custody row is what says who
 * holds an item.
 */
export class ChangeAssetStatusBody {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  public expectedVersion!: number;

  @ApiProperty({ enum: ASSET_STATUSES })
  @IsIn(ASSET_STATUSES)
  public status!: string;
}
