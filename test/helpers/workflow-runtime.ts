// Test-only stand-in for the platform entrypoint; durable step execution is supplied by each test.
export class WorkflowEntrypoint<E> {
  constructor(readonly ctx: unknown, readonly env: E) {}
}
