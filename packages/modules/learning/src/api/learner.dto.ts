import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ASSESSMENT_KINDS,
  ASSESSMENT_OUTCOMES,
  CERTIFICATION_SOURCES,
} from '../domain/learning-vocabulary.js';

import { CIVIL_DATE, EXACT_MARK, LocalizedTextBody, TEXT, VersionedBody } from './learning.dto.js';

/**
 * The wire shapes for what happens *to a person*: what they were asked to do, what they sat, what
 * they were assessed on, and what they hold.
 *
 * Everything the catalogue file says applies here — civil dates stay strings, an existing row is
 * touched only with the version the client read, and **no shape names its own actor**. The last of
 * those matters more on this side than on the catalogue side: a body that could name its author
 * would let somebody record a completion, a waiver, an assessment outcome or a certificate under a
 * colleague's name, and every one of those is evidence a compliance audit reads.
 *
 * **A mark is text and is never parsed.** `rawMark` is declared as a pattern-matched string and
 * carried through untouched, because the tenant typed `18.50` and `Number('18.50')` renders `18.5`
 * — a different value in a transcript, and one nobody could explain a year later. Nothing in this
 * module computes with it, so nothing here is entitled to normalize it.
 *
 * **No shape here carries a score, a threshold, a weight or an attempt number.** The specification
 * defines none of those, so an assessor states an outcome and this product totals nothing.
 */

const NOTE = 2000;
const NAME = 200;

// ------------------------------------------------------------------------------------------------
// Assessments
// ------------------------------------------------------------------------------------------------

/**
 * What a course version asks somebody to demonstrate.
 *
 * A kind, a title and whether an outcome is needed before completion. **There is no pass mark, no
 * weight and no attempt limit on this shape**, because there is none in the specification and
 * offering the field would invite a tenant to configure a rule nothing enforces.
 */
export class DefineAssessmentBody {
  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly title!: LocalizedTextBody;

  @ApiProperty({ enum: ASSESSMENT_KINDS })
  @IsIn([...ASSESSMENT_KINDS])
  public readonly kind!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  public readonly required!: boolean;
}

/**
 * One assessor's recorded outcome.
 *
 * `outcome` is stated, never derived. `rawMark` and `rawMarkScale` travel together and mean nothing
 * to this product: they are the tenant's own record of what was written on the day, kept exactly.
 */
export class RecordAssessmentResultBody {
  @ApiProperty()
  @IsUUID()
  public readonly enrolmentId!: string;

  @ApiProperty({
    enum: ASSESSMENT_OUTCOMES,
    description: 'Stated by an assessor. Nothing computes it.',
  })
  @IsIn([...ASSESSMENT_OUTCOMES])
  public readonly outcome!: string;

  @ApiPropertyOptional({
    example: '18.50',
    description: 'Kept as written. Never parsed — a parse would render this as 18.5.',
  })
  @IsOptional()
  @Matches(EXACT_MARK)
  public readonly rawMark?: string;

  @ApiPropertyOptional({ example: 'out of 20', description: 'What the mark is out of, in words.' })
  @IsOptional()
  @IsString()
  @Length(1, NAME)
  public readonly rawMarkScale?: string;

  @ApiProperty({ example: '2026-08-12' })
  @Matches(CIVIL_DATE)
  public readonly assessedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTE)
  public readonly notes?: string;
}

// ------------------------------------------------------------------------------------------------
// Assignments
// ------------------------------------------------------------------------------------------------

/**
 * Putting a named requirement on a named person's queue.
 *
 * There is **no `source` on the wire**. A direct assignment is direct; one generated from a rule
 * carries the rule that generated it and the occurrence it belongs to, and a client able to claim
 * `mandatory_rule` could forge a compliance record's provenance.
 */
export class AssignBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly courseId!: string;

  @ApiPropertyOptional({ description: 'The path this came from, where it came from one.' })
  @IsOptional()
  @IsUUID()
  public readonly pathId?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Overdue-ness is derived from this and the day asked about. No column holds it.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly dueOn?: string;
}

// ------------------------------------------------------------------------------------------------
// Enrolments
// ------------------------------------------------------------------------------------------------

