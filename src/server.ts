import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { AiSystemService } from "./services/ai-systems.js";
import { buildApp } from "./app.js";
import { AuthService } from "./services/auth.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp(config, new AiSystemService(pool), new AuthService(pool, config.SESSION_TTL_HOURS));

const shutdown = async () => { await app.close(); await pool.end(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ host: "0.0.0.0", port: config.PORT });
