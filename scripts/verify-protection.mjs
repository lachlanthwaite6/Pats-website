// Read-only checks against an exact HTTPS deployment or the loopback dev server.
// Supply DASHBOARD_PASSWORD via the environment, never a command-line argument.
import assert from "node:assert/strict";
const origin = new URL(process.argv[2]);
if (
  origin.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(origin.hostname)
)
  throw Error("HTTPS required");
if (origin.pathname !== "/" || origin.username || origin.password)
  throw Error("Supply an origin only");
const password = process.env.DASHBOARD_PASSWORD;
if (!password) throw Error("DASHBOARD_PASSWORD environment variable required");
const authorization =
  "Basic " + Buffer.from("dashboard:" + password).toString("base64");
const call = (path, headers = {}, method = "GET") =>
  fetch(new URL(path, origin), {
    headers,
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
const privateHeaders = (response) => {
  assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
  assert.equal(
    response.headers.get("Cloudflare-CDN-Cache-Control"),
    "no-store",
  );
  assert.equal(response.headers.get("ETag"), null);
};
const paths = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/charts.js",
  "/api/health",
  "/api/v1/dashboard",
  "/api/v1/dashboard?cache-bypass=1",
  "/api/v1/integrations",
];
for (const path of paths) {
  // Authenticated request first checks that subsequent anonymous requests cannot
  // inherit a cache entry populated by an authenticated viewer.
  const allowed = await call(path, { Authorization: authorization });
  if (path === "/index.html" && [301, 302, 307, 308].includes(allowed.status)) {
    const destination = new URL(allowed.headers.get("Location"), origin);
    assert.equal(destination.origin, origin.origin);
    assert.equal(destination.pathname, "/");
  } else assert.equal(allowed.status, 200, "Authenticated " + path);
  privateHeaders(allowed);
  if (path === "/api/v1/dashboard") {
    const data = await allowed.json();
    assert.equal(data.schemaVersion, 1);
    assert.ok(data.plans.length > 0);
  } else await allowed.arrayBuffer();
  for (const method of ["GET", "HEAD"]) {
    const blocked = await call(path, { "If-None-Match": "*" }, method);
    assert.equal(blocked.status, 401, "Anonymous " + method + " " + path);
    assert.match(blocked.headers.get("WWW-Authenticate"), /^Basic /);
    privateHeaders(blocked);
    const body = await blocked.text();
    assert.ok(body === "" || body === '{"error":"sign_in_required"}');
  }
}
for (const path of ["/", "/api/v1/dashboard"]) {
  const blocked = await call(path, {
    Authorization:
      "Basic " + Buffer.from("dashboard:incorrect-password").toString("base64"),
  });
  assert.equal(blocked.status, 401);
  await blocked.arrayBuffer();
}
for (const path of [
  "/private/snapshot.json",
  "/private/FLIPPEDupdated.xlsx",
  "/private/dashboard-login.txt",
  "/.dev.vars",
  "/src/worker.ts",
]) {
  const response = await call(path, { Authorization: authorization });
  assert.equal(response.status, 404, "Private file " + path);
  await response.arrayBuffer();
}
for (const path of ["/api/admin/snapshots", "/api/admin/activate"]) {
  const response = await call(path, { Authorization: authorization }, "POST");
  assert.equal(response.status, 401, "Viewer cannot write " + path);
  await response.arrayBuffer();
}
const write = await call(
  "/api/v1/dashboard",
  { Authorization: authorization },
  "DELETE",
);
assert.equal(write.status, 405);
await write.arrayBuffer();
console.log(
  "Protection verified: authenticated dashboard/assets/API work; anonymous and incorrect logins are blocked; responses are not publicly cacheable; private files are absent; viewers cannot write.",
);
