# Área privada (pacientes y terapeuta) — puesta en marcha

Qué hay construido:

| Página | Quién | Qué hace |
|---|---|---|
| `/acceso` | Todos | Inicio de sesión y «he olvidado mi contraseña». |
| `/acceso/nueva-contrasena` | Todos | Donde lleva el email de invitación / recuperación para elegir contraseña. |
| `/panel` | Silvia | Agenda (crear, editar, borrar citas, marcar realizadas) y pacientes (invitar, desactivar). |
| `/mi-area` | Paciente | Sus próximas citas y su historial. Solo lectura. |

Los datos viven en **Supabase** (base de datos + inicio de sesión). Los permisos
están en la propia base de datos (`supabase/schema.sql`): un paciente solo puede
leer sus citas, aunque manipule la web.

Mientras no se configure, la web pública funciona igual y `/acceso` muestra
«El área privada todavía no está configurada».

---

## 1. Crear el proyecto en Supabase (5 min)

1. Entra en https://supabase.com → **Start your project** (puedes entrar con GitHub).
2. **New project**:
   - Name: `siloz-psicologia`
   - Database password: genera una y guárdala.
   - **Region: Central EU (Frankfurt)** ← importante: datos de salud dentro de la UE.
3. Espera a que termine de crearse (~2 min).

## 2. Crear las tablas y permisos

1. En Supabase → **SQL Editor** → **New query**.
2. Pega el contenido completo de `supabase/schema.sql` → **Run**.
   (Se puede volver a ejecutar sin problema si algún día cambia.)

## 3. Ajustes de inicio de sesión

En Supabase → **Authentication**:

1. **Sign In / Providers → Email**: desactiva **«Allow new users to sign up»**.
   Así solo entran quienes Silvia invita.
2. **URL Configuration**:
   - **Site URL**: `https://silozpsicologia.com`
   - **Redirect URLs** (añade las tres):
     ```
     https://silozpsicologia.com/**
     https://www.silozpsicologia.com/**
     https://*-albertos-projects-a91b7f60.vercel.app/**
     ```
     La última permite que las invitaciones funcionen en las versiones de prueba.

## 4. Envío de emails (invitaciones y recuperar contraseña)

El servidor de correo que trae Supabase de serie **solo envía a los emails de
tu equipo de Supabase** y con un límite muy bajo: sirve para probar contigo
mismo, no con pacientes. Para uso real, usa Resend (ya lo tienes para el
formulario):

1. En Resend, verifica el dominio `silozpsicologia.com` (Domains → Add domain).
2. Supabase → **Authentication → Emails → SMTP Settings** → Enable custom SMTP:
   - Sender email: `citas@silozpsicologia.com` · Sender name: `Siloz Psicología`
   - Host: `smtp.resend.com` · Port: `465`
   - Username: `resend` · Password: tu clave de API de Resend
3. **Authentication → Emails → Templates**: traduce al menos estas dos:
   - **Invite user** — Asunto: `Tu acceso al área privada de Siloz Psicología`
     ```html
     <p>Hola,</p>
     <p>Silvia te ha dado acceso al área privada de Siloz Psicología, donde podrás consultar tus citas.</p>
     <p><a href="{{ .ConfirmationURL }}">Crear mi contraseña</a></p>
     ```
   - **Reset password** — Asunto: `Crear una nueva contraseña`
     ```html
     <p>Hola,</p>
     <p>Pulsa el enlace para elegir una nueva contraseña:</p>
     <p><a href="{{ .ConfirmationURL }}">Crear nueva contraseña</a></p>
     <p>Si no lo has pedido tú, ignora este email.</p>
     ```

## 5. Conectar Vercel con Supabase

La URL y la clave pública del proyecto (`lzypigesiibwmpzdkaht`) ya están en el
código (`shared/supabasePublic.ts`); no son secretas. Solo falta **una**
variable, la clave secreta, que usa el servidor para enviar invitaciones.

1. Supabase → **Project Settings → API Keys** → copia la clave **secret**
   (`sb_secret_…`) o, en «Legacy API keys», la **service_role**.
2. Vercel → proyecto `silozpsicologia` → **Settings → Environment Variables**:
   - Key: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: la clave copiada
   - Marca **Sensitive** y, para probar sin tocar producción, solo **Preview**.
     Cuando se publique, añádela también en **Production**.
3. Vuelve a desplegar la versión de prueba (Deployments → el último de la rama
   → **Redeploy**).

## 6. Dar acceso de administradora a Silvia

1. Supabase → **Authentication → Users → Add user → Send invitation** con el email de Silvia.
2. Supabase → **SQL Editor**, ejecuta (con su email real):
   ```sql
   update public.profiles
      set role = 'admin', full_name = 'Silvia'
    where email = 'EMAIL_DE_SILVIA@ejemplo.com';
   ```
3. Silvia abre el email, elige contraseña y entra en `/panel`.

A partir de ahí, los pacientes los invita ella desde **Panel → Pacientes → Invitar paciente**.

---

## Protección de datos (a revisar antes de publicar)

Las citas de un psicólogo son datos de salud (RGPD, art. 9). Lo técnico está
cubierto (datos en la UE, cifrado, cada paciente solo ve lo suyo, no se guardan
notas clínicas), pero conviene:

- Mencionar el área privada y a Supabase como encargado del tratamiento en la
  política de privacidad / aviso legal.
- Aceptar el DPA de Supabase (https://supabase.com/legal/dpa).
- Informar a cada paciente al invitarlo (consentimiento).
