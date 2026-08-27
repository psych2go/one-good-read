import { describe, expect, it } from "vitest";
import { isAuthorizedAdmin } from "../src/security/access";
const env = { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_EMAIL: "admin@example.com" };
describe("admin authorization", () => {
  it("allows local development", async () => expect(await isAuthorizedAdmin(new Request("http://localhost/admin"), env)).toBe(true));
  it("fails closed in production when Access is not configured", async () => expect(await isAuthorizedAdmin(new Request("https://read.example/admin"), env)).toBe(false));
});
