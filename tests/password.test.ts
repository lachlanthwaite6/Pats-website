import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/worker";
import { canRead } from "../src/auth";

const password = "test-only-shared-password-0123456789";
const basic = (secret = password, username = "dashboard") =>
  "Basic " + Buffer.from(username + ":" + secret).toString("base64");
const request = (path: string, init?: RequestInit) =>
  new Request("https://example.test" + path, init);
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const env = {
  DATA_ACCESS: "password",
  DASHBOARD_PASSWORD: password,
  INGEST_TOKEN: "a".repeat(48),
  ASSETS: {
    fetch() {
      throw Error("Assets must not be reached");
    },
  },
  DB: {
    prepare() {
      throw Error("Database must not be reached");
    },
  },
} as unknown as Env;

test("all dashboard paths, assets and methods deny anonymous requests before storage", async () => {
  for (const path of [
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/charts.js",
    "/api/health",
    "/api/v1/dashboard",
    "/api/v1/dashboard?anything=1",
    "/api/v1/integrations",
    "/api%2Fv1%2Fdashboard",
    "/private/snapshot.json",
    "/missing",
  ]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const result = await worker.fetch(
        request(path, { method, headers: { "If-None-Match": "*" } }),
        env,
        ctx,
      );
      assert.equal(result.status, 401, method + " " + path);
      assert.match(result.headers.get("WWW-Authenticate")!, /^Basic /);
      assert.match(result.headers.get("Cache-Control")!, /private.*no-store/);
      assert.equal(result.headers.get("ETag"), null);
      if (method === "HEAD") assert.equal(await result.text(), "");
    }
  }
});

test("password login rejects wrong, malformed, oversized and missing secrets", async () => {
  for (const authorization of [
    basic("wrong"),
    basic(password, "admin"),
    "Basic !!!",
    "Basic YQ==",
    "Bearer " + password,
    "Basic " + "a".repeat(3000),
  ]) {
    assert.equal(
      await canRead(
        request("/", { headers: { Authorization: authorization } }),
        env,
      ),
      false,
    );
  }
  for (const secret of [undefined, "short"]) {
    const broken = { ...env, DASHBOARD_PASSWORD: secret };
    assert.equal(
      (
        await worker.fetch(
          request("/", { headers: { Authorization: basic() } }),
          broken,
          ctx,
        )
      ).status,
      401,
    );
  }
  assert.equal(
    await canRead(request("/", { headers: { Authorization: basic() } }), env),
    true,
  );
});

test("rotating the password invalidates the old credentials", async () => {
  const next = { ...env, DASHBOARD_PASSWORD: password + "rotated" };
  assert.equal(
    await canRead(request("/", { headers: { Authorization: basic() } }), next),
    false,
  );
  assert.equal(
    await canRead(
      request("/", {
        headers: { Authorization: basic(next.DASHBOARD_PASSWORD) },
      }),
      next,
    ),
    true,
  );
});

test("configured username replaces the default and invalid usernames deny access", async () => {
  const renamed = { ...env, DASHBOARD_USERNAME: "course-viewer" };
  assert.equal(
    await canRead(
      request("/", { headers: { Authorization: basic() } }),
      renamed,
    ),
    false,
  );
  assert.equal(
    await canRead(
      request("/", {
        headers: { Authorization: basic(password, "course-viewer") },
      }),
      renamed,
    ),
    true,
  );
  for (const username of [
    "",
    " leading",
    "trailing ",
    "with:colon",
    "with\nnewline",
    "a".repeat(65),
  ]) {
    assert.equal(
      await canRead(
        request("/", { headers: { Authorization: basic(password, username) } }),
        { ...env, DASHBOARD_USERNAME: username },
      ),
      false,
    );
  }
});

