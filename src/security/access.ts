import { createRemoteJWKSet, jwtVerify } from "jose";

interface AccessEnv { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAIL: string; }

export async function isAuthorizedAdmin(request: Request, env: AccessEnv): Promise<boolean> {
  if (Reflect.get(env, "LOCAL_ADMIN_BYPASS") === "true") return true;
  const requestHost = new URL(request.url).hostname;
  if (requestHost === "localhost" || requestHost === "127.0.0.1") return true;
  const teamDomain = normalizeTeamDomain(String(env.ACCESS_TEAM_DOMAIN));
  const audience = String(env.ACCESS_AUD).trim();
  if (!teamDomain || !audience) return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const result = await jwtVerify(token, jwks, { issuer: teamDomain, audience });
    return typeof result.payload.email === "string" && result.payload.email.toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase();
  } catch (error) {
    console.warn(JSON.stringify({ event: "access_jwt_rejected", message: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
function normalizeTeamDomain(value: string): string { const trimmed = value.trim().replace(/\/$/, ""); if (!trimmed) return ""; return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`; }
