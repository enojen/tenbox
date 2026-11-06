import type { NodeAdded } from "../../domain/events.ts";

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

const GAUGE = "tenbox_node_price_eur_hourly";
const HEADER = [
  `# HELP ${GAUGE} Hourly list price in EUR of a worker that is up.`,
  `# TYPE ${GAUGE} gauge`,
];

/** A label value of the text format escapes backslash, double quote and newline. */
function labelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function series(worker: NodeAdded): string {
  const labels = [
    ["node", worker.node],
    ["server_type", worker.server_type],
    ["location", worker.location],
  ]
    .map(([name, value]) => `${name}="${labelValue(value ?? "")}"`)
    .join(",");
  return `${GAUGE}{${labels}} ${worker.price_hourly.net}`;
}

/** The body of `GET /metrics`: the gauge of each worker that is up. */
export function metricsText(workers: NodeAdded[]): string {
  return `${[...HEADER, ...workers.map(series)].join("\n")}\n`;
}
