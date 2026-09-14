import fs from "node:fs";
const body = fs.readFileSync(
  process.argv[2] || "private/snapshot.json",
  "utf8",
);
const token = fs
  .readFileSync(".dev.vars", "utf8")
  .match(/^INGEST_TOKEN=(.+)$/m)?.[1];
if (!token) throw Error("Set a local INGEST_TOKEN in .dev.vars first.");
const response = await fetch("http://127.0.0.1:8787/api/admin/snapshots", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body,
});
const result = await response.json();
if (!response.ok) throw Error(JSON.stringify(result));
console.log("Local snapshot validated and published:", result.id);
