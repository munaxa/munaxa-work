-- Two partial unique indexes that make a repeated Learning command converge instead of duplicating.
--
-- Phase 14A's application layer answers a retried request with the record that already exists rather
-- than a second one, and the decision has to be the **database's**. A handler that read first and
-- inserted second would be idempotent single-threaded and wrong the moment two administrators press
-- the same button, so the stores issue `insert ... on conflict do nothing` and these are the
-- conflicts they rely on (ADR-0071).
--
-- The occurrence index the same ADR describes is already in the creating migration. These two cover
-- the paths that are not rule-driven.

-- One open assignment per person per course.
--
-- A queue with "fire safety" on it twice is not two obligations, it is one obligation somebody
-- clicked twice — and a person cannot satisfy the second copy separately. Only `assigned` is
-- covered, so a course somebody was asked to do again next year is a new row once the first is
-- satisfied, waived or cancelled.
--
-- It also bounds the recurring case sensibly: a rule whose next occurrence opens while the previous
-- one is still outstanding does not stack a second demand on the same person. Reconciliation reports
-- it as already present, which is the truth.
create unique index learning_assignment_open_idx
  on learning_assignment (tenant_id, employment_id, course_id)
  where deleted_at is null and status = 'assigned';

-- One certification per enrolment.
--
-- A completed course produces a certificate, and issuing it twice would put two of the same
-- qualification on one person's record with two different identifiers — and an expiring-certificates
-- report would then count them twice.
--
-- Only enrolment-backed certifications are covered. An externally obtained one has no natural key:
-- somebody may genuinely hold two forklift licences from two issuers, and a uniqueness rule invented
-- for them would refuse a real record (D-2).
create unique index learning_certification_enrolment_idx
  on learning_certification (tenant_id, enrolment_id)
  where deleted_at is null and enrolment_id is not null;
