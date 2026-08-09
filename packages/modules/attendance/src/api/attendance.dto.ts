import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  CORRECTION_KINDS,
  EVENT_KINDS,
  EVENT_SOURCES,
  ROSTER_KINDS,
} from '../domain/attendance-vocabulary.js';

/**
 * The wire shapes for recording time, correcting it and signing it off.
 *
 * **No body names a punching employee's identity as "me" and no body names an approver.** The
 * requester of a correction, the person who decided it and the person who signed a day off are all
 * taken from the authenticated context. An approval a caller could attribute to a colleague is not
 * evidence that anybody looked at the day.
 *
 * **`reportedAt` is what the client claims, never what is believed.** Ingestion compares it with
 * the server's receipt and, beyond the tenant's tolerance, records the punch at the receipt instead
 * — keeping the claim, the receipt and the drift all visible on the row.
 *
 * **A location is punch evidence, not a work location.** There is no site identifier here, no
 * geofence and no verdict, because this product has no authoritative location model to check a
 * coordinate against and a verdict with nothing behind it would be a claim (ADR-0055).
 */

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

const MAX_NOTE = 1024;
const MAX_MINUTES_IN_DAY = 1440;
const MAX_ACCURACY_METRES = 100_000;

export class VersionedBody {
  @ApiProperty({
    description: 'The version read. A write that lost a race is refused, not merged.',
  })
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class BilingualName {
  @ApiProperty({ description: 'English. Required: a name in one language only is half a record.' })
  @IsString()
  @Length(1, 200)
  public readonly en!: string;

  @ApiProperty({ description: 'Arabic.' })
  @IsString()
  @Length(1, 200)
  public readonly ar!: string;
}

/** Punch location evidence. Complete or absent — half a coordinate is evidence of nothing. */
export class PunchLocationBody {
  @ApiProperty()
  @IsLatitude()
  public readonly latitude!: number;

  @ApiProperty()
  @IsLongitude()
  public readonly longitude!: number;

  @ApiPropertyOptional({ description: "The device's own accuracy estimate, in metres." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ACCURACY_METRES)
  public readonly accuracyMetres?: number;
}

export class RecordEventBody {
  @ApiProperty({ description: 'An employment that already exists. Never created here.' })
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ enum: EVENT_KINDS })
  @IsIn(EVENT_KINDS)
  public readonly kind!: (typeof EVENT_KINDS)[number];

  @ApiProperty({
    enum: EVENT_SOURCES,
    description: 'A vendor is not a source: every reader arrives as `device` (ADR-0057).',
  })
  @IsIn(EVENT_SOURCES)
  public readonly source!: (typeof EVENT_SOURCES)[number];

  @ApiPropertyOptional({
    description: 'Send one from any client that may retry. Only the client knows its third try.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly idempotencyKey?: string;

  @ApiPropertyOptional({ description: "The originating system's own identifier. Opaque." })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly sourceReference?: string;

  @ApiPropertyOptional({ description: 'Which reader. An operational fact, not a place of work.' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  public readonly deviceReference?: string;

  @ApiPropertyOptional({ description: 'What the client says. Defaults to now; never trusted far.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  public readonly reportedAt?: Date;

  @ApiPropertyOptional({ description: 'Captured with no connection and flushed later.' })
  @IsOptional()
  @IsBoolean()
  public readonly capturedOffline?: boolean;

  @ApiPropertyOptional({ type: PunchLocationBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => PunchLocationBody)
  public readonly location?: PunchLocationBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, MAX_NOTE)
  public readonly note?: string;

  @ApiPropertyOptional({ description: 'Stored and returned, never interpreted. No personal data.' })
  @IsOptional()
  @IsObject()
  public readonly metadata?: Record<string, string>;
}

export class RecalculateBody {
  @ApiPropertyOptional({ description: 'One employment and date, or nothing for the stale queue.' })
  @IsOptional()
  @IsUUID()
  public readonly employmentId?: string;

  @ApiPropertyOptional({ example: '2026-05-04' })
  @IsOptional()
  @Matches(CIVIL_DATE_PATTERN)
  public readonly attendanceDate?: string;

  @ApiPropertyOptional({ description: 'A run is bounded so it finishes.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  public readonly limit?: number;
}

export class RequestCorrectionBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ example: '2026-05-04' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly attendanceDate!: string;

  @ApiProperty({ enum: CORRECTION_KINDS })
  @IsIn(CORRECTION_KINDS)
  public readonly kind!: (typeof CORRECTION_KINDS)[number];

  @ApiPropertyOptional({ description: 'Required to amend or remove; forbidden to add.' })
  @IsOptional()
  @IsUUID()
  public readonly targetEventId?: string;

  @ApiPropertyOptional({ enum: EVENT_KINDS })
  @IsOptional()
  @IsIn(EVENT_KINDS)
  public readonly proposedKind?: (typeof EVENT_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  public readonly proposedOccurredAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES_IN_DAY)
  public readonly proposedMinutes?: number;

  @ApiProperty({ description: 'A catalogue key. Why the record was wrong.' })
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;

  @ApiProperty({ description: 'What actually happened, in words a reviewer can act on.' })
  @IsString()
  @Length(1, MAX_NOTE)
  public readonly justification!: string;
}

export class DecideCorrectionBody extends VersionedBody {
  @ApiProperty({ description: 'The decision. Refused when the decider is the requester.' })
  @IsBoolean()
  public readonly approve!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, MAX_NOTE)
  public readonly note?: string;
}

export class ResolveExceptionBody extends VersionedBody {
  @ApiProperty({
    enum: ['resolved', 'waived'],
    description: '"We dealt with it" and "it did not apply" are different answers.',
  })
  @IsIn(['resolved', 'waived'])
  public readonly outcome!: 'resolved' | 'waived';

  @ApiProperty()
  @Matches(CODE_PATTERN)
  public readonly reasonCode!: string;
}

export class RosterBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ example: '2026-05-04' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly onDate!: string;

  @ApiProperty({
    enum: ROSTER_KINDS,
    description: 'A public holiday lives here until a country pack supplies a calendar (D-2).',
  })
  @IsIn(ROSTER_KINDS)
  public readonly kind!: (typeof ROSTER_KINDS)[number];

  @ApiPropertyOptional({ description: 'Required for a `shift` entry, forbidden otherwise.' })
  @IsOptional()
  @IsUUID()
  public readonly shiftId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE_PATTERN)
  public readonly reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, MAX_NOTE)
  public readonly note?: string;

  @ApiPropertyOptional({ description: 'Required when an entry already exists: this replaces it.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  public readonly expectedVersion?: number;
}

export class FreezePeriodBody {
  @ApiProperty({ example: '2026-05-01' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly periodStart!: string;

  @ApiProperty({ example: '2026-05-31' })
  @Matches(CIVIL_DATE_PATTERN)
  public readonly periodEnd!: string;

  @ApiProperty({
    description: 'One employment. A freeze is per person, so a period can be closed as it settles.',
  })
  @IsUUID()
  public readonly employmentId!: string;
}
