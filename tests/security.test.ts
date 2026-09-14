import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { boundedText, type Env } from "../src/worker";
import { canRead, canWrite } from "../src/auth";
import { fetchProviderJson, adapters } from "../src/integrations";
import { snapshotSchema } from "../src/schema";
const request = (path: string, init?: RequestInit) =>
  new Request("https://example.test" + path, init);
const env = {
  DATA_ACCESS: "public",
  INGEST_TOKEN: "a".repeat(48),
  DB: {
    prepare() {
      throw Error("Database must not be touched");
    },
  },
} as unknown as Env;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
test("read access fails closed unless public or valid Access configuration", async () => {
  assert.equal(await canRead(request("/"), {}), false);
  assert.equal(await canRead(request("/"), { DATA_ACCESS: "public" }), true);
  assert.equal(
    await canRead(
      request("/", { headers: { "Cf-Access-Jwt-Assertion": "forged" } }),
      { DATA_ACCESS: "access" },
    ),
    false,
  );
});
test("ingestion fails closed for missing, weak and incorrect credentials", async () => {
  assert.equal(await canWrite(request("/"), {}), false);
  assert.equal(
    await canWrite(
      request("/", { headers: { Authorization: "Bearer short" } }),
      { INGEST_TOKEN: "short" },
    ),
    false,
  );
  assert.equal(
    await canWrite(
      request("/", { headers: { Authorization: "Bearer " + "b".repeat(48) } }),
      env,
    ),
    false,
  );
  assert.equal(
    await canWrite(
      request("/", { headers: { Authorization: "Bearer " + "a".repeat(48) } }),
      env,
    ),
    true,
  );
});
test("public users cannot write or invoke admin operations", async () => {
  const a = await worker.fetch(
    request("/api/admin/snapshots", { method: "POST", body: "{}" }),
    env,
    ctx,
  );
  assert.equal(a.status, 401);
  const b = await worker.fetch(
    request("/api/v1/dashboard", { method: "DELETE" }),
    env,
    ctx,
  );
  assert.equal(b.status, 405);
});
test("authenticated invalid imports never touch the database", async () => {
  const r = await worker.fetch(
    request("/api/admin/snapshots", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + "a".repeat(48),
        "Content-Type": "application/json",
      },
      body: '{"schemaVersion":900}',
    }),
    env,
    ctx,
  );
  assert.equal(r.status, 422);
});
test("oversized streaming bodies are rejected without Content-Length", async () => {
  await assert.rejects(
    () =>
      boundedText(request("/", { method: "POST", body: "x".repeat(100) }), 50),
    /BODY_TOO_LARGE/,
  );
});
test("provider adapter rejects unregistered origins and unsafe protocols", async () => {
  let called = false;
  const fetcher = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;
  await assert.rejects(() =>
    fetchProviderJson("http://127.0.0.1", new Set(), {}, fetcher),
  );
  await assert.rejects(() =>
    fetchProviderJson(
      "https://evil.test",
      new Set(["https://api.example.test"]),
      {},
      fetcher,
    ),
  );
  assert.equal(called, false);
  assert.equal(adapters.size, 0);
});
test("provider adapter disables redirects and bounds responses", async () => {
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    assert.equal(init.redirect, "error");
    return new Response("x".repeat(900001), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  await assert.rejects(
    () =>
      fetchProviderJson(
        "https://api.example.test/snapshot",
        new Set(["https://api.example.test"]),
        {},
        fetcher,
      ),
    /PROVIDER_TOO_LARGE/,
  );
});
test("snapshot schema rejects unknown fields, NaN and inconsistent totals", () => {
  assert.equal(
    snapshotSchema.safeParse({ schemaVersion: 1, privateKey: "secret" })
      .success,
    false,
  );
  assert.equal(
    snapshotSchema.safeParse({ overview: { totalCustomers: NaN } }).success,
    false,
  );
});
