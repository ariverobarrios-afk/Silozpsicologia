// Firma del consentimiento: piezas del servidor (api/consent.ts y
// api/consent-file.ts). Todo lo que se puede probar sin red vive aquí.
import { env } from "./email";

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Primera IP de x-forwarded-for (la del cliente en Vercel), si parece válida.
export function clientIp(req: Request): string | null {
  const raw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) || /^[0-9a-f:]{2,39}$/i.test(raw)) return raw;
  return null;
}

// ─── Firma: PNG válido y no vacío ───────────────────────────────────────────
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_SIGNATURE_BYTES = 400_000;

export function decodeSignatureDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > MAX_SIGNATURE_BYTES * 1.4) return null;
  try {
    const bytes = base64ToBytes(m[1]);
    return PNG_MAGIC.every((b, i) => bytes[i] === b) ? bytes : null;
  } catch {
    return null;
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ¿Tiene trazo? Lee el PNG del canvas (RGBA de 8 bits, fondo transparente) y
// busca algún píxel no transparente. Los filtros de PNG son reversibles: una
// imagen totalmente vacía da todos los bytes de datos a cero.
export async function signatureHasInk(png: Uint8Array): Promise<boolean> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let width = 0;
  let bpp = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      const depth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0) return false;
      bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
      if (!bpp) return false;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !bpp || idat.length === 0) return false;
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  let raw: Uint8Array;
  try {
    raw = await inflate(joined);
  } catch {
    return false;
  }
  const rowLen = 1 + width * bpp;
  // Con canal alfa basta mirar si algún píxel tiene opacidad; sin alfa, si hay
  // algún byte distinto del de la primera fila (fondo uniforme).
  for (let i = 0; i < raw.length; i++) {
    if (i % rowLen === 0) continue; // byte de filtro
    if (raw[i] !== 0) return true;
  }
  return false;
}

// ─── Cuerpo de la petición ──────────────────────────────────────────────────
export interface ConsentRequestBody {
  name: string;
  surname: string;
  idNumber: string;
  phone: string;
  birthdate: string;
  accepted: { privacy: boolean; rules: boolean; withdrawal: boolean };
  versionIds: { privacy: string; rules: string; withdrawal: string };
  signature: string; // data:image/png;base64,…
  turnstileToken?: string;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseBody(raw: unknown): ConsentRequestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const acc = (b.accepted ?? {}) as Record<string, unknown>;
  const ver = (b.versionIds ?? {}) as Record<string, unknown>;
  return {
    name: str(b.name).trim(),
    surname: str(b.surname).trim(),
    idNumber: str(b.idNumber, 20).trim(),
    phone: str(b.phone, 30).trim(),
    birthdate: str(b.birthdate, 10).trim(),
    accepted: { privacy: acc.privacy === true, rules: acc.rules === true, withdrawal: acc.withdrawal === true },
    versionIds: { privacy: str(ver.privacy, 40), rules: str(ver.rules, 40), withdrawal: str(ver.withdrawal, 40) },
    signature: typeof b.signature === "string" ? b.signature : "",
    turnstileToken: str(b.turnstileToken, 4000) || undefined,
  };
}

// Cloudflare Turnstile: solo si están configuradas las claves
// (TURNSTILE_SECRET_KEY en el servidor y VITE_TURNSTILE_SITE_KEY en la web).
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = env("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (!token) return false;
  try {
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await resp.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const RATE_LIMIT_PER_HOUR = 5;

export const CONSENT_FROM = () =>
  env("RESEND_FROM") || env("CONSENT_EMAIL_FROM") || "Siloz Psicología <consentimientos@silozpsicologia.com>";
