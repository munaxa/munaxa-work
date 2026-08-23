-- ================================================================================================
-- Phase 5.2 — Employee Relations · Checkpoint 3
--
-- Two approved decisions and one capability, and between them **one column, one index and one
-- widened CHECK**. Nothing existing is altered: no table is dropped, no constraint is loosened, and
-- **neither Checkpoint 2 trigger is touched** — `app_relation_case_event_immutable` and
-- `app_relation_investigation_refuse_concluded` are exactly as they were written.
--
--   * **D-5.2-19 — a correction is a new investigation, linked backward.** The concluded row it
--     corrects is never updated, so it needs no new column and its trigger needs no exception. That
--     is the difference from `letter_issued`, which stamps a *forward* pointer on the original and
--     therefore had to narrow its trigger to permit exactly one write. Relations does not need that,
--     because it already derives "which one is operative" from persisted history the way it derives
--     current case state (D-5.2-16) — so the pointer points the other way and nothing is stamped.
--
--   * **D-5.2-18 — findings need a second grant.** Entirely an application-layer rule; no schema
--     expresses it. Recorded here only to say so: there is no `confidentiality` column, no per-row
--     access list, and no policy change. Row-level security remains tenancy and never capability.
--
--   * **Checkpoint 3 — repeat counting is derived and persists nothing.** There is deliberately no
--     `occurrence`, `repeat_count`, `is_repeat`, `breached` or `escalation_level` column anywhere in
--     this migration. The count is arithmetic over `relation_violation.occurred_on` and the tenant's
--     own `relation_violation_category.repeat_window_days`, and a stored copy would be a second
--     thing that can disagree with the violations (ADR-0070). Only the audit action is new.
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- D-5.2-19 · the backward link from a correction to what it corrects.
-- ---------------------------------------------------------------------------------------------

-- Nullable because almost every investigation corrects nothing. Self-referencing, so the chain is
-- readable in either direction without a join table.
alter table relation_investigation
  add column corrects_investigation_id uuid;

alter table relation_investigation
  add constraint relation_investigation_corrects_fk
  foreign key (corrects_investigation_id) references relation_investigation (id);

-- An investigation cannot correct itself. Cheap to state, and the one shape a defect would produce
-- that no other constraint here would catch.
alter table relation_investigation
  add constraint relation_investigation_corrects_self_check
  check (corrects_investigation_id is null or corrects_investigation_id <> id);

-- A correction is a conclusion. It is written already concluded — there is nothing to open, because
-- the inquiry it corrects has already been conducted — so a correcting row that claimed to be `open`
-- would be a draft of a correction, which is not a thing this domain has.
alter table relation_investigation
  add constraint relation_investigation_correction_concluded_check
  check (corrects_investigation_id is null or state = 'concluded');

-- **The concurrency arbiter for corrections**, and the reason two administrators correcting one
-- conclusion at the same moment cannot both succeed. Partial, so the many investigations that
-- correct nothing are unaffected; unique, so a conclusion is corrected at most once and the chain
-- stays linear rather than branching into two rival versions of what was found.
--
-- The same rule as `relation_investigation_open_idx` and for the same reason (ADR-0071): the read
-- that precedes the insert decides nothing under concurrency, so the index decides.
create unique index relation_investigation_corrects_idx
  on relation_investigation (tenant_id, corrects_investigation_id)
  where corrects_investigation_id is not null and deleted_at is null;

-- Reading a correction chain forwards — "was this conclusion ever corrected?" — without scanning.
create index relation_investigation_corrected_idx
  on relation_investigation (tenant_id, corrects_investigation_id)
  where corrects_investigation_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Checkpoint 3 · the audit action for an escalation read.
--
-- Widened by an approved change, exactly as Checkpoint 2 widened it for the investigation actions.
-- Asking how many times somebody has done this before is a disciplinary disclosure (AD-007), so it
-- is audited on the same trail rather than on a second one.
-- ---------------------------------------------------------------------------------------------

alter table relation_violation_access_event
  drop constraint relation_violation_access_event_action_check;

alter table relation_violation_access_event
  add constraint relation_violation_access_event_action_check
  check (action in ('violation_read', 'violation_listed',
                    'investigation_read', 'investigation_listed', 'case_history_read',
                    'escalation_read'));

-- ---------------------------------------------------------------------------------------------
-- Row-level security: nothing to do, and that is the point.
--
-- `relation_investigation` was enabled and forced by `app_protect_table` in Checkpoint 2, and a
-- column added to a protected table is protected with it. No policy is created, altered or dropped
-- here — a correction is visible under exactly the tenancy rule the row it corrects is visible
-- under, because findings visibility is a capability question and RLS answers tenancy questions.
-- ---------------------------------------------------------------------------------------------
