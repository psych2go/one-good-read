import fs from "node:fs";
const config = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const vars = config.vars ?? {};
const errors = [];
if (!/^https:\/\//.test(vars.APP_ORIGIN ?? "") || /localhost|127\.0\.0\.1/.test(vars.APP_ORIGIN ?? "")) errors.push("APP_ORIGIN must be the production HTTPS origin");
if (!vars.ADMIN_EMAIL || vars.ADMIN_EMAIL === "local@example.com") errors.push("ADMIN_EMAIL must be the production administrator email");
if (!vars.ACCESS_TEAM_DOMAIN) errors.push("ACCESS_TEAM_DOMAIN is required");
const automationEnabled = vars.AUTOMATION_ENABLED === "true";
if (automationEnabled && !vars.ACCESS_AUD) errors.push("ACCESS_AUD is required before automation is enabled");
const compatibleProviders = new Set(["openai", "openai-compatible"]);
if (automationEnabled && !compatibleProviders.has(vars.AI_PROVIDER)) errors.push("AI_PROVIDER must be openai or openai-compatible before automation is enabled");
if (automationEnabled && !compatibleProviders.has(vars.EMBEDDING_PROVIDER)) errors.push("EMBEDDING_PROVIDER must be openai or openai-compatible before automation is enabled");
if (automationEnabled && !/^https:\/\//.test(vars.AI_BASE_URL ?? "")) errors.push("AI_BASE_URL must be an HTTPS API prefix");
if (!config.d1_databases?.[0]?.database_id || /^0+$/.test(config.d1_databases[0].database_id.replaceAll("-", ""))) errors.push("A real D1 database_id is required");
if (errors.length) { console.error(`Production configuration is incomplete:\n- ${errors.join("\n- ")}`); process.exit(1); }
console.log(automationEnabled ? "Production configuration checks passed with automation enabled." : "Production safe-shell checks passed; automation remains disabled.");
