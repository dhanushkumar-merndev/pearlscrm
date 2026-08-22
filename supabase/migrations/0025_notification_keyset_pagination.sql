-- Notification history is a potentially unbounded, per-recipient feed. This
-- index supports the keyset predicate and deterministic order used by the UI:
-- (created_at, id) DESC. The UUID breaks timestamp ties without an OFFSET scan.
create index if not exists notifications_recipient_created_at_id_idx
  on public.notifications (recipient_id, created_at desc, id desc);
