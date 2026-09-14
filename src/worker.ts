import { snapshotSchema } from "./schema";
import { canRead, canWrite, type AccessEnv } from "./auth";
import { adapters } from "./integrations";
export interface Env extends AccessEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  MAX_SNAPSHOT_BYTES?: string;
}
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const sha = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
export async function boundedText(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("EMPTY_BODY");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    const requestId = crypto.randomUUID();
    try {
      if (path === "/api/health" && request.method === "GET")
        return json({ status: "ok", version: "1.0.0" });
      if (path.startsWith("/api/admin/")) {
        if (!(await canWrite(request, env)))
          return json({ error: "unauthorized" }, 401);
        if (path === "/api/admin/snapshots" && request.method === "POST") {
          if (
            !request.headers.get("Content-Type")?.startsWith("application/json")
          )
            return json({ error: "expected_json" }, 415);
          const input = await boundedText(
            request,
            Math.min(Number(env.MAX_SNAPSHOT_BYTES) || 900000, 900000),
          );
          let parsed: unknown;
          try {
            parsed = JSON.parse(input);
          } catch {
            return json({ error: "invalid_json" }, 400);
          }
          const valid = snapshotSchema.safeParse(parsed);
          if (!valid.success)
            return json(
              {
                error: "invalid_snapshot",
                issues: valid.error.issues
                  .map((i) => ({ path: i.path, message: i.message }))
                  .slice(0, 10),
              },
              422,
            );
          const payload = JSON.stringify(valid.data);
          const bytes = new TextEncoder().encode(payload).length;
          if (bytes > 900000) return json({ error: "body_too_large" }, 413);
          const id = await sha(payload);
          const now = new Date().toISOString();
          // D1 batch is transactional: a failed insert never switches the active snapshot.
          await env.DB.batch([
            env.DB.prepare(
              "INSERT OR IGNORE INTO snapshots(id,created_at,source_sha256,payload,byte_size) VALUES(?,?,?,?,?)",
            ).bind(id, now, valid.data.meta.sourceSha256, payload, bytes),
            env.DB.prepare(
              "INSERT INTO active_snapshot(singleton,snapshot_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id",
            ).bind(id),
            env.DB.prepare(
              "DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC,id DESC LIMIT 10) AND id NOT IN (SELECT snapshot_id FROM active_snapshot) AND id NOT IN (SELECT snapshot_id FROM integration_runs WHERE snapshot_id IS NOT NULL)",
            ),
          ]);
          return json({ id, bytes, status: "published" }, 201);
        }
        if (path === "/api/admin/snapshots" && request.method === "GET") {
          const result = await env.DB.prepare(
            "SELECT id,created_at,source_sha256,byte_size FROM snapshots ORDER BY created_at DESC,id DESC LIMIT 10",
          ).all();
          return json({ snapshots: result.results });
        }
        if (path === "/api/admin/activate" && request.method === "POST") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(await boundedText(request, 256));
          } catch {
            return json({ error: "invalid_body" }, 400);
          }
          const id = (parsed as { id?: unknown })?.id;
          if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
            return json({ error: "invalid_id" }, 400);
          const result = await env.DB.prepare(
            "UPDATE active_snapshot SET snapshot_id=? WHERE singleton=1 AND EXISTS(SELECT 1 FROM snapshots WHERE id=?)",
          )
            .bind(id, id)
            .run();
          return result.meta.changes
            ? json({ id, status: "activated" })
            : json({ error: "snapshot_not_found" }, 404);
        }
        return json({ error: "not_found" }, 404);
      }
      if (!["GET", "HEAD"].includes(request.method))
        return json({ error: "method_not_allowed" }, 405, {
          Allow: "GET, HEAD",
        });
      if (!(await canRead(request, env)))
        return json({ error: "sign_in_required" }, 401);
      if (path === "/api/v1/integrations")
        return json({
          integrations: [...adapters.values()].map((a) => ({
            id: a.id,
            description: a.description,
          })),
          liveConnections: 0,
        });
      if (path !== "/api/v1/dashboard")
        return json({ error: "not_found" }, 404);
      // Shared cache is allowed only in public mode. Private responses never enter it.
      const cacheKey = new Request(url.origin + "/api/v1/dashboard");
      if (env.DATA_ACCESS === "public") {
        const cached = await caches.default.match(cacheKey);
        if (cached) return conditional(cached, request);
      }
      const row = await env.DB.prepare(
        "SELECT s.id,s.payload FROM active_snapshot a JOIN snapshots s ON s.id=a.snapshot_id WHERE a.singleton=1",
      ).first<{ id: string; payload: string }>();
      if (!row)
        return json(
          {
            error: "no_snapshot",
            message: "No validated dataset has been published yet.",
          },
          503,
          { "Retry-After": "60" },
        );
      const response = new Response(row.payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control":
            env.DATA_ACCESS === "public"
              ? "public, max-age=60"
              : "private, no-store",
          ETag: '"' + row.id + '"',
          "X-Content-Type-Options": "nosniff",
        },
      });
      if (env.DATA_ACCESS === "public")
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return conditional(response, request);
    } catch (error) {
      if (error instanceof Error && error.message === "BODY_TOO_LARGE")
        return json({ error: "body_too_large" }, 413);
      console.error(JSON.stringify({ requestId, event: "api_failure", path }));
      return json({ error: "service_unavailable", requestId }, 503, {
        "Retry-After": "30",
      });
    }
  },
} satisfies ExportedHandler<Env>;
function conditional(response: Response, request: Request) {
  if (request.headers.get("If-None-Match") === response.headers.get("ETag"))
    return new Response(null, { status: 304, headers: response.headers });
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}