test("authenticated assets override public cache headers and old cache validators", async () => {
  const assets = {
    async fetch(input: Request) {
      assert.equal(input.headers.get("If-None-Match"), null);
      assert.equal(input.headers.get("If-Modified-Since"), null);
      return new Response("dashboard html", {
        headers: {
          "Cache-Control": "public, max-age=3600",
          ETag: '"old"',
          "Last-Modified": "Mon, 14 Sep 2026 00:00:00 GMT",
        },
      });
    },
  } as unknown as Fetcher;
  const result = await worker.fetch(
    request("/", {
      headers: {
        Authorization: basic(),
        "If-None-Match": '"old"',
        "If-Modified-Since": "Mon, 14 Sep 2026 00:00:00 GMT",
      },
    }),
    { ...env, ASSETS: assets },
    ctx,
  );
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "dashboard html");
  assert.match(result.headers.get("Cache-Control")!, /private.*no-store/);
  assert.equal(result.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  assert.equal(result.headers.get("ETag"), null);
  assert.equal(result.headers.get("Last-Modified"), null);
  assert.equal(result.headers.get("Vary"), "Authorization");
});

test("private data reads never consult a shared cache or reuse public ETags", async () => {
  const database = {
    prepare() {
      return {
        async first() {
          return { id: "saved-version", payload: '{"test":"protected-data"}' };
        },
      };
    },
  } as unknown as D1Database;
  const result = await worker.fetch(
    request("/api/v1/dashboard", {
      headers: { Authorization: basic(), "If-None-Match": '"saved-version"' },
    }),
    { ...env, DB: database },
    ctx,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { test: "protected-data" });
  assert.match(result.headers.get("Cache-Control")!, /no-store/);
  assert.equal(result.headers.get("ETag"), null);
  const head = await worker.fetch(
    request("/api/v1/dashboard", {
      method: "HEAD",
      headers: { Authorization: basic() },
    }),
    { ...env, DB: database },
    ctx,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("viewer password does not grant admin access or permission to change data", async () => {
  for (const path of ["/api/admin/snapshots", "/api/admin/activate"]) {
    for (const method of ["GET", "POST"]) {
      const result = await worker.fetch(
        request(path, { method, headers: { Authorization: basic() } }),
        env,
        ctx,
      );
      assert.equal(result.status, 401);
    }
  }
  const result = await worker.fetch(
    request("/api/v1/dashboard", {
      method: "DELETE",
      headers: { Authorization: basic() },
    }),
    env,
    ctx,
  );
  assert.equal(result.status, 405);
  assert.equal(
    (
      await worker.fetch(
        request("/api/v1/dashboard", {
          headers: { Authorization: "Bearer " + env.INGEST_TOKEN },
        }),
        env,
        ctx,
      )
    ).status,
    401,
  );
});

test("separate operator token still permits authenticated snapshot management", async () => {
  const database = {
    prepare() {
      return {
        async all() {
          return { results: [] };
        },
      };
    },
  } as unknown as D1Database;
  const result = await worker.fetch(
    request("/api/admin/snapshots", {
      headers: { Authorization: "Bearer " + env.INGEST_TOKEN },
    }),
    { ...env, DB: database },
    ctx,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { snapshots: [] });
  assert.match(result.headers.get("Cache-Control")!, /no-store/);
});

test("plain HTTP cannot return data or issue a password challenge", async () => {
  const result = await worker.fetch(
    new Request("http://example.test/api/v1/dashboard", {
      headers: { Authorization: basic() },
    }),
    env,
    ctx,
  );
  assert.equal(result.status, 308);
  assert.equal(
    result.headers.get("Location"),
    "https://example.test/api/v1/dashboard",
  );
  assert.equal(result.headers.get("WWW-Authenticate"), null);
  assert.equal(await result.text(), "");
});

test("production configuration routes every static asset through authentication", () => {
  const config = readFileSync(
    import.meta.dirname + "/../wrangler.jsonc",
    "utf8",
  );
  assert.match(config, /"run_worker_first"\s*:\s*true/);
  assert.match(config, /"DATA_ACCESS"\s*:\s*"password"/);
  assert.match(config, /"preview_urls"\s*:\s*false/);
  assert.doesNotMatch(config, /"DASHBOARD_PASSWORD"/);
});
