import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "../src/db/schema.sql");
const schema = await fs.readFile(schemaPath, "utf8");

await pool.query(schema);
await pool.end();
console.log("Database schema initialized");
