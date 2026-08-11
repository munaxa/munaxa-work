import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * What a caller may send, and the shapes that refuse a malformed request before a handler sees it.
 *
 * Two rules run through this file.
 *
 * **A file size arrives as a string**, matched against `^\d+$`. A JSON number loses precision above
 * 2^53 and a file can exceed that; a size that rounded would make a later byte-for-byte comparison
 * meaningless.
 *
 * **No endpoint accepts file content.** There is no base64 field, no multipart body and no upload
 * route anywhere in this module. `storageReference` is an opaque key a caller obtained elsewhere,
 * and it is validated as a key rather than as a URL — nothing may infer a provider from it, and
 * nothing here accepts one.
 *
 * Nothing in this file is a persistence model. A DTO is the request's shape; the view a handler
 * returns is assembled separately, so a column rename is not an API change.
 */

const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BYTES = /^\d+$/;
const SHA_256 = /^[0-9a-f]{64}$/;

/**
 * A storage reference, in the shape three modules already validate — **plus one refusal they lack**.
 *
 * The shared expression permits `:` and `/` because a key may legitimately contain both, and the
 * consequence is that it also permits `s3://bucket/key` and `https://host/path`. Employment,
 * Recruitment and Onboarding all carry that expression as it stands; changing theirs is a
 * cross-phase refactor this phase does not make (D-25), so Documents adds the refusal on its own
 * side and records the inconsistency as debt.
 *
 * The refusal matters because a reference is **not** a URL: a caller that could send one would be
 * choosing this module's storage provider from outside it, and a value carrying a scheme is one
 * somebody could try to resolve directly rather than through an authorized, audited download.
 *
 * Both checks are here rather than only in the domain so a malformed reference is a **400** — the
 * client's mistake, fixable by sending different bytes — rather than a 422, which says the request
 * was understood and the rule declined it.
 */
const STORAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const NOT_ADDRESSED = /^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/)/;

export class LocalizedNameBody {
  @ApiProperty({ example: 'Passport' })
  @IsString()
  @IsNotEmpty()
  public readonly en!: string;

  @ApiProperty({ example: 'جواز سفر' })
  @IsString()
  @IsNotEmpty()
  public readonly ar!: string;
}

export class DefineTypeBody {
  @ApiProperty({ example: 'passport' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedNameBody })
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public readonly name!: LocalizedNameBody;

  @ApiProperty({ example: ['person'] })
  @IsArray()
  @IsIn(['person', 'employment', 'legal_entity'], { each: true })
  public readonly ownerTypes!: readonly string[];

  @ApiProperty()
  @IsBoolean()
  public readonly expires!: boolean;

  @ApiProperty()
  @IsBoolean()
  public readonly requiresVerification!: boolean;

  @ApiProperty({ enum: ['normal', 'confidential'] })
  @IsIn(['normal', 'confidential'])
  public readonly confidentiality!: string;

  @ApiProperty()
  @IsBoolean()
  public readonly employeeVisible!: boolean;

  /** Refused for a confidential type by the domain and by a check constraint (D-9). */
  @ApiProperty()
  @IsBoolean()
  public readonly managerVisible!: boolean;

  /** Configuration only. **Nothing fires a notice** — no scheduler is verified (D-26). */
  @ApiPropertyOptional({ example: [90, 30] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3650, { each: true })
  public readonly noticeDays?: readonly number[];

  /** An opaque code this module stores and never interprets (D-11). */
  @ApiPropertyOptional({ example: 'kingdom-7y' })
  @IsOptional()
  @Matches(CODE)
  public readonly retentionPolicyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly countryPackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  public readonly countryPackVersion?: number;
}

export class AmendTypeBody {
  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;

  @ApiPropertyOptional({ type: LocalizedNameBody })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public readonly name?: LocalizedNameBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly employeeVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly managerVisible?: boolean;

