-- ---------------------------------------------------------------------------------------------
-- An issued letter's supersession pointer is written once.
--
-- `20260811120000_documents_letters` froze the columns that say what a letter *said* — the
-- substituted values, the source versions, the reference, the template version, the issue moment,
-- the issuer and the locale — and left `superseded_by_id` and `superseded_at` unguarded so a
-- correction could stamp them. That is one step too permissive: unguarded means *repointable*, and
-- a supersession pointer that can be moved afterwards lets somebody rewrite which letter replaced
-- which, long after a bank acted on one of them. Found by the immutability suite, which tried the
-- second stamp rather than assuming the first was final.
--
-- The rule is narrowed rather than relaxed. The stamp is permitted exactly once, from null to a
-- value; changing it afterwards, clearing it, and every content change and delete are refused —
-- from any path, including SQL nobody wrote in TypeScript (ADR-0066).
-- ---------------------------------------------------------------------------------------------

create or replace function app_letter_issued_refuse_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'letter_issued_immutable'
      using errcode = 'restrict_violation',
            detail = format('letter_issued %s is immutable', old.id),
            hint = 'A correction issues a new letter and supersedes this one.';
  end if;

  if row(new.*) is distinct from row(old.*)
     and (new.substituted_values is distinct from old.substituted_values
          or new.source_versions is distinct from old.source_versions
          or new.reference_number is distinct from old.reference_number
          or new.letter_template_version_id is distinct from old.letter_template_version_id
          or new.issued_at is distinct from old.issued_at
          or new.issued_by is distinct from old.issued_by
          or new.locale is distinct from old.locale) then
    raise exception 'letter_issued_immutable'
      using errcode = 'restrict_violation',
            detail = format('letter_issued %s is frozen at issue', old.id),
            hint = 'A correction issues a new letter and supersedes this one.';
  end if;

  -- Write-once, in both directions: a superseded letter cannot be repointed at a different
  -- replacement, and cannot be un-superseded.
  if old.superseded_by_id is not null
     and new.superseded_by_id is distinct from old.superseded_by_id then
    raise exception 'letter_issued_already_superseded'
      using errcode = 'restrict_violation',
            detail = format('letter_issued %s was already superseded', old.id),
            hint = 'The chain of corrections is history. It is appended to, never rewritten.';
  end if;

  return new;
end; $$;