/**
 * Putting somebody on a course.
 *
 * The course *version* is not on the wire: the enrolment pins whichever version is current when it
 * is created, so what somebody sat stays describable after the course is revised (AD-004). A
 * caller-supplied version would let a client enrol somebody onto content nobody is delivering.
 */
export class EnrolBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly courseId!: string;

  @ApiPropertyOptional({ description: 'The requirement this satisfies, where it satisfies one.' })
  @IsOptional()
  @IsUUID()
  public readonly assignmentId?: string;
}

/** Recording that somebody finished, on the day they finished. */
export class CompleteEnrolmentBody extends VersionedBody {
  @ApiProperty({
    example: '2026-08-12',
    description: 'The day it happened, not the day it was typed.',
  })
  @Matches(CIVIL_DATE)
  public readonly completedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTE)
  public readonly outcomeNote?: string;
}

/** Failing or withdrawing. Both end the enrolment; neither pretends it was completed. */
export class EndEnrolmentBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTE)
  public readonly note?: string;
}

// ------------------------------------------------------------------------------------------------
// Certifications
// ------------------------------------------------------------------------------------------------

/**
 * Issuing a certificate, and the one field that supersedes an earlier one.
 *
 * **There is no separate supersede route**, and `supersedesCertificationId` is why: superseding is
 * not something that happens to a certificate on its own, it is what issuing the *next* one does.
 * A route that could supersede without issuing would leave somebody holding nothing at all.
 *
 * **`validUntil` is optional and is not how expiry normally arrives.** A certificate issued from a
 * completion takes its validity from the course version the enrolment pinned, so the expiry of what
 * this product issues is this product's own answer (ADR-0070). A supplied `validUntil` is for a
 * certificate somebody else issued, where the date on the paper is the only truth there is.
 *
 * `evidenceDocumentId` is **a reference, not a file**. Nothing in this repository uploads, stores,
 * downloads or signs a URL for a document; the reference is confirmed to exist through Documents'
 * published query and kept.
 */
export class IssueCertificationBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiPropertyOptional({ description: 'The completion this was earned by, where there was one.' })
  @IsOptional()
  @IsUUID()
  public readonly enrolmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly courseId?: string;

  @ApiProperty({ example: 'Fire safety' })
  @IsString()
  @IsNotEmpty()
  @Length(1, NAME)
  public readonly title!: string;

  @ApiProperty({ enum: CERTIFICATION_SOURCES })
  @IsIn([...CERTIFICATION_SOURCES])
  public readonly source!: string;

  @ApiProperty({ example: '2026-08-12' })
  @Matches(CIVIL_DATE)
  public readonly issuedOn!: string;

  @ApiPropertyOptional({
    example: '2027-08-12',
    description: 'For a certificate this product did not issue. Otherwise derived from the course.',
  })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly validUntil?: string;

  @ApiPropertyOptional({
    description: 'The earlier certificate this replaces. See the class note.',
  })
  @IsOptional()
  @IsUUID()
  public readonly supersedesCertificationId?: string;

  @ApiPropertyOptional({
    description: 'A reference confirmed through Documents. Nothing here stores or serves bytes.',
  })
  @IsOptional()
  @IsUUID()
  public readonly evidenceDocumentId?: string;
}

// ------------------------------------------------------------------------------------------------
// Instructors
// ------------------------------------------------------------------------------------------------

/**
 * Somebody who delivers training: a colleague, or somebody from outside.
 *
 * Exactly one of the two is given. An internal instructor is an employment this product already
 * knows, and repeating their name here would create a second copy of it to go stale; an external
 * one is not in Employment at all, so their name has to live somewhere and this is where.
 */
export class RegisterInstructorBody {
  @ApiPropertyOptional({ description: 'An internal instructor. Confirmed through Employment.' })
  @IsOptional()
  @IsUUID()
  public readonly employmentId?: string;

  @ApiPropertyOptional({ type: LocalizedTextBody, description: 'An external instructor’s name.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly externalName?: LocalizedTextBody;

  @ApiPropertyOptional({ example: 'Civil Defence Academy' })
  @IsOptional()
  @IsString()
  @Length(1, NAME)
  public readonly externalOrganization?: string;

  @ApiPropertyOptional({ example: 'training@example.org' })
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly externalContact?: string;
}
