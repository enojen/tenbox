import { HOURS_PER_MONTH } from "../../domain/costs.ts";
import type { NodeAdded, VolumeAdded } from "../../domain/events.ts";

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

const NODE_GAUGE = "tenbox_node_price_eur_hourly";
const VOLUME_GAUGE = "tenbox_volume_price_eur_hourly";

interface UpNow {
  workers: NodeAdded[];
  volumes: VolumeAdded[];
}

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

function volumeSeries(volume: VolumeAdded): string {
  const labels: [string, string][] = [
    ["volume", volume.volume],
    ["task", volume.task],
    ["size_gb", String(volume.size_gb)],
  ];
  const hourly = (Number(volume.price_per_gb_month.net) * volume.size_gb) / Number(HOURS_PER_MONTH);
  return series(VOLUME_GAUGE, labels, hourly);
}

/** The body of `GET /metrics`: one gauge series per worker and per task volume that is up. */
export function metricsText(up: UpNow): string {
  const lines = [
    ...header(NODE_GAUGE, "Hourly list price in EUR of a worker that is up."),
    ...up.workers.map(nodeSeries),
    ...header(VOLUME_GAUGE, "Hourly list price in EUR of a task volume that is up."),
    ...up.volumes.map(volumeSeries),
  ];
  return `${lines.join("\n")}\n`;
}
