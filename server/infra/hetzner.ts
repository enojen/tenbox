import { z } from "zod";
import { serviceError } from "../../domain/errors/tools.ts";
import type { HetznerEnv } from "./env.ts";
import { getJson } from "./kubernetes.ts";

/** The Hetzner Cloud API: base URL and token. */
export type HetznerApi = HetznerEnv;

const SERVICE = "hetzner";
/** The providerID the hcloud cloud controller gives a Node of a cloud server. */
const PROVIDER_ID = /^hcloud:\/\/(\d+)$/;

const PriceSchema = z.object({ net: z.string().min(1), gross: z.string().min(1) });

const ServerSchema = z.object({
  server: z.object({
    created: z.iso.datetime({ offset: true }),
    server_type: z.object({
      name: z.string().min(1),
      prices: z.array(z.object({ location: z.string().min(1), price_hourly: PriceSchema })),
    }),
    datacenter: z.object({ location: z.object({ name: z.string().min(1) }) }),
  }),
});

type Price = z.infer<typeof PriceSchema>;

/** One cloud server: when it was made, its type, its location and the hourly price of its type there. */
interface HetznerServer {
  /** ISO time in UTC, as Tenbox writes times. */
  createdAt: string;
  type: string;
  location: string;
  priceHourly: Price;
}

/** One server of the API, by id. */
interface ServerRequest {
  api: HetznerApi;
  id: number;
}

/** The server id of a Node's providerID; null for a Node that is not a Hetzner cloud server. */
function serverId(providerId: string): number | null {
  const match = PROVIDER_ID.exec(providerId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** `GET /servers/<id>`: one call gives the create time, the type, the location and the price. */
async function server(request: ServerRequest): Promise<HetznerServer> {
  const { api, id } = request;
  const answer = await getJson({
    service: SERVICE,
    url: `${api.url}/servers/${id}`,
    token: api.token,
    schema: ServerSchema,
  });
  const { created, server_type: type, datacenter } = answer.server;
  const location = datacenter.location.name;
  const price = type.prices.find((entry) => entry.location === location);
  if (price === undefined) {
    throw serviceError(SERVICE, SERVICE, `server ${id}: no price of ${type.name} in ${location}`);
  }
  return {
    createdAt: new Date(created).toISOString(),
    type: type.name,
    location,
    priceHourly: price.price_hourly,
  };
}

export const hetzner = { serverId, server };
