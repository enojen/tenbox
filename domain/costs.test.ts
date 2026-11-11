import { expect, test } from "bun:test";
import { type CostWindow, costReport, type StoredEvent } from "./costs.ts";
import type { JobFinished } from "./events.ts";

const WINDOW: CostWindow = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" };
const PRICE = { net: "0.0076", gross: "0.0090" };

interface Worker {
  node: string;
  serverId: number;
  price?: string;
}

function added(worker: Worker, at: string): StoredEvent {
  const net = worker.price ?? PRICE.net;
  return {
    at,
    event: {
      event: "node.added",
      node: worker.node,
      server_id: worker.serverId,
      server_type: "cx22",
      location: "fsn1",
      price_hourly: { net, gross: PRICE.gross },
    },
  };
}

function removed(worker: Worker, at: string): StoredEvent {
  return {
    at,
    event: {
      event: "node.removed",
      node: worker.node,
      server_id: worker.serverId,
      server_type: "cx22",
      location: "fsn1",
      late: false,
    },
  };
}

const ONE: Worker = { node: "worker-1", serverId: 1 };
const TWO: Worker = { node: "worker-2", serverId: 2 };

test("a worker that came before the window pays only the hours that start inside it", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [added(ONE, "2026-11-01T23:30:00Z"), removed(ONE, "2026-11-02T02:00:00Z")],
  });
  expect(report.workers.map((w) => w.paid_hours)).toEqual([2]);
});

test("a worker that left before the window has no line", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [added(ONE, "2026-11-01T10:00:00Z"), removed(ONE, "2026-11-01T12:00:00Z")],
  });
  expect(report.workers).toEqual([]);
  expect(report.total).toEqual({ paid_hours: 0, gb_hours: 0, eur: "0.00" });
});

test("a worker that came after the window has no line", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [added(ONE, "2026-11-09T00:00:00Z")],
  });
  expect(report.workers).toEqual([]);
});

test("a started hour that ends after the removal is paid whole", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [added(ONE, "2026-11-03T10:00:00Z"), removed(ONE, "2026-11-03T10:00:01Z")],
  });
  expect(report.workers.map((w) => w.paid_hours)).toEqual([1]);
});

test("eur is the paid hours times the net price, rounded half up to cents", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [
      added({ ...ONE, price: "0.0050" }, "2026-11-03T10:00:00Z"),
      removed(ONE, "2026-11-03T11:00:00Z"),
      added({ ...TWO, price: "1.2" }, "2026-11-03T10:00:00Z"),
      removed(TWO, "2026-11-03T13:00:00Z"),
    ],
  });
  expect(report.workers.map((w) => w.eur)).toEqual(["0.01", "3.60"]);
  expect(report.total).toEqual({ paid_hours: 4, gb_hours: 0, eur: "3.61" });
});

test("every server is its own worker line, the oldest first", () => {
  const ci: Worker = { node: "tenbox-ci", serverId: 3 };
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [added(ONE, "2026-11-04T00:00:00Z"), added(ci, "2026-10-01T00:00:00Z")],
  });
  expect(report.workers.map((w) => w.node)).toEqual(["tenbox-ci", "worker-1"]);
  expect(report.workers[0]).toEqual({
    node: "tenbox-ci",
    server_id: 3,
    server_type: "cx22",
    location: "fsn1",
    paid_hours: 168,
    busy_hours: 0,
    waste_hours: 168,
    eur: "1.28",
  });
});

test("a node.removed with no node.added has no line", () => {
  const report = costReport({
    window: WINDOW,
    pods: [],
    events: [removed(ONE, "2026-11-03T10:00:00Z")],
  });
  expect(report.workers).toEqual([]);
});

test("a price that is not decimal text is a bad file", () => {
  const events = [added({ ...ONE, price: "cheap" }, "2026-11-03T10:00:00Z")];
  expect(() => costReport({ window: WINDOW, events, pods: [] })).toThrow("price_hourly.net");
});

/** One box pod of a task on a node, from its `started` to its `finished`. */
interface Pod {
  task: string;
  project?: string | null;
  node: string;
  started: string | null;
  finished: string;
  memory: string | null;
}

