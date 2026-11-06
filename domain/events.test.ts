import { describe, expect, test } from "bun:test";
import {
  closeOutput,
  type EventName,
  EventSchema,
  eventSubject,
  type JobFinished,
  jobChanges,
  jobFinished,
  type ListedPod,
  type ListedVolume,
  volumeAction,
  volumeAdded,
  volumeChanges,
  volumeIdleId,
  volumeRemoved,
} from "./events.ts";

const COMMON = {
  id: "wf_7359/a9703d/round.reviewed",
  schema: 1,
  user: "u-4k2m7a",
  tenbox: "9d90eeb",
  at: "2026-10-08T10:00:00Z",
  sent_at: "2026-10-08T10:00:05Z",
};
const TASK = "k7f3qa/TEN-301";
const ROUND = "k7f3qa/TEN-301/r2";
/** A SHA-256 of `plan.md`, in hex. */
const PLAN_SHA = "a".repeat(64);

/** The fields of one event after the common ones. */
type EventFields = Record<string, unknown>;

/** One example per event; keyed by `EventName`, so a missing event does not compile. */
const EXAMPLES: Record<EventName, EventFields> = {
  "task.started": {
    task: TASK,
    project: "k7f3qa",
    title: "Add login",
    tracker: "linear",
    url: "https://linear.app/x",
    branch: "feat/TEN-301",
    base: { ref: "main", sha: "9d90eeb" },
  },
  "plan.started": { task: TASK, deep: false },
  "plan.done": {
    task: TASK,
    plan_sha: PLAN_SHA,
    estimated_lines: 300,
    parts: [
      { id: "p01", difficulty: "easy" },
      { id: "p02", difficulty: "hard" },
    ],
    examples: 4,
    questions: { total: 2, blocking: 1 },
    lenses: ["security"],
  },
  "plan.approved": { task: TASK, plan_sha: PLAN_SHA },
  "build.started": { task: TASK, max_rounds: 3 },
  "build.done": { task: TASK, status: "ready", rounds: 2 },
  "feedback.sent": { task: TASK, round: "k7f3qa/TEN-301/r3", from: "human", must_fix: 1 },
  "round.started": { round: ROUND },
  "round.checked": {
    round: ROUND,
    commit: "a1b2c3d",
    ok: false,
    checks: [
      {
        id: "r2/unit",
        exit_code: 1,
        duration_ms: 8400,
        timed_out: false,
        failures: 3,
        new_failures: 1,
        fixed: 0,
        baseline: { sha: "9d90eeb", source: "exact" },
      },
    ],
  },
  "round.reviewed": {
    round: ROUND,
    must_fix: 1,
    nice_to_have: 3,
    attention: 2,
    unproven: [{ part: "p02", reason: "no test" }],
  },
  "proof.added": {
    part: "k7f3qa/TEN-301/p01",
    file: "domain/login.test.ts",
    test: "rejects an empty password",
    failure: "expected 400, got 200",
    source: "worker",
  },
  "workflow.done": {
    task: TASK,
    workflow: "tenbox-build",
    run: "wf_1",
    agents: [
      {
        role: "worker",
        label: "p01",
        round: 2,
        model: "claude-sonnet-5-5",
        started: "2026-10-08T10:00:00Z",
        seconds: 310,
        tokens: 48000,
        tool_calls: 62,
      },
      {
        role: "runner",
        label: null,
        round: null,
        model: null,
        started: null,
        seconds: null,
        tokens: null,
        tool_calls: null,
      },
    ],
  },
  "pr.saved": {
    task: TASK,
    number: 12,
    url: "https://github.com/x/y/pull/12",
    state: "created",
    draft: true,
  },
  "pr.merged": { task: TASK, number: 12 },
  "task.closed": {
    task: TASK,
    forced: false,
    code: { added: 420, removed: 80, files: 9, test_added: 150 },
  },
};

const build = (event: string, fields: EventFields) => ({ ...COMMON, event, ...fields });
const approved = (): Record<string, unknown> => build("plan.approved", EXAMPLES["plan.approved"]);

