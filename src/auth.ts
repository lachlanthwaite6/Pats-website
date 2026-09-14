import { createRemoteJWKSet, jwtVerify } from "jose";
export interface AccessEnv {
  DATA_ACCESS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  INGEST_TOKEN?: string;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function canRead(
  request: Request,
  env: AccessEnv,
): Promise<boolean> {
  if (env.DATA_ACCESS === "public") return true;
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
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([digest(token), digest(env.INGEST_TOKEN)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