function pod(input: Pod): JobFinished {
  return {
    event: "job.finished",
    task: input.task,
    project: input.project === undefined ? "tenbox" : input.project,
    job: `task-${input.task}`,
    pod: `task-${input.task}-pod`,
    command: "build",
    class: "build",
    node: input.node,
    exit_code: 0,
    oom: false,
    created: input.started ?? input.finished,
    scheduled: input.started,
    started: input.started,
    finished: input.finished,
    duration_ms: null,
    requests: { cpu: "1", memory: input.memory },
  };
}

const ON_ONE = { node: ONE.node, memory: "2Gi" };
const WORKER_ONE_3H = [added(ONE, "2026-11-03T09:00:00Z"), removed(ONE, "2026-11-03T12:00:00Z")];

test("busy hours and waste per worker from job.finished", () => {
  const report = costReport({
    window: WINDOW,
    events: WORKER_ONE_3H,
    pods: [
      pod({
        ...ON_ONE,
        task: "A",
        started: "2026-11-03T10:00:00Z",
        finished: "2026-11-03T11:00:00Z",
      }),
      pod({
        ...ON_ONE,
        task: "B",
        started: "2026-11-03T10:30:00Z",
        finished: "2026-11-03T11:30:00Z",
      }),
    ],
  });
  expect(report.workers).toMatchObject([{ paid_hours: 3, busy_hours: 1.5, waste_hours: 1.5 }]);
});

test("a worker's busy cost is split over tasks by memory request and time", () => {
  const hour = {
    node: ONE.node,
    started: "2026-11-03T10:00:00Z",
    finished: "2026-11-03T11:00:00Z",
  };
  const report = costReport({
    window: WINDOW,
    events: [added({ ...ONE, price: "0.03" }, "2026-11-03T09:00:00Z")],
    pods: [pod({ ...hour, task: "A", memory: "4Gi" }), pod({ ...hour, task: "B", memory: "2Gi" })],
  });
  expect(report.tasks).toEqual([
    {
      project: "tenbox",
      task: "A",
      workers: [{ node: "worker-1", server_id: 1, eur: "0.02" }],
      volumes: [],
      eur: "0.02",
    },
    {
      project: "tenbox",
      task: "B",
      workers: [{ node: "worker-1", server_id: 1, eur: "0.01" }],
      volumes: [],
      eur: "0.01",
    },
  ]);
});

test("a pod that never started adds nothing", () => {
  const report = costReport({
    window: WINDOW,
    events: WORKER_ONE_3H,
    pods: [pod({ ...ON_ONE, task: "A", started: null, finished: "2026-11-03T11:00:00Z" })],
  });
  expect(report.workers).toMatchObject([{ busy_hours: 0, waste_hours: 3 }]);
  expect(report.tasks).toEqual([]);
});

test("busy time is cut to the window and to its server", () => {
  const late: Worker = { node: ONE.node, serverId: 9 };
  const report = costReport({
    window: { from: "2026-11-03T10:00:00Z", to: "2026-11-03T13:00:00Z" },
    events: [...WORKER_ONE_3H, added(late, "2026-11-03T12:30:00Z")],
    pods: [
      pod({
        ...ON_ONE,
        task: "A",
        started: "2026-11-03T09:00:00Z",
        finished: "2026-11-03T10:30:00Z",
      }),
      pod({
        ...ON_ONE,
        task: "B",
        started: "2026-11-03T12:45:00Z",
        finished: "2026-11-03T14:00:00Z",
      }),
      pod({
        ...ON_ONE,
        task: "C",
        node: "worker-2",
        started: "2026-11-03T10:00:00Z",
        finished: "2026-11-03T11:00:00Z",
      }),
    ],
  });
  expect(report.workers.map((w) => [w.server_id, w.busy_hours, w.waste_hours])).toEqual([
    [1, 0.5, 1.5],
    [9, 0.25, 0.75],
  ]);
  expect(report.tasks.map((t) => [t.task, t.workers.map((w) => w.server_id)])).toEqual([
    ["A", [1]],
    ["B", [9]],
  ]);
});