describe("EventSchema", () => {
  for (const [event, fields] of Object.entries(EXAMPLES)) {
    test(`parses ${event}`, () => {
      expect(String(EventSchema.parse(build(event, fields)).event)).toBe(event);
    });
  }

  test("covers the 15 events of the data model", () => {
    expect(Object.keys(EXAMPLES)).toHaveLength(15);
  });

  for (const field of ["id", "schema", "event", "user", "tenbox", "at", "sent_at"]) {
    test(`rejects an event without ${field}`, () => {
      const rest = approved();
      delete rest[field];
      expect(EventSchema.safeParse(rest).success).toBe(false);
    });
  }

  test("rejects an unknown event name", () => {
    expect(EventSchema.safeParse(build("task.unknown", EXAMPLES["plan.approved"])).success).toBe(
      false,
    );
  });

  test("rejects an at that is not an ISO date-time", () => {
    expect(EventSchema.safeParse({ ...approved(), at: "yesterday" }).success).toBe(false);
  });

  test("plan.done and plan.approved need a SHA-256 plan_sha", () => {
    const done: Record<string, unknown> = build("plan.done", EXAMPLES["plan.done"]);
    for (const event of [done, approved()]) {
      const { plan_sha: _, ...without } = event;
      expect(EventSchema.safeParse(without).success).toBe(false);
      expect(EventSchema.safeParse({ ...event, plan_sha: "abc" }).success).toBe(false);
    }
  });

  test("rejects an unknown schema version", () => {
    expect(EventSchema.safeParse({ ...approved(), schema: 2 }).success).toBe(false);
  });
});

describe("eventSubject", () => {
  test("is the task of a task event", () => {
    const event = EventSchema.parse(build("plan.approved", EXAMPLES["plan.approved"]));
    expect(eventSubject(event)).toBe(TASK);
  });

  test("is the round of a round event", () => {
    const event = EventSchema.parse(build("round.started", EXAMPLES["round.started"]));
    expect(eventSubject(event)).toBe(ROUND);
  });

  test("is the part of a proof event", () => {
    const event = EventSchema.parse(build("proof.added", EXAMPLES["proof.added"]));
    expect(eventSubject(event)).toBe("k7f3qa/TEN-301/p01");
  });
});

const POD: ListedPod = {
  uid: "uid-1",
  name: "task-ten-7-1105-100000-abcde",
  job: "task-ten-7-1105-100000",
  task: "TEN-7",
  project: "demo",
  command: "tenbox build TEN-7",
  class: "build",
  node: null,
  created: "2026-11-05T10:00:00.000Z",
  scheduled: null,
  started: null,
  end: null,
  requests: { cpu: "500m", memory: "2Gi" },
};

describe("job.finished", () => {
  test("a pod that went before it was scheduled has no duration", () => {
    const event = jobFinished({ pod: POD, oomInLog: false, at: "2026-11-05T10:01:00.000Z" });
    expect(event).toMatchObject({ exit_code: null, finished: "2026-11-05T10:01:00.000Z" });
    expect(event.duration_ms).toBeNull();
  });

  test("a stored pod is neither ended nor gone", () => {
    const ended = { ...POD, end: { exitCode: 0, reason: null, finished: POD.created } };
    const changes = jobChanges({
      seen: [POD],
      stored: new Set(["job.finished:uid-1"]),
      listed: [ended],
    });
    expect(changes).toEqual({ ended: [], gone: [] });
  });
});

const VOLUME: ListedVolume = {
  name: "task-187",
  uid: "pvc-uid-1",
  task: "187",
  created: "2026-11-05T10:00:00.000Z",
  capacity: "10Gi",
};
const VOLUME_PRICE = { net: "0.0440", gross: "0.0524" };

