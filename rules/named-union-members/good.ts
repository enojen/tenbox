interface Ok {
  ok: true;
}
interface Failed {
  ok: false;
  reason: string;
}
type Branded = string & { readonly brand: "Branded" };

export type Outcome = Ok | Failed | "skipped" | null;
export type MaybeBranded = Branded | undefined;
export type Items = Array<Ok | Failed>;
