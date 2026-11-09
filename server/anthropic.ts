// Llamada a la API de Anthropic (Messages) con fetch.
//
// No se usa el SDK oficial (@anthropic-ai/sdk) porque importa @opentelemetry/api,
// que el runtime Edge de Vercel no admite: el despliegue fallaba con «The Edge
// Function … is referencing unsupported modules». La petición es la misma que
// generaba el SDK (comprobada al capturarla): mismo endpoint, versión y cabeceras.
// Ver docs/highlights-ia.md.

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";

export interface AnthropicMessage {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: Array<{ type: string; text?: string }>;
}

export type AnthropicResult =
  | { ok: true; message: AnthropicMessage }
  | { ok: false; status: number | "network"; errorType?: string };

export async function createMessage(
  apiKey: string,
  body: Record<string, unknown>,
  opts: { betas?: string[]; timeoutMs?: number } = {}
): Promise<AnthropicResult> {
  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        ...(opts.betas?.length ? { "anthropic-beta": opts.betas.join(",") } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch {
    return { ok: false, status: "network" };
  }
  const data = (await resp.json().catch(() => null)) as
    | (AnthropicMessage & { type?: string; error?: { type?: string } })
    | null;
  if (!resp.ok || !data || data.type === "error") {
    return { ok: false, status: resp.status, errorType: data?.error?.type };
  }
  return { ok: true, message: data };
}
