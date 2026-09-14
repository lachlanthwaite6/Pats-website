// Run after npm run dev. Mutates local D1 only and restores the initial snapshot.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:8787";
const token = fs
  .readFileSync(".dev.vars", "utf8")
  .match(/^INGEST_TOKEN=(.+)$/m)[1];
const password = fs
  .readFileSync(".dev.vars", "utf8")
  .match(/^DASHBOARD_PASSWORD=(.+)$/m)[1];
const username =
  fs
    .readFileSync(".dev.vars", "utf8")
    .match(/^DASHBOARD_USERNAME=(.+)$/m)?.[1] ?? "dashboard";
const viewerHeaders = {
  Authorization:
    "Basic " + Buffer.from(username + ":" + password).toString("base64"),
};
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const call = (path, init = {}) => fetch(origin + path, init);
const view = (path, init = {}) =>
  call(path, { ...init, headers: { ...viewerHeaders, ...init.headers } });
const read = () => view("/api/v1/dashboard");
const start = await read();
assert.equal(start.status, 200);
const original = await start.json();
const firstId = createHash("sha256")
  .update(JSON.stringify(original))
  .digest("hex");
const bad = structuredClone(original);
bad.overview.totalCustomers += 1;
assert.equal(
  (
    await call("/api/admin/snapshots", {
      method: "POST",
      headers,
      body: JSON.stringify(bad),
    })
  ).status,
  422,
);
assert.equal(
  (
    await call("/api/admin/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(original),
    })
  ).status,
  401,
);
const changed = structuredClone(original);
changed.meta.generatedAt = new Date().toISOString();
let newId;
try {
  const publish = await call("/api/admin/snapshots", {
    method: "POST",
    headers,
    body: JSON.stringify(changed),
  });
  assert.equal(publish.status, 201);
  newId = (await publish.json()).id;
  const repeat = await call("/api/admin/snapshots", {
    method: "POST",
    headers,
    body: JSON.stringify(changed),
  });
  assert.equal((await repeat.json()).id, newId);
  const list = await (await call("/api/admin/snapshots", { headers })).json();
  assert.equal(list.snapshots.filter((s) => s.id === newId).length, 1);
  assert.equal(
    (
      await call("/api/admin/activate", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "f".repeat(64) }),
      })
    ).status,
    404,
  );
} finally {
  assert.equal(
    (
      await call("/api/admin/activate", {
        method: "POST",
        headers,
        body: JSON.stringify({ id: firstId }),
      })
    ).status,
    200,
  );
}
const check = await read();
assert.equal(check.status, 200);
assert.equal(
  (await view("/api/v1/dashboard", { method: "DELETE" })).status,
  405,
);
assert.equal((await view("/private/FLIPPEDupdated.xlsx")).status, 404);
assert.equal((await call("/api/v1/dashboard")).status, 401);
assert.equal(
  (
    await view("/api/v1/dashboard", {
      headers: { "If-None-Match": '"' + firstId + '"' },
    })
  ).status,
  200,
);
assert.equal(check.headers.get("ETag"), null);
assert.match(check.headers.get("Cache-Control"), /private.*no-store/);
console.log(
  "Local integration checks passed: valid/idempotent import, invalid import rejection, unauthorised reads/writes, rollback, missing version, private-file exclusion and no-store responses.",
);
