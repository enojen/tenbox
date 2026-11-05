import path from "node:path";
import { z } from "zod";
import { http } from "./http.ts";

/** Where Kubernetes mounts the pod's service account token and the cluster CA. */
const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const NODES_PATH = "/api/v1/nodes";

/** The cluster API and the files of the service account; the token is read at each request, as the kubelet rotates it. */
export interface KubernetesApi {
  url: string;
  tokenFile: string;
  caFile: string;
}

const NodeSchema = z.object({
  metadata: z.object({ name: z.string().min(1) }),
  spec: z.object({ providerID: z.string().optional() }).default({}),
});

const NodeListSchema = z.object({ items: z.array(NodeSchema) });

/** A Node by name, with its `spec.providerID` (`hcloud://<id>` on Hetzner); null before the cloud controller sets it. */
export interface ClusterNode {
  name: string;
  providerId: string | null;
}

/** The API of the cluster the server runs in, as its pod sees it. */
function inCluster(url: string): KubernetesApi {
  return {
    url,
    tokenFile: path.join(SERVICE_ACCOUNT_DIR, "token"),
    caFile: path.join(SERVICE_ACCOUNT_DIR, "ca.crt"),
  };
}

/** Every Node of the cluster. */
async function nodes(api: KubernetesApi): Promise<ClusterNode[]> {
  const token = await Bun.file(api.tokenFile).text();
  const ca = await Bun.file(api.caFile).text();
  const list = await http.get({
    service: "kubernetes",
    url: `${api.url}${NODES_PATH}`,
    token: token.trim(),
    schema: NodeListSchema,
    ca,
  });
  return list.items.map((item) => ({
    name: item.metadata.name,
    providerId: item.spec.providerID ?? null,
  }));
}

export const kubernetes = { inCluster, nodes };