test("a task's eur is the sum of its shares on every worker", () => {
  const hour = {
    task: "A",
    memory: "1Gi",
    started: "2026-11-03T10:00:00Z",
    finished: "2026-11-03T11:00:00Z",
  };
  const report = costReport({
    window: WINDOW,
    events: [
      added({ ...ONE, price: "0.0150" }, "2026-11-03T09:00:00Z"),
      added({ ...TWO, price: "0.0250" }, "2026-11-03T09:00:00Z"),
    ],
    pods: [pod({ ...hour, node: ONE.node }), pod({ ...hour, node: TWO.node })],
  });
  expect(report.tasks).toEqual([
    {
      project: "tenbox",
      task: "A",
      workers: [
        { node: "worker-1", server_id: 1, eur: "0.02" },
        { node: "worker-2", server_id: 2, eur: "0.03" },
      ],
      volumes: [],
      eur: "0.05",
    },
  ]);
});

test("a memory request that is not a quantity is a bad file", () => {
  const pods = [
    pod({
      ...ON_ONE,
      task: "A",
      memory: "lots",
      started: "2026-11-03T10:00:00Z",
      finished: "2026-11-03T11:00:00Z",
    }),
  ];
  expect(() => costReport({ window: WINDOW, events: WORKER_ONE_3H, pods })).toThrow(
    "requests.memory of task-A-pod",
  );
});

const SAME_HOUR = {
  node: ONE.node,
  memory: "1Gi",
  started: "2026-11-03T10:00:00Z",
  finished: "2026-11-03T11:00:00Z",
};

test("the same task id in two projects gives two task lines", () => {
  const report = costReport({
    window: WINDOW,
    events: [added({ ...ONE, price: "0.04" }, "2026-11-03T09:00:00Z")],
    pods: [
      pod({ ...SAME_HOUR, task: "169", project: "tenbox" }),
      pod({ ...SAME_HOUR, task: "169", project: "tenyard" }),
    ],
  });
  expect(report.tasks.map((t) => [t.project, t.task, t.eur])).toEqual([
    ["tenbox", "169", "0.02"],
    ["tenyard", "169", "0.02"],
  ]);
});

test("task lines sort by project, then task id, a null project first", () => {
  const report = costReport({
    window: WINDOW,
    events: [added(ONE, "2026-11-03T09:00:00Z")],
    pods: [
      pod({ ...SAME_HOUR, task: "2", project: "b" }),
      pod({ ...SAME_HOUR, task: "9", project: "a" }),
      pod({ ...SAME_HOUR, task: "1", project: "b" }),
      pod({ ...SAME_HOUR, task: "5", project: null }),
    ],
  });
  expect(report.tasks.map((t) => [t.project, t.task])).toEqual([
    [null, "5"],
    ["a", "9"],
    ["b", "1"],
    ["b", "2"],
  ]);
});

/** One task volume from its `volume.added`. */
interface Volume {
  task: string;
  sizeGb: number;
  net: string;
}

const VOLUME_187: Volume = { task: "187", sizeGb: 10, net: "4.4000" };

function volumeAdded(volume: Volume, at: string): StoredEvent {
  return {
    at,
    event: {
      event: "volume.added",
      volume: `task-${volume.task}`,
      uid: `uid-${volume.task}`,
      task: volume.task,
      size_gb: volume.sizeGb,
      price_per_gb_month: { net: volume.net, gross: volume.net },
    },
  };
}

function volumeRemoved(volume: Volume, at: string): StoredEvent {
  return {
    at,
    event: {
      event: "volume.removed",
      volume: `task-${volume.task}`,
      uid: `uid-${volume.task}`,
      task: volume.task,
      size_gb: volume.sizeGb,
      late: false,
    },
  };
}

const DAY: CostWindow = { from: "2026-11-05T00:00:00Z", to: "2026-11-06T00:00:00Z" };

