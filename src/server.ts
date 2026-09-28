import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { AiSystemService } from "./services/ai-systems.js";
import { buildApp } from "./app.js";
import { AuthService } from "./services/auth.js";
import { MemberService } from "./services/members.js";
import { ToolRequestService } from "./services/tool-requests.js";

const config = loadConfig();
if (config.ALLOW_DEV_AUTH) console.warn("WARNING: ALLOW_DEV_AUTH is enabled; x-dev-* headers can impersonate any user. Never enable this outside local development.");
const pool = createPool(config.DATABASE_URL);
const app = await buildApp(config, {
  aiSystems: new AiSystemService(pool),
  auth: new AuthService(pool, config.SESSION_TTL_HOURS),
  toolRequests: new ToolRequestService(pool),
  members: new MemberService(pool)
});

const shutdown = async () => { await app.close(); await pool.end(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ host: "0.0.0.0", port: config.PORT });
