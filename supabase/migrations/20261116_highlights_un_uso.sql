-- ─────────────────────────────────────────────────────────────────────────────
-- HIGHLIGHTS CON IA: UNA GENERACIÓN POR SESIÓN (docs/highlights-ia.md)
--
-- session_highlight_generations registra qué sesiones (citas) ya han usado la
-- generación con IA. La clave primaria hace que solo pueda haber una: el
-- servidor (api/session-highlights.ts, con service_role) inserta la fila ANTES
-- de llamar a la API de Anthropic y, si ya existía, rechaza la petición. Si la
-- llamada falla (error de la API, respuesta no válida, no se pudo guardar),
-- borra la fila para que se pueda reintentar.
-- Es una tabla aparte de session_highlights para que «Borrar» los highlights
-- no vuelva a habilitar la generación.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.session_highlight_generations (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  generated_at   timestamptz not null default now()
);
alter table public.session_highlight_generations enable row level security;

drop policy if exists "session_highlight_generations: admin lee" on public.session_highlight_generations;
create policy "session_highlight_generations: admin lee"
  on public.session_highlight_generations for select to authenticated using (public.is_admin());
-- (Sin políticas de escritura: solo el servidor, con service_role.)

-- Las sesiones que ya tienen highlights generados cuentan como usadas.
insert into public.session_highlight_generations (appointment_id, generated_at)
select appointment_id, generated_at from public.session_highlights
on conflict (appointment_id) do nothing;
