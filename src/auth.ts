import { createRemoteJWKSet, jwtVerify } from "jose";
export interface AccessEnv {
  DATA_ACCESS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  INGEST_TOKEN?: string;
  DASHBOARD_PASSWORD?: string;
  DASHBOARD_USERNAME?: string;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
// Compare fixed-length digests; never compare secrets with string equality.
async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function canReadWithPassword(request: Request, env: AccessEnv) {
  if (!env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 24)
    return false;
  const username = env.DASHBOARD_USERNAME ?? "dashboard";
  if (
    !username ||
    username.length > 64 ||
    username.trim() !== username ||
    /[:\x00-\x1f\x7f]/.test(username)
  )
    return false;
  const authorization = request.headers.get("Authorization");
  if (!authorization || authorization.length > 2048) return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return false;
  try {
    const decoded = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)));
    return await sameSecret(decoded, username + ":" + env.DASHBOARD_PASSWORD);
  } catch {
    return false;
  }
}

export function readChallenge(request: Request, env: AccessEnv) {
  const headers: HeadersInit = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  };
  if (env.DATA_ACCESS === "password")
    headers["WWW-Authenticate"] =
      'Basic realm="Flipped Energy dashboard", charset="UTF-8"';
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({ error: "sign_in_required" }),
    { status: 401, headers },
  );
}

export async function canRead(
  request: Request,
  env: AccessEnv,
): Promise<boolean> {
  if (env.DATA_ACCESS === "public") return true;
  if (env.DATA_ACCESS === "password") return canReadWithPassword(request, env);
  if (
    env.DATA_ACCESS !== "access" ||
    !env.ACCESS_AUD ||
    !env.ACCESS_TEAM_DOMAIN ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
      env.ACCESS_TEAM_DOMAIN,
    )
  )
    return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    let jwks = keys.get(env.ACCESS_TEAM_DOMAIN);
    if (!jwks) {
      jwks = createRemoteJWKSet(
        new URL(env.ACCESS_TEAM_DOMAIN + "/cdn-cgi/access/certs"),
      );
      keys.set(env.ACCESS_TEAM_DOMAIN, jwks);
    }
    await jwtVerify(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
    });
    return true;
  } catch {
    return false;
  }
}
export async function canWrite(
  request: Request,
  env: AccessEnv,
): Promise<boolean> {
  if (!env.INGEST_TOKEN || env.INGEST_TOKEN.length < 32) return false;
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token || token.length > 512) return false;
  return sameSecret(token, env.INGEST_TOKEN);
}
