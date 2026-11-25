import { app } from "./app";

const PORT = Number(process.env.PORT ?? 8811);
Bun.serve({ port: PORT, fetch: app.handle });
console.log(`skill-sync server on http://localhost:${PORT}`);
