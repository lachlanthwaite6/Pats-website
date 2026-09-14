// Apply the credentials in the ignored private login file to the existing Worker.
// No credentials are accepted as arguments or printed. --check makes no network requests.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("..", import.meta.url));
const origin =
  "https://flipped-energy-dashboard.flipped-energy-dashboard.workers.dev";

try {
  if (process.argv.slice(2).some((arg) => arg !== "--check"))
    throw Error("Usage: node scripts/apply-login.mjs [--check]");
  const file = new URL("../private/dashboard-login.txt", import.meta.url);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const field = (name) => {
    const matches = [
      ...text.matchAll(new RegExp("^" + name + ": (.*)$", "gm")),
    ];
    if (matches.length !== 1 || !matches[0][1])
      throw Error(
        "The private login file must contain exactly one non-empty " +
          name +
          ": line.",
      );
    return matches[0][1];
  };
  const username = field("Username");
  const password = field("Password");
  if (
    username.length > 64 ||
    username.trim() !== username ||
    /[:\x00-\x1f\x7f]/.test(username)
  )
    throw Error(
      "Username must be 1–64 characters, with no colon, control characters, or surrounding spaces.",
    );
  if (password.length < 24 || password.length > 256)
    throw Error(
      "Password must be 24–256 characters. Save a strong password or passphrase in the private login file before applying it. Nothing was uploaded.",
    );
  const website = new URL(field("Website"));
  if (
    website.origin !== origin ||
    website.username ||
    website.password ||
    website.pathname !== "/" ||
    website.search ||
    website.hash
  )
    throw Error(
      "Website must be the existing Flipped Energy dashboard origin.",
    );
  fs.chmodSync(file, 0o600);
  if (process.argv.includes("--check")) {
    console.log("Login file is valid. No credentials displayed or uploaded.");
  } else {
    console.log(
      "Updating both viewing credentials securely in the existing Cloudflare Worker…",
    );
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "secret",
        "bulk",
        "--name",
        "flipped-energy-dashboard",
      ],
      {
        cwd,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "62df0a240c39df7d80860b78e228ac8c",
        },
        input: JSON.stringify({
          DASHBOARD_USERNAME: username,
          DASHBOARD_PASSWORD: password,
        }),
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      const output = ((result.stdout || "") + (result.stderr || ""))
        .replaceAll(password, "[redacted]")
        .replaceAll(username, "[redacted]");
      if (output) process.stderr.write(output);
      throw Error(
        "Cloudflare did not confirm the update. Check the error above; do not assume the credentials changed.",
      );
    }
    const authorization =
      "Basic " + Buffer.from(username + ":" + password).toString("base64");
    let verified = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(origin + "/api/v1/dashboard", {
        headers: { Authorization: authorization },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      const status = response.status;
      await response.arrayBuffer();
      if (status === 200) {
        verified = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!verified)
      throw Error(
        "Cloudflare accepted the secrets, but login verification did not pass. The latest username-supporting code must be deployed. Keep the saved credentials and investigate before retrying.",
      );
    const anonymous = await fetch(origin + "/api/v1/dashboard", {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    await anonymous.arrayBuffer();
    if (anonymous.status !== 401)
      throw Error(
        "Anonymous access check failed. Investigate site protection immediately.",
      );
    console.log(
      "Login updated and verified. The saved credentials work, and anonymous access is blocked. Use a private browser window if your browser remembers the previous login.",
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Login update failed.",
  );
  process.exitCode = 1;
}
