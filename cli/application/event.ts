import path from "node:path";
import { errorMessage } from "../../domain/errors/index.ts";
import { outboxEvent, type TenportEvent, type TenportEventBody } from "../../domain/event.ts";
import { newEventId, projectId } from "../../domain/ids.ts";
import { outboxDir, outboxEventFile, projectDir } from "../../domain/taskDirs.ts";
import { env, log, type TenportServer } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { failedStatus } from "../infra/http.ts";
import { tenport } from "../infra/tenport.ts";

const HTTP_BAD_REQUEST = 400;
const EVENT_FILE = ".json";

export const events = { send };

async function send(body: TenportEventBody): Promise<void> {
  const { tenport: server, tenboxHome } = env();
  if (server === null) return;
  const event: TenportEvent = { id: newEventId(), at: new Date().toISOString(), ...body };
  const outbox = outboxDir(projectDir(tenboxHome, projectId(body.project)));
  try {
    await files.write(outboxEventFile(outbox, event.id), `${JSON.stringify(event)}\n`);
    await sendAll(server, outbox);
  } catch (e) {
    log(`task event not sent: ${errorMessage(e)}`);
  }
}

async function sendAll(server: TenportServer, outbox: string): Promise<void> {
  const waiting = await readOutbox(outbox);
  for (const file of waiting) {
    const sent = await sendOne(server, file);
    if (!sent) return;
  }
}

async function readOutbox(outbox: string): Promise<string[]> {
  const names = await files.list(outbox);
  return names
    .filter((name) => name.endsWith(EVENT_FILE))
    .sort()
    .map((name) => path.join(outbox, name));
}

async function sendOne(server: TenportServer, file: string): Promise<boolean> {
  const text = await files.read(file);
  if (text === null) return true;
  const event = outboxEvent(text);
  if (event === undefined) return drop(file, "not JSON");
  try {
    await tenport.sendEvents({ server, events: [event] });
  } catch (e) {
    if (failedStatus(e) === HTTP_BAD_REQUEST) return drop(file, errorMessage(e));
    log(`task event kept in the outbox: ${errorMessage(e)}`);
    return false;
  }
  await files.remove(file);
  return true;
}

async function drop(file: string, reason: string): Promise<boolean> {
  log(`task event dropped: ${path.basename(file)}: ${reason}`);
  await files.remove(file);
  return true;
}
