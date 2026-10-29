-- ================================================================================================
-- Licensing state: the revocation list in force (ADR-0079, platform ADR-0022).
--
--   * An on-premises installation receives a signed revocation list (`mxr1`) next to its licence.
--     The newest one it verified is kept here, so deleting the file, or offering an older list,
--     does not undo a revocation — across restarts too.
--   * `revocation_sequence` only grows: the writer updates only when the new sequence is higher.
--   * Both are set together or not at all. Additive: no existing row changes.
-- ================================================================================================

alter table licensing_state
  add column revocation_list text,
  add column revocation_sequence integer,
  add constraint licensing_state_revocation_pair_check check (
    (revocation_list is null) = (revocation_sequence is null)
  ),
  add constraint licensing_state_revocation_sequence_check check (
    revocation_sequence is null or revocation_sequence >= 1
  );