describe("volume events", () => {
  test("size_gb is the capacity in GiB, rounded up", () => {
    const sizes = ["10Gi", "5G", "10737418241", "1Ti"].map(
      (capacity) => volumeAdded({ volume: { ...VOLUME, capacity }, price: VOLUME_PRICE }).size_gb,
    );
    expect(sizes).toEqual([10, 5, 11, 1024]);
  });

  test("a capacity that is not a quantity is a bad file", () => {
    expect(() =>
      volumeAdded({ volume: { ...VOLUME, capacity: "ten" }, price: VOLUME_PRICE }),
    ).toThrow("not a quantity: ten");
  });

  test("a volume is matched by uid, so a new PVC of the same name is a new volume", () => {
    const added = volumeAdded({ volume: VOLUME, price: VOLUME_PRICE });
    const again = { ...VOLUME, uid: "pvc-uid-2" };
    expect(volumeChanges({ stored: [added], listed: [again] })).toEqual({
      added: [again],
      removed: [added],
    });
    const removed = volumeRemoved({ added, late: false });
    expect(volumeChanges({ stored: [added, removed], listed: [again] })).toEqual({
      added: [again],
      removed: [],
    });
  });
});

describe("closeOutput", () => {
  const BLOCK =
    '{\n  "ok": true,\n  "task": "TEN-7",\n  "stats": {\n    "state": "written"\n  }\n}\n';

  test("is the last top-level JSON object of the log", () => {
    const log = `{\n  "ok": false\n}\nnoise\n${BLOCK}tenbox-boot: oom_kill 0\n`;
    expect(closeOutput(log)).toEqual({ ok: true, task: "TEN-7", stats: { state: "written" } });
  });

  test("is null for a log with no object or an object that is not a close output", () => {
    expect(closeOutput("plain\n")).toBeNull();
    expect(closeOutput('{\n  "ok": false,\n  "task": "TEN-7"\n}\n')).toBeNull();
    expect(closeOutput('{\n  "ok": true\n}\n')).toBeNull();
  });
});

describe("volumeAction", () => {
  const NOW = new Date("2026-11-15T10:00:00.000Z");
  const RUN: JobFinished = jobFinished({
    pod: { ...POD, task: "187", project: "tenbox-demo", end: null },
    oomInLog: false,
    at: "2026-11-06T10:00:00.000Z",
  });
  const check = { volume: VOLUME, closedAt: null, runs: [RUN], now: NOW, graceDays: 3 };

  test("deletes a closed volume once the grace period is over", () => {
    expect(volumeAction({ ...check, closedAt: "2026-11-11T10:00:00.000Z" })).toEqual({
      action: "delete",
      volume: VOLUME,
    });
    expect(volumeAction({ ...check, closedAt: "2026-11-13T10:00:00.000Z" })).toBeNull();
  });

  test("a run created after the close or a volume made after it means the task is open again", () => {
    const closedAt = "2026-11-05T12:00:00.000Z";
    const later = { ...RUN, created: "2026-11-05T13:00:00.000Z" };
    expect(volumeAction({ ...check, closedAt, runs: [RUN, later] })).toMatchObject({
      action: "notify",
    });
    const reopened = { ...VOLUME, created: "2026-11-05T13:00:00.000Z" };
    expect(volumeAction({ ...check, closedAt, volume: reopened })).toMatchObject({
      action: "notify",
    });
  });

  test("an open volume with no run for 7 days gets a notice since its newest run", () => {
    expect(volumeAction(check)).toEqual({
      action: "notify",
      volume: VOLUME,
      project: "tenbox-demo",
      since: "2026-11-06T10:00:00.000Z",
      days: 9,
    });
    expect(volumeAction({ ...check, now: new Date("2026-11-13T09:59:59.000Z") })).toBeNull();
  });

  test("with no run, the idle time starts at the volume and the project is the volume name", () => {
    const notice = volumeAction({ ...check, runs: [] });
    expect(notice).toEqual({
      action: "notify",
      volume: VOLUME,
      project: "task-187",
      since: VOLUME.created,
      days: 10,
    });
  });

  test("a notice is stored once per volume and idle stretch", () => {
    const notice = { volume: VOLUME, since: "2026-11-06T10:00:00.000Z" };
    expect(volumeIdleId(notice)).toBe("volume.idle:pvc-uid-1:2026-11-06T10:00:00.000Z");
  });
});
