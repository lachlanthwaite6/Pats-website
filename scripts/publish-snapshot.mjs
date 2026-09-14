import fs from "node:fs";
const [origin, file = "private/snapshot.json"] = process.argv.slice(2);
if (!origin)
  throw Error(
    "Usage: INGEST_TOKEN=... node scripts/publish-snapshot.mjs https://your-worker.workers.dev [snapshot.json]",
  );
const url = new URL(origin);
if (
  url.protocol !== "https:" &&
  url.hostname !== "127.0.0.1" &&
  url.hostname !== "localhost"
)
  throw Error("HTTPS required");
const token = process.env.INGEST_TOKEN;
if (!token || token.length < 32)
  throw Error(
    "Set INGEST_TOKEN in your environment; never put it in the browser or Git.",
  );
const body = fs.readFileSync(file, "utf8");
const response = await fetch(new URL("/api/admin/snapshots", url), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body,
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
const result = await response.json();
if (!response.ok) throw Error(JSON.stringify(result));
console.log(JSON.stringify(result));
