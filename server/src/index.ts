import { serve } from "bun";
import { app } from "./app";

const PORT = Number(process.env.PORT ?? 8811);
serve({ port: PORT, fetch: app.fetch });
console.log(`skill-sync server on http://localhost:${PORT}`);
