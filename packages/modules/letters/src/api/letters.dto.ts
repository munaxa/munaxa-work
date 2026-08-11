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
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * What a caller may send, and the shapes that refuse a malformed request before a handler sees it.
 *
 * The one worth reading twice is `variables`. A variable name is `[a-z][A-Za-z0-9]*` with up to
 * three dotted segments and **nothing else** — no operators, no parentheses, no function call.
 * That narrowness is the whole safety model: a tenant authors the template, the template is
 * executed against another employee's salary, and substitution is a map lookup rather than an
 * evaluation. A body's placeholders must all be declared here, so a typo is refused for the person
 * who wrote it instead of failing for the employee who asked for a certificate.
 *
 * Nothing in this file is a persistence model. A DTO is the request's shape; the view a handler
 * returns is assembled separately, so a column rename is not an API change.
 */

const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const VARIABLE = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*){0,3}$/;
const LETTERHEAD = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;

export class LocalizedTextBody {
  @ApiProperty({ example: 'Employment certificate' })
  @IsString()
  @IsNotEmpty()
  public readonly en!: string;

  @ApiProperty({ example: 'شهادة عمل' })
  @IsString()
  @IsNotEmpty()
  public readonly ar!: string;
}

export class DefineTemplateBody {
  @ApiProperty({ example: 'employment-certificate' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty({ example: 'employment' })
  @Matches(CODE)
  public readonly category!: string;

  /** The template decides, not the requester: a caller cannot skip a control by asking differently. */
  @ApiProperty()
  @IsBoolean()
  public readonly requiresApproval!: boolean;

  @ApiProperty()
  @IsBoolean()
  public readonly employeeRequestable!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly countryPackId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  public readonly countryPackVersion?: number;
}

/**
 * A template version's content.
 *
 * **Both languages are required.** A template authored only in English is a letter an Arabic
 * speaker cannot be issued.
 */
export class VersionBody {
  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly body!: LocalizedTextBody;

  @ApiProperty({ example: ['person.fullName', 'employment.startDate'] })
  @IsArray()
  @Matches(VARIABLE, { each: true })
  public readonly variables!: readonly string[];

  /**
   * The template's own allow-list, and the first of AD-005's two gates on pay.
   *
   * Declaring `salary` here is not enough to print one: the issuer must also hold
   * `letter.include-salary`.
   */
  @ApiProperty({ example: ['person', 'employment'] })
  @IsArray()
  @IsIn(['person', 'employment', 'organization', 'salary', 'payroll'], { each: true })
  public readonly exposedFields!: readonly string[];

  @ApiPropertyOptional({ example: 'letterheads/default' })
  @IsOptional()
  @Matches(LETTERHEAD)
  public readonly letterheadReference?: string;

  /** Declares that a human must sign. **Never claims one did** — no provider exists (D-16). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public readonly requiresSignature?: boolean;
}

export class AmendVersionBody extends VersionBody {
  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class MoveVersionBody {
  @ApiProperty({ enum: ['draft', 'published', 'retired'] })
  @IsIn(['draft', 'published', 'retired'])
  public readonly status!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class RequestLetterBody {
  @ApiProperty()
  @IsUUID()
  public readonly letterTemplateId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly personId!: string;

  @ApiProperty({ enum: ['en', 'ar'] })
  @IsIn(['en', 'ar'])
  public readonly locale!: string;

  @ApiPropertyOptional({ example: 'Bank account opening' })
  @IsOptional()
  @IsString()
  public readonly purpose?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly addressee?: string;
}

export class DecideLetterBody {
  @ApiProperty({ enum: ['approved', 'rejected', 'reversed'] })
  @IsIn(['approved', 'rejected', 'reversed'])
  public readonly decision!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public readonly comment?: string;

  /** Required for a reversal: the decision this one reverses. Both rows stay. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly reversesId?: string;
}

export class CancelLetterBody {
  @ApiProperty()
  @IsInt()
  @Min(1)
  public readonly expectedVersion!: number;
}

export class IssueLetterBody {
  @ApiPropertyOptional({ example: 'Head of Human Resources' })
  @IsOptional()
  @IsString()
  public readonly signatory?: string;

  /** A correction: the letter this one replaces. The original is never overwritten. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly supersedesId?: string;
}

/**
 * The third-party check.
 *
 * The token is the only input, and it must be the full width — a short one would be a token
 * somebody could enumerate, and enumerating this endpoint would turn it into a public register of
 * who works where.
 */
export class VerifyLetterBody {
  @ApiProperty({ example: 'a'.repeat(64) })
  @IsString()
  @Length(32, 64)
  public readonly verificationToken!: string;
}
