import { serverEnv } from "./infra/env.ts";
import { sqlite } from "./infra/sqlite.ts";
import { app } from "./routes/index.ts";

/** Loopback only until requests carry a token (TEN-340). */
const SERVER_HOST = "localhost";

const { port, dbFile } = serverEnv();
sqlite.open(dbFile);
Bun.serve({ hostname: SERVER_HOST, port, fetch: app.fetch });
console.error(`listening on http://${SERVER_HOST}:${port}, docs on /docs`);
