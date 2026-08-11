-- ---------------------------------------------------------------------------------------------
-- A document version is immutable — with exactly one exception, which the original rule forgot.
--
-- `20260811120000_documents_letters` made `document_version` refuse every update and every delete.
-- That is right for the row's content and wrong for one column: `superseded_at` is the stamp that
-- says a version is no longer the current one, and replacing a file writes it. As shipped, adding a
-- second version to a document was impossible — the insert succeeded and the stamp on the previous
-- version raised `document_version_immutable`. Found by the immutability suite, which asserted the
-- permitted stamp alongside the refusals rather than only the refusals.
--
-- The rule is narrowed rather than relaxed. An update is permitted only when `superseded_at` moves
-- from null to a value and **every other column is byte-for-byte identical** apart from the audit
-- columns that record the stamp itself. A second supersession, a change of content alongside the
-- stamp, a clearing of the stamp, and every delete are all still refused — from any path, including
-- SQL nobody wrote in TypeScript (ADR-0066).
-- ---------------------------------------------------------------------------------------------

create or replace function app_document_version_immutable() returns trigger
language plpgsql as $$
declare
  unchanged_old jsonb;
  unchanged_new jsonb;
begin
  if tg_op = 'UPDATE' and old.superseded_at is null and new.superseded_at is not null then
    -- Everything the stamp is allowed to touch, removed before the comparison. What remains must
    -- be identical, so "stamp it and quietly rewrite the hash" is not reachable through this door.
    unchanged_old := to_jsonb(old) - 'superseded_at' - 'updated_at' - 'updated_by' - 'version';
    unchanged_new := to_jsonb(new) - 'superseded_at' - 'updated_at' - 'updated_by' - 'version';

    if unchanged_old = unchanged_new then
      return new;
    end if;
  end if;

  raise exception 'document_version_immutable'
    using errcode = 'restrict_violation',
          detail = format('document_version %s is immutable', old.id),
          hint = 'A replacement inserts a new version. Only superseded_at may be stamped, once.';
end; $$;
