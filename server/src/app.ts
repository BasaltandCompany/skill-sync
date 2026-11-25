import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiRoutes } from "./routes/api";
import { authRoutes } from "./routes/oidc";
import { mcpRoutes } from "./routes/mcp";
import { oauthRoutes } from "./routes/oauth";

// The app without bun.serve, so tests can drive it in-process.
// CORS: the desktop webview (tauri://localhost) calls /api + /mcp with an Authorization header.
export const app = new Hono()
  .use("*", cors())
  .get("/", (c) => c.text("skill-sync server"))
  .route("/", oauthRoutes())
  .route("/", authRoutes())
  .route("/", mcpRoutes())
  .route("/", apiRoutes());
