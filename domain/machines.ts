/** The resource classes of tenyard `task/classes.yaml` that a machine run takes. */
export const RESOURCE_CLASS = { plan: "plan", build: "build", heavy: "heavy" } as const;

export type ResourceClass = (typeof RESOURCE_CLASS)[keyof typeof RESOURCE_CLASS];