test("a volume line counts its GB-hours and EUR in the window", () => {
  const report = costReport({
    window: DAY,
    pods: [],
    events: [
      volumeAdded(VOLUME_187, "2026-11-05T10:00:00Z"),
      volumeRemoved(VOLUME_187, "2026-11-05T12:00:00Z"),
    ],
  });
  expect(report.volumes).toEqual([
    { volume: "task-187", task: "187", project: null, size_gb: 10, gb_hours: 20, eur: "0.12" },
  ]);
});

test("a GB-month is 720 hours, as on the Hetzner bill", () => {
  const month: CostWindow = { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" };
  const volume: Volume = { task: "7", sizeGb: 10, net: "0.0730" };
  const report = costReport({
    window: month,
    pods: [],
    events: [volumeAdded(volume, "2026-11-01T00:00:00Z")],
  });
  expect(report.volumes.map((v) => [v.gb_hours, v.eur])).toEqual([[7200, "0.73"]]);
});

test("a volume cut by the window counts only its hours inside it", () => {
  const report = costReport({
    window: DAY,
    pods: [],
    events: [volumeAdded(VOLUME_187, "2026-11-04T23:00:00Z")],
  });
  expect(report.volumes.map((v) => v.gb_hours)).toEqual([240]);
});

test("a volume outside the window has no line", () => {
  const report = costReport({
    window: DAY,
    pods: [],
    events: [
      volumeAdded(VOLUME_187, "2026-11-04T10:00:00Z"),
      volumeRemoved(VOLUME_187, "2026-11-04T12:00:00Z"),
    ],
  });
  expect(report.volumes).toEqual([]);
  expect(report.tasks).toEqual([]);
});

test("a volume's project is the project of the newest job.finished of its task", () => {
  const run = { node: ONE.node, memory: null, started: "2026-11-05T09:00:00Z" };
  const report = costReport({
    window: DAY,
    pods: [
      pod({ ...run, task: "187", project: "new", finished: "2026-11-05T11:00:00Z" }),
      pod({ ...run, task: "187", project: "old", finished: "2026-11-05T10:00:00Z" }),
      pod({ ...run, task: "9", project: "other", finished: "2026-11-05T12:00:00Z" }),
    ],
    events: [volumeAdded(VOLUME_187, "2026-11-05T10:00:00Z")],
  });
  expect(report.volumes.map((v) => v.project)).toEqual(["new"]);
});

test("a volume's EUR is added to its task line and the total", () => {
  const hour = { node: ONE.node, memory: "1Gi", task: "187", project: "tenbox" };
  const report = costReport({
    window: DAY,
    events: [
      added({ ...ONE, price: "1.00" }, "2026-11-05T09:00:00Z"),
      removed(ONE, "2026-11-05T10:00:00Z"),
      volumeAdded({ task: "187", sizeGb: 73, net: "0.25" }, "2026-11-05T09:00:00Z"),
      volumeRemoved({ task: "187", sizeGb: 73, net: "0.25" }, "2026-11-05T11:00:00Z"),
      volumeAdded({ task: "9", sizeGb: 73, net: "0.25" }, "2026-11-05T09:00:00Z"),
      volumeRemoved({ task: "9", sizeGb: 73, net: "0.25" }, "2026-11-05T10:00:00Z"),
    ],
    pods: [pod({ ...hour, started: "2026-11-05T09:00:00Z", finished: "2026-11-05T10:00:00Z" })],
  });
  expect(report.tasks).toEqual([
    {
      project: null,
      task: "9",
      workers: [],
      volumes: [{ volume: "task-9", eur: "0.03" }],
      eur: "0.03",
    },
    {
      project: "tenbox",
      task: "187",
      workers: [{ node: "worker-1", server_id: 1, eur: "1.00" }],
      volumes: [{ volume: "task-187", eur: "0.05" }],
      eur: "1.05",
    },
  ]);
  expect(report.total).toEqual({ paid_hours: 1, gb_hours: 219, eur: "1.08" });
});

test("a volume price that is not decimal text is a bad file", () => {
  const events = [volumeAdded({ ...VOLUME_187, net: "cheap" }, "2026-11-05T10:00:00Z")];
  expect(() => costReport({ window: DAY, events, pods: [] })).toThrow(
    "price_per_gb_month.net of task-187",
  );
});
