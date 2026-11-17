import { expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import { type TenportEventBody, taskClosed, taskStarted } from "../../domain/event.ts";
import { projectId, taskId } from "../../domain/ids.ts";

const TENPORT_OPENAPI = path.join(import.meta.dir, "../test/tenport-openapi.json");

const RefSchema = z.object({ $ref: z.string() });
const FieldsSchema = z.object({
  required: z.array(z.string()).default([]),
  properties: z.record(z.string(), z.unknown()),
});
const TypeNameSchema = z.object({
  properties: z.object({ type: z.object({ enum: z.array(z.string()) }) }),
});
const ApiSchema = z.object({
  components: z.object({
    schemas: z
      .object({
        TasksEvent: z.object({
          oneOf: z.array(z.object({ allOf: z.tuple([RefSchema, TypeNameSchema]) })),
        }),
        ReportedEvent: z.object({ allOf: z.tuple([RefSchema, FieldsSchema]) }),
      })
      .catchall(z.unknown()),
  }),
});

type Api = z.infer<typeof ApiSchema>;
type Fields = z.infer<typeof FieldsSchema>;

async function readApi(): Promise<Api> {
  const json = await Bun.file(TENPORT_OPENAPI).json();
  return ApiSchema.parse(json);
}

function schemaOfRef(api: Api, ref: string): Fields {
  const name = ref.replace("#/components/schemas/", "");
  return FieldsSchema.parse(api.components.schemas[name]);
}

function eventTypes(api: Api): Map<string, Fields> {
  const variants = api.components.schemas.TasksEvent.oneOf.map((variant) => {
    const [ref, typeName] = variant.allOf;
    const fields = schemaOfRef(api, ref.$ref);
    return typeName.properties.type.enum.map((type): [string, Fields] => [type, fields]);
  });
  return new Map(variants.flat());
}

const task = { project: projectId("k7f3qa"), task: taskId("TEN-1") };
const fullEvents: TenportEventBody[] = [
  taskStarted({ ...task, title: "Login", url: "https://linear.app/x/TEN-1" }),
  taskClosed(task),
];
const smallestEvents: TenportEventBody[] = [
  taskStarted({ ...task, title: "", url: "" }),
  taskClosed(task),
];

const fieldsOf = (event: TenportEventBody): string[] =>
  Object.keys(event).filter((field) => field !== "type");

test("every event type tenbox sends is one Tenport knows", async () => {
  const api = await readApi();
  const known = [...eventTypes(api).keys()];
  for (const event of fullEvents) expect(known).toContain(event.type);
});

test("every field tenbox sends is a field of its Tenport event", async () => {
  const api = await readApi();
  const types = eventTypes(api);
  for (const event of fullEvents) {
    const known = Object.keys(types.get(event.type)?.properties ?? {});
    expect(known).toEqual(expect.arrayContaining(fieldsOf(event)));
  }
});

test("every field Tenport needs is in the smallest event tenbox sends", async () => {
  const api = await readApi();
  const types = eventTypes(api);
  for (const event of smallestEvents) {
    const needed = types.get(event.type)?.required ?? [];
    expect(fieldsOf(event)).toEqual(expect.arrayContaining(needed));
  }
});

test("Tenport needs the id and the time that tenbox adds to each event", async () => {
  const api = await readApi();
  const [, stamp] = api.components.schemas.ReportedEvent.allOf;
  expect(stamp.required.toSorted()).toEqual(["at", "id"]);
});
