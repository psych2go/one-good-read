interface EmailBinding {
  send(message: { to: string; from: { email: string; name: string }; subject: string; text: string; html: string }): Promise<unknown>;
}

export async function sendOperationalAlert(env: Env, input: { dedupeKey: string; type: string; severity: "warning" | "critical"; subject: string; message: string }): Promise<void> {
  const duplicate = await env.DB.prepare("SELECT id FROM alerts WHERE dedupe_key=? AND datetime(created_at) >= datetime('now','-24 hours') LIMIT 1").bind(input.dedupeKey).first<{ id: string }>();
  if (duplicate) return;
  let status: "logged" | "sent" | "failed" | "disabled" = "logged";
  let deliveryError: string | undefined;
  const enabled = String(env.ALERTS_ENABLED) === "true";
  const to = String(env.ALERT_TO_EMAIL).trim();
  const from = String(env.ALERT_FROM_EMAIL).trim();
  const rawBinding = Reflect.get(env, "EMAIL");
  const binding = isEmailBinding(rawBinding) ? rawBinding : undefined;
  if (!enabled || !to || !from || !binding) status = "disabled";
  else {
    try {
      await binding.send({
        to,
        from: { email: from, name: "One Good Read" },
        subject: `[One Good Read] ${input.subject}`,
        text: input.message,
        html: `<h1>${escapeHtml(input.subject)}</h1><p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>`,
      });
      status = "sent";
    } catch (error) {
      status = "failed";
      deliveryError = error instanceof Error ? error.message : String(error);
    }
  }
  await env.DB.prepare(`INSERT INTO alerts (id,dedupe_key,alert_type,severity,subject,message,delivery_status,delivery_error) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), input.dedupeKey, input.type, input.severity, input.subject, input.message, status, deliveryError ?? null).run();
}

function isEmailBinding(value: unknown): value is EmailBinding { return typeof value === "object" && value !== null && "send" in value && typeof Reflect.get(value, "send") === "function"; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
