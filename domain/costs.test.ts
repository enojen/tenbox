import { expect, test } from "bun:test";
import { type CostWindow, costReport, type StoredNodeEvent } from "./costs.ts";

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
    events: [added(ONE, "2026-11-01T23:30:00Z"), removed(ONE, "2026-11-02T02:00:00Z")],
  });
  expect(report.workers.map((w) => w.paid_hours)).toEqual([2]);
});

test("a worker that left before the window has no line", () => {
  const report = costReport({
    window: WINDOW,
    events: [added(ONE, "2026-11-01T10:00:00Z"), removed(ONE, "2026-11-01T12:00:00Z")],
  });
  expect(report.workers).toEqual([]);
  expect(report.total).toEqual({ paid_hours: 0, eur: "0.00" });
});

test("a worker that came after the window has no line", () => {
  const report = costReport({ window: WINDOW, events: [added(ONE, "2026-11-09T00:00:00Z")] });
  expect(report.workers).toEqual([]);
});

test("a started hour that ends after the removal is paid whole", () => {
  const report = costReport({
    window: WINDOW,
    events: [added(ONE, "2026-11-03T10:00:00Z"), removed(ONE, "2026-11-03T10:00:01Z")],
  });
  expect(report.workers.map((w) => w.paid_hours)).toEqual([1]);
});

test("eur is the paid hours times the net price, rounded half up to cents", () => {
  const report = costReport({
    window: WINDOW,
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
    events: [added(ONE, "2026-11-04T00:00:00Z"), added(ci, "2026-10-01T00:00:00Z")],
  });
  expect(report.workers.map((w) => w.node)).toEqual(["tenbox-ci", "worker-1"]);
  expect(report.workers[0]).toEqual({
    node: "tenbox-ci",
    server_id: 3,
    server_type: "cx22",
    location: "fsn1",
    paid_hours: 168,
    eur: "1.28",
  });
});

test("a node.removed with no node.added has no line", () => {
  const report = costReport({ window: WINDOW, events: [removed(ONE, "2026-11-03T10:00:00Z")] });
  expect(report.workers).toEqual([]);
});

test("a price that is not decimal text is a bad file", () => {
  const events = [added({ ...ONE, price: "cheap" }, "2026-11-03T10:00:00Z")];
  expect(() => costReport({ window: WINDOW, events })).toThrow("price_hourly.net");
});
