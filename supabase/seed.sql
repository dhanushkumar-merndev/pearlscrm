-- AURA Clinical Data Library — reference/seed data.
--
-- This file contains only reference data the application requires to function.
-- It contains no fake cases, patients, or metrics. Idempotent: safe to re-run.

-- Roles -----------------------------------------------------------------------
insert into public.roles (code, name) values
  ('ADMIN',   'Administrator'),
  ('SURGEON', 'Surgeon'),
  ('STAFF',   'Clinical Staff'),
  ('VIEWER',  'Viewer')
on conflict (code) do update set name = excluded.name;

-- Standard clinical image views -----------------------------------------------
insert into public.image_view_types (code, display_name, sort_order, is_standard) values
  ('FRONT',         'Front',         1, true),
  ('RIGHT_45',      'Right 45°',     2, true),
  ('LEFT_45',       'Left 45°',      3, true),
  ('RIGHT_PROFILE', 'Right Profile', 4, true),
  ('LEFT_PROFILE',  'Left Profile',  5, true),
  ('BASE',          'Base',          6, true)
on conflict (code) do update
  set display_name = excluded.display_name,
      sort_order = excluded.sort_order,
      is_standard = excluded.is_standard;

-- Procedure types --------------------------------------------------------------
insert into public.procedure_types (normalized_key, display_name, sort_order) values
  ('primary',  'Primary',  1),
  ('revision', 'Revision', 2)
on conflict (normalized_key) do nothing;

-- Follow-up label presets --------------------------------------------------------
insert into public.followup_label_presets
  (normalized_key, display_name, sort_order, months_after_surgery) values
  ('1 month',   '1 Month',   1, 1),
  ('3 months',  '3 Months',  2, 3),
  ('6 months',  '6 Months',  3, 6),
  ('12 months', '12 Months', 4, 12)
on conflict (normalized_key) do nothing;
