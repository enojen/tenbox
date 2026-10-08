import { z } from "zod";
import { type Endpoint, endpointError, postJson } from "./http.ts";

const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

type Envelope = z.infer<typeof EnvelopeSchema>;

export interface GraphqlRequest<T> {
  endpoint: Endpoint;
  query: string;
  variables: Record<string, string>;
  data: z.ZodType<T>;
}

/** Sends one query or mutation; GraphQL `errors` and a `data` that does not match fail it. */
export async function graphqlQuery<T>(request: GraphqlRequest<T>): Promise<T> {
  const { endpoint, query, variables } = request;
  const envelope = await postJson({ endpoint, body: { query, variables }, schema: EnvelopeSchema });
  throwOnErrors(endpoint, envelope);
  const data = request.data.safeParse(envelope.data);
  if (!data.success) throw endpointError(endpoint, "empty or unexpected data");
  return data.data;
}

function throwOnErrors(endpoint: Endpoint, envelope: Envelope): void {
  const messages = envelope.errors?.map((error) => error.message) ?? [];
  if (messages.length === 0) return;
  throw endpointError(endpoint, messages.join("; "));
}
