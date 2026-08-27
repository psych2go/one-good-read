import fs from "node:fs";
const config = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const vars = config.vars ?? {};
const errors = [];
if (!/^https:\/\//.test(vars.APP_ORIGIN ?? "") || /localhost|127\.0\.0\.1/.test(vars.APP_ORIGIN ?? "")) errors.push("APP_ORIGIN must be the production HTTPS origin");
if (!vars.ADMIN_EMAIL || vars.ADMIN_EMAIL === "local@example.com") errors.push("ADMIN_EMAIL must be the production administrator email");
if (!vars.ACCESS_TEAM_DOMAIN) errors.push("ACCESS_TEAM_DOMAIN is required");
if (!vars.ACCESS_AUD) errors.push("ACCESS_AUD is required");
if (vars.AI_PROVIDER !== "openai") errors.push("AI_PROVIDER must be set to the production provider");
if (vars.EMBEDDING_PROVIDER !== "openai") errors.push("EMBEDDING_PROVIDER must be set to the production provider");
if (!config.d1_databases?.[0]?.database_id || /^0+$/.test(config.d1_databases[0].database_id.replaceAll("-", ""))) errors.push("A real D1 database_id is required");
if (errors.length) { console.error(`Production configuration is incomplete:\n- ${errors.join("\n- ")}`); process.exit(1); }
console.log("Production configuration checks passed.");
