-- ─────────────────────────────────────────────────────────────────────────────
-- TARIFA ESPECIAL POR PACIENTE
--
-- Algunos pacientes tienen acordado un precio distinto para la sesión suelta
-- (p. ej. 50 € en vez de 55 €). profiles.special_price_cents guarda ese precio
-- (null = tarifa normal) y sustituye al de la sesión individual o de pareja
-- al crear sus citas. No afecta a la primera sesión ni a las de bono, ni a las
-- citas ya creadas (cada cita guarda su precio).
-- Solo la admin puede cambiarlo (política «profiles: admin actualiza»).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists special_price_cents integer check (special_price_cents > 0);

-- La reserva del paciente aplica también su tarifa especial.
create or replace function public.book_slot(p_patient_id uuid, p_slot_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_patient public.profiles%rowtype;
  v_psych public.profiles%rowtype;
  v_cfg public.booking_settings%rowtype;
  v_slot public.agenda_slots%rowtype;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_type text;
  v_price integer;
  v_bono uuid;
  v_appt uuid;
  v_minutes integer;
begin
  -- Bloquea al paciente: dos reservas suyas a la vez no se saltan la regla
  -- de una cita por semana.
  select * into v_patient from public.profiles
   where id = p_patient_id and role = 'patient' for update;
  if not found or not v_patient.active or v_patient.psychologist_id is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(v_comment) > 300 then
    raise exception 'COMMENT_TOO_LONG';
  end if;
  select * into v_cfg from public.booking_settings where id = 1;

  -- Toma atómica del hueco: si otro paciente lo ha cogido a la vez, esta
  -- actualización espera a que termine y ya no encuentra el hueco abierto.
  update public.agenda_slots
     set status = 'reservado', booked_by_patient_id = p_patient_id, booked_at = now()
   where id = p_slot_id
     and status = 'abierto'
     and psychologist_id = v_patient.psychologist_id
     and starts_at >= now() + make_interval(hours => v_cfg.min_advance_hours)
     and starts_at <= now() + make_interval(days => v_cfg.max_window_days)
  returning * into v_slot;
  if not found then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if exists (select 1 from public.appointments
              where patient_id = p_patient_id and status <> 'cancelada'
                and public.madrid_week_start(starts_at) = public.madrid_week_start(v_slot.starts_at)) then
    raise exception 'WEEK_LIMIT';
  end if;

  if public.agenda_busy(v_slot.psychologist_id, v_slot.starts_at, v_slot.ends_at) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Tarifa, igual que una cita manual.
  if not exists (select 1 from public.appointments where patient_id = p_patient_id and status <> 'cancelada') then
    v_type := 'primera'; v_price := 2500;
  else
    select b.id into v_bono from public.bonos b
     where b.patient_id = p_patient_id
       and b.sessions_total > (select count(*) from public.appointments a
                                where a.bono_id = b.id and a.status <> 'cancelada')
     order by b.created_at limit 1;
    if v_bono is not null then
      v_type := 'bono'; v_price := 0;
    elsif v_patient.process_type = 'pareja' then
      v_type := 'pareja'; v_price := coalesce(v_patient.special_price_cents, 7000);
    else
      v_type := 'individual'; v_price := coalesce(v_patient.special_price_cents, 5500);
    end if;
  end if;

  v_minutes := (extract(epoch from v_slot.ends_at - v_slot.starts_at) / 60)::integer;
  insert into public.appointments (
    patient_id, starts_at, duration_minutes, modality, status,
    session_type, price_cents, bono_id, origin
  ) values (
    p_patient_id, v_slot.starts_at, v_minutes, 'online', 'programada',
    v_type, v_price, v_bono, 'reserva_paciente'
  ) returning id into v_appt;

  update public.agenda_slots set appointment_id = v_appt where id = v_slot.id;

  -- El comentario queda también en las notas de la cita (solo las ve ella).
  if v_comment is not null then
    insert into public.appointment_notes (appointment_id, notes)
    values (v_appt, 'Comentario del paciente al reservar: ' || v_comment);
  end if;

  select * into v_psych from public.profiles where id = v_slot.psychologist_id;
  return jsonb_build_object(
    'appointment_id', v_appt,
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at,
    'ends_at', v_slot.ends_at,
    'duration_minutes', v_minutes,
    'session_type', v_type,
    'comment', v_comment,
    'patient_name', v_patient.full_name,
    'patient_email', v_patient.email,
    'psychologist_name', v_psych.full_name,
    'psychologist_email', v_psych.email,
    'psychologist_phone', v_psych.phone,
    'cancel_limit_hours', v_cfg.cancel_limit_hours
  );
end;
$fn$;
revoke all on function public.book_slot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid, text) to service_role;
