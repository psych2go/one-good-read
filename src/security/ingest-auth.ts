/** Shared-secret auth for machine newsletter ingest (agent inbox → Worker). */
export function isIngestBearerAuthorized(request: Request, env: Env): boolean {
  const secret = Reflect.get(env, "INGEST_EMAIL_SECRET");
  if (typeof secret !== "string" || !secret) return false;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return false;
  return secretsEqual(match[1]!, secret);
}

function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
