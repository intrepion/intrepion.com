# MVP 3 cutover: Render provider facts

Checked 2026-10-23. Public official documentation only; no credentials, account requests, deployments or infrastructure changes.

## Environment updates

- Single variable: `PUT https://api.render.com/v1/services/{serviceId}/env-vars/{envVarKey}`, JSON `{"value":"..."}`, returns 200. Delete: `DELETE` the same URL, returns 204. These affect directly configured service variables, not linked groups. **Neither endpoint documents whether it triggers deployment**, nor offers a documented suppression parameter. `autoDeployTrigger: off` therefore is not sufficient evidence that these mutations are safe to stage. [PUT reference](https://api-docs.render.com/reference/update-env-var), [DELETE reference](https://api-docs.render.com/reference/delete-env-var)
- Bulk `PUT /v1/services/{serviceId}/env-vars` accepts an array of `{"key":"...","value":"..."}` and replaces the entire variable list, removing omitted variables. Its reference explicitly states that changes require an explicit deployment regardless of `autoDeploy`. This promise belongs to the bulk endpoint; extending it to single-variable mutations would be an inference. [Bulk reference](https://api-docs.render.com/reference/update-env-vars-for-service), [request schema](https://api-docs.render.com/openapi/render-public-api-1.json)
- Dashboard **Save only** explicitly saves without deploying; values take effect on the next deployment. This is the clearly documented staging option when preserving the whole variable list through an API replacement is undesirable. [Environment documentation](https://render.com/docs/configure-environment-variables)

## Suspension and exact revision

- `POST /v1/services/{serviceId}/suspend` and `POST /v1/services/{serviceId}/resume` each document 202. Their references do not specify the commit/configuration chosen on resume. [Suspend](https://api-docs.render.com/reference/suspend-service-1), [resume](https://api-docs.render.com/reference/resume-service-1)
- Deploy hooks explicitly reject suspended services with 409. The REST trigger documents generic 409, without promising deployment while suspended. **A suspend → build/deploy → verify → resume sequence is not established by these docs.** Resume also must not be assumed to preserve the old runtime environment: the OpenAPI deploy-trigger enum includes `service_resumed`, but its detailed behavior is unspecified. [Hooks](https://render.com/docs/deploy-hooks), [trigger](https://api-docs.render.com/reference/create-deploy), [OpenAPI](https://api-docs.render.com/openapi/render-public-api-1.json)
- Exact revision: `POST /v1/services/{serviceId}/deploys`, JSON `{"commitId":"<full SHA>"}`. Default mode is `build_and_deploy`; available modes are `build_and_deploy` and `deploy_only`, with no build-only mode here. Specifying a SHA does not disable automatic deployments. [Trigger reference](https://api-docs.render.com/reference/create-deploy)
- `GET /v1/services/{serviceId}/deploys/{deployId}` exposes `commit.id` and `status`; verify the exact SHA and successful state. `live` means deployed, so this is not an offline approval checkpoint. A restart retains existing deployed configuration and does not incorporate pending environment changes. [Retrieve](https://api-docs.render.com/reference/retrieve-deploy), [response schema](https://api-docs.render.com/openapi/render-public-api-1.json), [restart behavior](https://render.com/docs/deploys#restarting-a-service)

Operational conclusion: resolve single-variable deployment semantics with Render before using that endpoint for private staging. Treat enabling the startup freeze through deployment, and resuming service, as live cutover actions requiring the separately authorized procedure.

## Draining the old writer

Healthy replacement receives incoming traffic and becomes current commit; **60 seconds later** Render sends old-instance `SIGTERM`, then `SIGKILL` after its shutdown delay (default 30 seconds, configurable through `maxShutdownDelaySeconds`, maximum 300). Inference: wait at least **60 + actual shutdown delay** after observing `live`, then drain outstanding database operations; `live` alone is insufficient. Render does not document remote database cancellation/completion guarantees. [Lifecycle](https://render.com/docs/deploys#zero-downtime-deploys)

Existing WebSockets can survive until old-instance shutdown. [Connections](https://render.com/docs/websocket#handling-instance-shutdown)

Save-only values apply on the next deployment. Combining that promise with explicit `commitId` deployment supports deploying the frozen revision with stored variables; verify runtime freeze responses before backup. A restart retains old variables. [Variables](https://render.com/docs/configure-environment-variables), [deploy behavior](https://render.com/docs/deploys)
