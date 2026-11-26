-- ─────────────────────────────────────────────────────────────────────────────
-- NOTAS DE SESIÓN: LÍMITE DE 5.000 A 50.000 CARACTERES
--
-- 5.000 caracteres se quedaban cortos para las notas de una sesión. Se amplía
-- el límite de «Notas de la sesión» y «Notas para la próxima sesión» a 50.000
-- caracteres cada una (unas 20-25 páginas). El formulario de la sesión
-- (client/src/pages/area/Sesion.tsx) usa el mismo límite.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.appointment_notes drop constraint if exists appointment_notes_notes_check;
alter table public.appointment_notes add constraint appointment_notes_notes_check check (length(notes) <= 50000);
alter table public.appointment_notes drop constraint if exists appointment_notes_next_notes_check;
alter table public.appointment_notes add constraint appointment_notes_next_notes_check check (length(next_notes) <= 50000);
