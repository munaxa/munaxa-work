import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
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
} from 'class-validator';

import {
  CALENDAR_DAY_KINDS,
  POSITION_CRITICALITIES,
  type CalendarDayKind,
  type PositionCriticality,
} from '../domain/organization-vocabulary.js';

import { BilingualTextBody, DefineUnitTypeBody, VersionedBody } from './organization.dto.js';

/**
 * The wire shapes for the catalogue, the establishment, calendars, settings and bulk transfer.
 *
 * Split from `organization.dto.ts` at the point where the structure ends and planning begins,
 * so neither file grows past the budget the standards set — and so a reader looking for the
 * shape of a calendar day is not scrolling through unit placement.
 */

/** A code: ASCII, because it travels into payroll files and government uploads. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class DefinePositionBody {
  @ApiProperty({ example: 'HR-MGR' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly title!: Record<string, string>;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional({ description: 'A grouping the tenant authors, not a list we ship.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly family?: string;

  @ApiPropertyOptional({ description: "The tenant's own grade label. Compensation owns its pay." })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly grade?: string;

  @ApiPropertyOptional({ enum: POSITION_CRITICALITIES })
  @IsOptional()
  @IsIn(POSITION_CRITICALITIES)
  public readonly criticality?: PositionCriticality;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class RevisePositionBody extends VersionedBody {
  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly title?: Record<string, string>;

  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly description?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly family?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly grade?: string;

  @ApiPropertyOptional({ enum: POSITION_CRITICALITIES })
  @IsOptional()
  @IsIn(POSITION_CRITICALITIES)
  public readonly criticality?: PositionCriticality;
}

export class SetEstablishmentBody {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  public readonly positionId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 64)
  public readonly unitId!: string;

  @ApiProperty({ description: 'Budgeted headcount. Never a count of employees.' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  public readonly budgetedHeadcount!: number;

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class DefineCalendarBody {
  @ApiProperty({ example: 'CORP' })
  @Matches(CODE_PATTERN)
  public readonly code!: string;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;

  @ApiPropertyOptional({ description: 'Absent means the calendar applies tenant-wide.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly unitId?: string;

  @ApiProperty({ example: 'Asia/Riyadh' })
  @IsString()
  @Length(1, 64)
  public readonly timeZone!: string;

  @ApiProperty({
    description: 'ISO-8601 weekdays ordinarily worked: Monday is 1, Sunday is 7. No default.',
    isArray: true,
    type: Number,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  public readonly workingDays!: number[];

  @ApiProperty()
  @IsISO8601()
  public readonly effectiveFrom!: string;
}

export class AmendCalendarBody extends VersionedBody {
  @ApiPropertyOptional({ type: BilingualTextBody })
  @IsOptional()
  @IsObject()
  public readonly name?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly timeZone?: string;

  @ApiPropertyOptional({ isArray: true, type: Number })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  public readonly workingDays?: number[];
}

export class RecordCalendarDayBody {
  @ApiProperty({
    example: '2027-03-20',
    description: "A civil date in the calendar's own time zone. A holiday is a day, not a moment.",
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  public readonly onDate!: string;

  @ApiProperty({ enum: CALENDAR_DAY_KINDS })
  @IsIn(CALENDAR_DAY_KINDS)
  public readonly kind!: CalendarDayKind;

  @ApiProperty({ type: BilingualTextBody })
  @IsObject()
  public readonly name!: Record<string, string>;
}

export class ConfigureTenantSettingsBody {
  @ApiProperty({ example: 'ar', description: 'A BCP 47 tag, not a list this product ships.' })
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  public readonly language!: string;

  @ApiProperty({ enum: ['gregorian', 'hijri'] })
  @IsIn(['gregorian', 'hijri'])
  public readonly calendar!: string;

  @ApiProperty({ example: 'Asia/Riyadh' })
  @IsString()
  @Length(1, 64)
  public readonly timeZone!: string;

  @ApiProperty({ enum: ['western', 'arabic-indic'] })
  @IsIn(['western', 'arabic-indic'])
  public readonly numerals!: string;

  @ApiProperty({ description: 'How long an invitation stays open.' })
  @IsInt()
  @Min(1)
  @Max(365)
  public readonly invitationValidityDays!: number;

  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  public readonly defaultPortals!: string[];

  @ApiPropertyOptional({
    description: 'Absent on the first submission — nothing yet has a version.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  public readonly expectedVersion?: number;
}

export class ImportedUnitTypeBody extends DefineUnitTypeBody {}

export class ImportStructureBody {
  @ApiProperty({ type: ImportedUnitTypeBody, isArray: true })
  @IsArray()
  public readonly unitTypes!: ImportedUnitTypeBody[];

  @ApiProperty({ isArray: true, type: Object })
  @IsArray()
  public readonly units!: {
    code: string;
    unitTypeCode: string;
    name: Record<string, string>;
    description?: Record<string, string>;
    metadata?: Record<string, string>;
    parentCode?: string;
    effectiveFrom: string;
  }[];
}
