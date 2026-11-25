import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { oauthRoutes } from "./routes/oauth";
import { authRoutes } from "./routes/oidc";
import { mcpRoutes } from "./routes/mcp";
import { apiRoutes } from "./routes/api";

// The app without bun.serve, so tests can drive it in-process via app.handle().
// CORS: the desktop webview (tauri://localhost) calls /api + /mcp with an Authorization header.
export const app = new Elysia()
  .use(cors())
  .get("/", () => "skill-sync server")
  .use(oauthRoutes())
  .use(authRoutes())
  .use(mcpRoutes())
  .use(apiRoutes());
