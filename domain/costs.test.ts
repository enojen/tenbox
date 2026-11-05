import { expect, test } from "bun:test";
import { type CostWindow, costReport, type StoredNodeEvent } from "./costs.ts";
import type { JobFinished } from "./events.ts";

const WINDOW: CostWindow = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" };
const PRICE = { net: "0.0076", gross: "0.0090" };

interface Worker {
  node: string;
  serverId: number;
  price?: string;
}

function added(worker: Worker, at: string): StoredNodeEvent {
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

function removed(worker: Worker, at: string): StoredNodeEvent {
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
  expect(report.total).toEqual({ paid_hours: 0, eur: "0.00" });
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
  expect(report.total).toEqual({ paid_hours: 4, eur: "3.61" });
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
  node: string;
  started: string | null;
  finished: string;
  memory: string | null;
}

function pod(input: Pod): JobFinished {
  return {
    event: "job.finished",
    task: input.task,
    project: "tenbox",
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
    { task: "A", workers: [{ node: "worker-1", server_id: 1, eur: "0.02" }], eur: "0.02" },
    { task: "B", workers: [{ node: "worker-1", server_id: 1, eur: "0.01" }], eur: "0.01" },
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
      task: "A",
      workers: [
        { node: "worker-1", server_id: 1, eur: "0.02" },
        { node: "worker-2", server_id: 2, eur: "0.03" },
      ],
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
