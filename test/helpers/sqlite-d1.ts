import { URL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

/** Real SQLite execution with the small D1 API surface used by the repository. Batches are atomic. */
export function sqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../../migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
  }
  class Statement {
    constructor(readonly sql: string, readonly args: SQLInputValue[] = []) {}
    bind(...args: SQLInputValue[]) { return new Statement(this.sql, args); }
    execute(): D1Result {
      const statement = sqlite.prepare(this.sql);
      const results = statement.columns().length ? statement.all(...this.args) : [];
      const changes = statement.columns().length ? 0 : Number(statement.run(...this.args).changes);
      return { success: true, results, meta: { changes, duration: 0, last_row_id: 0, changed_db: changes > 0, rows_read: results.length, rows_written: changes, size_after: 0 } };
    }
    async run() { return this.execute(); }
    async all() { return this.execute(); }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.args);
      return row ? column ? row[column] : row : null;
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
