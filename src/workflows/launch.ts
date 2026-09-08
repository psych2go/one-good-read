/** createBatch skips IDs already present within retention; operational errors must still propagate.
 * https://developers.cloudflare.com/workflows/build/workers-api/#createbatch
 */
export async function launchWorkflow<P>(binding: Pick<Workflow<P>, "createBatch">, options: WorkflowInstanceCreateOptions<P>): Promise<void> {
  try {
    const instances = await binding.createBatch([options]);
    console.log(JSON.stringify({ event: instances.length ? "workflow_created" : "workflow_existing", instanceId: options.id }));
  } catch (error) {
    console.error(JSON.stringify({ event: "workflow_create_failed", instanceId: options.id, message: error instanceof Error ? error.message : String(error) }));
    throw error;
  }
}
