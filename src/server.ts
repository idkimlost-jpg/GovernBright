import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";
import { createServices } from "./services/index.js";

const config = loadConfig();
if (config.ALLOW_DEV_AUTH) console.warn("WARNING: ALLOW_DEV_AUTH is enabled; x-dev-* headers can impersonate any user. Never enable this outside local development.");
if (!config.APP_ENCRYPTION_KEY) console.warn("APP_ENCRYPTION_KEY is not set; two-factor authentication, single sign-on and integrations are unavailable.");
const pool = createPool(config.DATABASE_URL);
const app = await buildApp(config, createServices(config, pool));

const shutdown = async () => { await app.close(); await pool.end(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ host: "0.0.0.0", port: config.PORT });
