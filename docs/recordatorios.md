# Recordatorios por email (cita y pago)

Emails automáticos al paciente, enviados con Resend desde
`Siloz Psicología <no-reply@silozpsicologia.com>` (o `EMAIL_FROM`). No llevan
datos personales de la psicóloga: ni nombre, ni teléfono, ni email de respuesta.

## Recordatorio de cita (24 horas antes)

- Para cada cita **programada**, cuando faltan 24 horas (con un margen de
  hasta 15 minutos, que es cada cuánto se revisa).
- Indica el día, la hora (de Madrid) y la modalidad. Si el paciente tiene
  acceso al área privada, añade el enlace «Ver mis citas».
- Si la cita se cambia de hora, se vuelve a avisar de la nueva; si se cancela,
  no se envía nada.
- Las citas que se crean con menos de 12 horas de margen no reciben
  recordatorio (se acaban de acordar). Las creadas con entre 12 y 24 horas lo
  reciben en la siguiente revisión.

## Recordatorio de pago (domingos)

- Cada **domingo a partir de las 10:00** (hora de Madrid) se repasa quién tiene
  algo pendiente y se le envía un email con el detalle y el total.
- Cuenta como pendiente lo mismo que el aviso «Pendiente» del panel: sesiones
  **anteriores al momento del envío**, no canceladas, con importe y sin cobro
  registrado, y bonos vendidos sin pagar.
- Un email por paciente y domingo como mucho. En cuanto se registra el cobro
  en el panel, deja de recibirlo.

## A quién se envía

Solo a pacientes **activos** que tienen email en su ficha (tengan o no acceso
al área privada). Los desactivados no reciben nada.

## Cómo funciona

1. En Supabase, `pg_cron` ejecuta `public.run_reminders()` cada 15 minutos
   (tarea `siloz-recordatorios`).
2. Esa función crea un token de un solo uso en `reminder_tokens` y llama con
   `pg_net` a `https://silozpsicologia.com/api/reminders`.
3. `api/reminders.ts` comprueba y borra el token y ejecuta
   `server/reminders.ts`, que apunta cada envío en `appointment_reminders` /
   `payment_reminders` (para no repetirlo) y manda el email.

No hace falta ninguna variable de entorno nueva (usa `RESEND_API_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`). Base de datos:
`supabase/migrations/20261123_recordatorios.sql` (también al final de
`supabase/schema.sql`).

## Pausar, reanudar y revisar (Supabase → SQL Editor)

```sql
-- Pausar todos los recordatorios
select cron.unschedule('siloz-recordatorios');
-- Reanudar
select cron.schedule('siloz-recordatorios', '*/15 * * * *', 'select public.run_reminders()');
-- Qué se ha enviado
select * from public.appointment_reminders order by sent_at desc;
select * from public.payment_reminders order by sent_at desc;
-- Respuestas de las últimas llamadas (200 = correcto)
select status_code, content, created from net._http_response order by created desc limit 10;
```

Los envíos también se ven en Resend → Emails y en los logs de Vercel
(`Recordatorios: …`).
