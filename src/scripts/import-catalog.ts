// Loads verified vendor facts into the shared AI tool catalog: npm run catalog:import -- facts.json
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { CatalogService, catalogFacts } from "../services/catalog.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run catalog:import -- <facts.json>");
const entries = catalogFacts.parse(JSON.parse(await readFile(file, "utf8")));
const pool = createPool(loadConfig().DATABASE_URL);
try {
  process.stdout.write(`Imported ${await new CatalogService(pool).import(entries)} catalog entries\n`);
} finally {
  await pool.end();
}
