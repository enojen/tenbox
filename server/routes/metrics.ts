import type { NodeAdded } from "../../domain/events.ts";

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

const NODE_GAUGE = "tenbox_node_price_eur_hourly";

function header(gauge: string, help: string): string[] {
  return [`# HELP ${gauge} ${help}`, `# TYPE ${gauge} gauge`];
}

/** A label value of the text format escapes backslash, double quote and newline. */
function labelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function series(gauge: string, labels: [string, string][], value: string | number): string {
  const text = labels.map(([name, label]) => `${name}="${labelValue(label)}"`).join(",");
  return `${gauge}{${text}} ${value}`;
}

function nodeSeries(worker: NodeAdded): string {
  const labels: [string, string][] = [
    ["node", worker.node],
    ["server_type", worker.server_type],
    ["location", worker.location],
  ];
  return series(NODE_GAUGE, labels, worker.price_hourly.net);
}

/** The body of `GET /metrics`: one gauge series per worker that is up. */
export function metricsText(workers: NodeAdded[]): string {
  const lines = [
    ...header(NODE_GAUGE, "Hourly list price in EUR of a worker that is up."),
    ...workers.map(nodeSeries),
  ];
  return `${lines.join("\n")}\n`;
}
