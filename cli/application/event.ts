import { errorMessage } from "../../domain/errors/index.ts";
import { newEventId, projectId } from "../../domain/ids.ts";
import { outboxFile, projectDir } from "../../domain/taskDirs.ts";
import {
  outboxText,
  readOutboxLines,
  type TenportEvent,
  type TenportEventBody,
} from "../../domain/tenportEvents.ts";
import { env, log, type TenportServer } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { tenport } from "../infra/tenport.ts";

export const events = { send };

async function send(body: TenportEventBody): Promise<void> {
  const { tenport: server, tenboxHome } = env();
  if (server === null) return;
  const event: TenportEvent = { id: newEventId(), at: new Date().toISOString(), ...body };
  const file = outboxFile(projectDir(tenboxHome, projectId(body.project)));
  try {
    const waiting = await readOutbox(file);
    const left = await sendAll(server, [...waiting, event]);
    await saveOutbox(file, left);
  } catch (e) {
    log(`task event not sent: ${errorMessage(e)}`);
  }
}

async function readOutbox(file: string): Promise<TenportEvent[]> {
  const content = await files.read(file);
  return content === null ? [] : readOutboxLines(content, file);
}

async function sendAll(server: TenportServer, waiting: TenportEvent[]): Promise<TenportEvent[]> {
  for (const [index, event] of waiting.entries()) {
    try {
      await tenport.sendEvents({ server, events: [event] });
    } catch (e) {
      log(`task event kept in the outbox: ${errorMessage(e)}`);
      return waiting.slice(index);
    }
  }
  return [];
}

async function saveOutbox(file: string, left: TenportEvent[]): Promise<void> {
  if (left.length === 0) await files.remove(file);
  else await files.write(file, outboxText(left));
}
