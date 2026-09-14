import type { Snapshot } from "./schema";
export interface IntegrationContext {
  secrets: Readonly<Record<string, string>>;
  fetchJson: (
    url: string,
    allowedOrigins: ReadonlySet<string>,
    headers?: Record<string, string>,
  ) => Promise<unknown>;
}
export interface IntegrationAdapter {
  id: string;
  description: string;
  buildSnapshot: (context: IntegrationContext) => Promise<Snapshot>;
}
// Add explicitly reviewed adapters here. No live provider or schedule is enabled.
export const adapters: ReadonlyMap<string, IntegrationAdapter> = new Map();
export async function fetchProviderJson(
  url: string,
  allowedOrigins: ReadonlySet<string>,
  headers: Record<string, string> = {},
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !allowedOrigins.has(parsed.origin)
  )
    throw Error("PROVIDER_ORIGIN_NOT_ALLOWED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(parsed.toString(), {
      headers: { Accept: "application/json", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw Error("PROVIDER_HTTP_ERROR");
    if (!response.headers.get("Content-Type")?.includes("application/json"))
      throw Error("PROVIDER_CONTENT_TYPE");
    const reader = response.body?.getReader();
    if (!reader) throw Error("PROVIDER_EMPTY");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 900000) {
        await reader.cancel();
        throw Error("PROVIDER_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of chunks) {
      bytes.set(part, at);
      at += part.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    clearTimeout(timer);
  }
}
