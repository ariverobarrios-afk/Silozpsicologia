# Siloz Psicología — Migración a Vercel

Sitio estático (React + Vite) con una pequeña función serverless para el
formulario de contacto. Se despliega en Vercel sin necesidad de base de datos.

## ✅ Lo que ya está hecho
- Frontend completo (Home, Ansiedad, Depresión, Blog, Recursos, Aviso Legal, Gracias).
- Los 4 artículos del blog y el recurso (PDF "La ventana de tolerancia") recuperados
  e incrustados en `client/src/data/content.ts`.
- SEO intacto: Google Tag Manager, verificación de Search Console, Open Graph,
  Schema.org, sitemap.xml y robots.txt.
- Formulario de contacto conectado a una función serverless (`api/contact.ts`)
  que envía el lead por email (**Resend**) y, opcionalmente, lo registra en
  **Google Sheets**. Incluye honeypot anti-spam.

## ⚠️ ANTES DE PUBLICAR — configurar el formulario
El formulario necesita una clave de **Resend** (gratis) configurada como
variable de entorno en Vercel. El paso a paso completo (Resend + Google Sheets)
está en **`FORMULARIO-SETUP.md`**.

(Hasta que añadas `RESEND_API_KEY` en Vercel, el formulario dará error al enviar.)

## 🚀 Desplegar en Vercel
### Opción A — con GitHub (recomendada)
1. Sube esta carpeta a un repositorio nuevo en GitHub.
2. En https://vercel.com → "Add New Project" → importa el repo.
3. Vercel detecta Vite automáticamente. Si pregunta:
   - Framework Preset: **Vite**
   - Build Command: `vite build`
   - Output Directory: `dist`
4. Deploy. En 1-2 minutos tendrás una URL `*.vercel.app` para revisar.

### Opción B — sin GitHub (CLI)
```
npm i -g vercel
vercel        # primer deploy (preview)
vercel --prod # publicar
```

## 🌐 Conectar tu dominio (silozpsicologia.com)
1. En el proyecto de Vercel → Settings → Domains → añade `silozpsicologia.com`
   y `www.silozpsicologia.com`.
2. Vercel te dirá qué registros DNS poner (un registro A y/o un CNAME).
3. Cámbialos donde tengas contratado el dominio.
   👉 Deja el sitio antiguo en pie hasta que Vercel muestre el dominio como
   "Valid Configuration". Así no hay ni un minuto de caída.

## 🔎 Después de publicar
- En Google Search Console, vuelve a enviar el sitemap:
  `https://silozpsicologia.com/sitemap.xml`
- La verificación de Search Console ya va incluida en el HTML, así que no se pierde.

## 🛠️ Para trabajar en local
```
npm install
npm run dev      # arranca en http://localhost:5173
npm run build    # genera /dist
```

## ✍️ Añadir o editar artículos del blog
Edita `client/src/data/content.ts` (array `blogPosts`). Cada artículo tiene
slug, título, categoría, extracto y contenido en Markdown. Tras editar, vuelve
a desplegar (o si usas GitHub, basta con hacer push).
