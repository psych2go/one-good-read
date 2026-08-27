export function apiEndpoint(baseUrl: string, resource: "responses" | "embeddings"): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new Error("AI base URL must be an absolute HTTPS URL");
  return `${normalized}/${resource}`;
}
