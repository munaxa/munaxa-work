-- The excluded lines behind a component score (Phase 13, found by the repository work).
--
-- `performance_review_component_score` records that a component was scored, what it weighed and
-- what it was divided by — but had nowhere to put **which** goals and competencies left the
-- denominator, and why. The application layer carries them (`ComponentOutcome.excludedItems`) and
-- the in-memory store kept them, so the gap only appeared when the PostgreSQL repository had to
-- write the same shape.
--
-- Rebuilding them on read from the assessment items was considered and rejected. The working exists
-- so that a rating can be explained years later; deriving it from rows that may since have been
-- soft-deleted or re-scored would make the explanation depend on exactly the mutable state the
-- persisted working is there to escape. It is stored.
--
-- The default makes this additive for the rows already written by the earlier migration in this
-- same phase: an existing component score simply records no exclusions, which is what those rows
-- meant.
alter table performance_review_component_score
  add column excluded_items jsonb not null default '[]';

comment on column performance_review_component_score.excluded_items is
  'The goals or competencies that left this component''s denominator, each with its reason. Written by the scoring engine; never derived on read.';
