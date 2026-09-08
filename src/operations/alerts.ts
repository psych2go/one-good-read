interface EmailBinding {
  send(message: { to: string; from: { email: string; name: string }; subject: string; text: string; html: string }): Promise<unknown>;
}
export type ManagedHealthCondition = "publication" | "cleanup" | "storage";
export type DeliveryReadiness = "disabled" | "misconfigured" | "ready";
export interface AlertRow {
  id: string; alert_type: string; severity: string; subject: string; message: string;
  delivery_status: string; delivery_error: string | null; created_at: string;
  lifecycle_status: "historical" | "open" | "acknowledged" | "resolved";
  last_seen_at: string | null; occurrence_count: number; acknowledged_at: string | null; resolved_at: string | null;
}
export function alertDeliveryReadiness(env: Env): DeliveryReadiness {
  if (String(env.ALERTS_ENABLED) !== "true") return "disabled";
  return String(env.ALERT_TO_EMAIL ?? "").trim() && String(env.ALERT_FROM_EMAIL ?? "").trim() && isEmailBinding(Reflect.get(env, "EMAIL")) ? "ready" : "misconfigured";
}

export async function sendOperationalAlert(env: Env, input: { dedupeKey: string; type: string; severity: "warning" | "critical"; subject: string; message: string; managedCondition?: ManagedHealthCondition; healthCheckId?: string }): Promise<void> {
  // One atomic write claims the notification and increments repeats, including acknowledged incidents.
  // Persist BEFORE external I/O: interrupted delivery stays logged, never loses the incident.
  const incident = await env.DB.prepare(`INSERT INTO alerts
    (id,dedupe_key,alert_type,severity,subject,message,delivery_status,lifecycle_status,last_seen_at,managed_condition)
    SELECT ?,?,?,?,?,?,'logged','open',CURRENT_TIMESTAMP,?
    WHERE ? IS NULL OR EXISTS (SELECT 1 FROM system_state WHERE key='operational_health' AND json_extract(value,'$.id')=?)
    ON CONFLICT(dedupe_key) WHERE lifecycle_status IN ('open','acknowledged') DO UPDATE SET
      last_seen_at=CURRENT_TIMESTAMP,occurrence_count=alerts.occurrence_count+1,
      severity=excluded.severity,subject=excluded.subject,message=excluded.message
    RETURNING id,occurrence_count`)
    .bind(crypto.randomUUID(), input.dedupeKey, input.type, input.severity, input.subject, input.message, input.managedCondition ?? null, input.healthCheckId ?? null, input.healthCheckId ?? null)
    .first<{ id: string; occurrence_count: number }>();
  if (!incident || incident.occurrence_count !== 1) return;
  let status: "sent" | "failed" | "disabled" = "disabled";
  let deliveryError: string | null = null;
  const readiness = alertDeliveryReadiness(env);
  const binding = Reflect.get(env, "EMAIL");
  if (readiness === "misconfigured") { status = "failed"; deliveryError = "Email configuration incomplete"; }
  else if (readiness === "ready" && isEmailBinding(binding)) {
    try {
      await binding.send({ to: String(env.ALERT_TO_EMAIL).trim(), from: { email: String(env.ALERT_FROM_EMAIL).trim(), name: "One Good Read" },
        subject: `[One Good Read] ${input.subject}`, text: input.message,
        html: `<h1>${escapeHtml(input.subject)}</h1><p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>` });
      status = "sent";
    } catch (error) { status = "failed"; deliveryError = error instanceof Error ? error.message : String(error); }
  }
  await env.DB.prepare("UPDATE alerts SET delivery_status=?,delivery_error=? WHERE id=?").bind(status, deliveryError, incident.id).run();
}

export async function resolveHealthAlert(env: Env, condition: ManagedHealthCondition, dedupeKey: string, healthCheckId: string): Promise<void> {
  // Check authority inside the UPDATE: a pre-write read would leave another race.
  await env.DB.prepare(`UPDATE alerts SET lifecycle_status='resolved',resolved_at=CURRENT_TIMESTAMP
    WHERE managed_condition=? AND dedupe_key=? AND lifecycle_status IN ('open','acknowledged')
      AND EXISTS (SELECT 1 FROM system_state WHERE key='operational_health' AND json_extract(value,'$.id')=?)`)
    .bind(condition, dedupeKey, healthCheckId).run();
}
export async function acknowledgeAlert(env: Env, id: string): Promise<"acknowledged" | "unknown" | "inactive"> {
  const row = await env.DB.prepare(`UPDATE alerts SET lifecycle_status='acknowledged',acknowledged_at=coalesce(acknowledged_at,CURRENT_TIMESTAMP)
    WHERE id=? AND lifecycle_status IN ('open','acknowledged') RETURNING id`).bind(id).first();
  if (row) return "acknowledged";
  return await env.DB.prepare("SELECT id FROM alerts WHERE id=?").bind(id).first() ? "inactive" : "unknown";
}
function isEmailBinding(value: unknown): value is EmailBinding { return typeof value === "object" && value !== null && "send" in value && typeof Reflect.get(value, "send") === "function"; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