  @ApiPropertyOptional({ example: [60] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3650, { each: true })
  public readonly noticeDays?: readonly number[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(CODE)
  public readonly retentionPolicyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly active?: boolean;
}

export class CreateDocumentBody {
  @ApiProperty()
  @IsUUID()
  public readonly documentTypeId!: string;

  @ApiProperty({ enum: ['person', 'employment', 'legal_entity'] })
  @IsIn(['person', 'employment', 'legal_entity'])
  public readonly ownerType!: string;

  @ApiProperty()
  @IsUUID()
  public readonly ownerId!: string;

  /**
   * Set only where this document evidences an identifier People owns.
   *
   * When it is set, this module stores **no expiry of its own** — the domain refuses one and a
   * check constraint refuses it again. There is one authoritative answer to when a passport
   * expires and it is not here (D-1a).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly personIdentifierId?: string;

  @ApiProperty({ type: LocalizedNameBody })
  @ValidateNested()
  @Type(() => LocalizedNameBody)
  public readonly title!: LocalizedNameBody;

  @ApiPropertyOptional({ example: '2019-05-04' })
  @IsOptional()
  @Matches(ISO_DATE)
  public readonly issueDate?: string;

  @ApiPropertyOptional({ example: '2029-05-04' })
  @IsOptional()
  @Matches(ISO_DATE)
  public readonly expiryDate?: string;

  @ApiPropertyOptional({ enum: ['direct', 'recruitment', 'onboarding', 'letter', 'migration'] })
  @IsOptional()
  @IsIn(['direct', 'recruitment', 'onboarding', 'letter', 'migration'])
  public readonly source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly sourceReference?: string;
}

/**
 * A new version of a document's file.
 *
 * **This route carries no bytes.** `storageReference` is an opaque key the caller obtained from
 * whatever put the object there; this module never sees the content, never hashes it and never
 * checks that `contentHash` describes it. `hashVerified` is false on every row for that reason, and
 * the view says so.
 */
export class AddVersionBody {
  @ApiProperty({ example: 'documents/2026/08/8f1c2a' })
  @Matches(STORAGE_REFERENCE)
  @Matches(NOT_ADDRESSED, { message: 'storageReference must not be a URL' })
  public readonly storageReference!: string;

  @ApiProperty({ example: 'passport.pdf' })
  @IsString()
  @IsNotEmpty()
  public readonly originalFileName!: string;

  /** What the client *claims* the file is. Nothing inspects content to confirm it. */
  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  public readonly declaredMediaType!: string;

  /** Exact bytes as a decimal string. **Never a JSON number.** */
  @ApiProperty({ example: '2048' })
  @Matches(BYTES)
  public readonly sizeInBytes!: string;

  /** SHA-256, lower-case hex. The only algorithm this module writes (D-5a). */
  @ApiProperty({ example: 'a'.repeat(64) })
  @Matches(SHA_256)
  public readonly contentHash!: string;

  @ApiPropertyOptional({ enum: ['direct', 'recruitment', 'onboarding', 'letter', 'migration'] })
  @IsOptional()
  @IsIn(['direct', 'recruitment', 'onboarding', 'letter', 'migration'])
  public readonly source?: string;
}

export class VerifyBody {
  @ApiProperty()
  @IsUUID()
  public readonly documentVersionId!: string;

  @ApiProperty({ enum: ['verified', 'rejected'] })
  @IsIn(['verified', 'rejected'])
  public readonly decision!: string;

  /** Required by a check constraint for a rejection: one nobody can act on is no rejection. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly reason?: string;
}

export class MoveDocumentBody {
  @ApiProperty({ enum: ['draft', 'active', 'archived', 'superseded'] })
  @IsIn(['draft', 'active', 'archived', 'superseded'])
  public readonly status!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class LegalHoldBody {
  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;

  @ApiProperty()
  @IsBoolean()
  public readonly hold!: boolean;

  /** Required to place one: a hold nobody can explain is a hold nobody can lift. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly reason?: string;
}

export class AuthorizeDownloadBody {
  /** Defaults to the document's current version. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly documentVersionId?: string;
}
