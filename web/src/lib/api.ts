import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ListService } from "../gen/life/v1/lists_pb";
import { TaskService } from "../gen/life/v1/tasks_pb";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function needsLogin(error: unknown): boolean {
  return (
    (error instanceof HttpError && error.status === 401) ||
    (error instanceof ConnectError && error.code === Code.Unauthenticated)
  );
}
export class Api {
  csrf = "";
  readonly tasks;
  readonly lists;
  constructor(readonly origin: string) {
    const transport = createConnectTransport({
      baseUrl: origin,
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      interceptors: [
        (next) => async (request) => {
          request.header.set("x-csrf-token", this.csrf);
          return next(request);
        },
      ],
    });
    this.tasks = createClient(TaskService, transport);
    this.lists = createClient(ListService, transport);
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.origin + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(90000),
      headers:
        body === undefined
          ? {}
          : { "content-type": "application/json", "x-csrf-token": this.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new HttpError(
        response.status,
        response.status === 403
          ? "This account does not have access."
          : response.status === 429
            ? "Too many sign-in attempts. Try again in a minute."
            : "The service is unavailable. Please retry.",
      );
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  async session() {
    const session = await this.request<{ csrf: string }>("/auth/session");
    this.csrf = session.csrf;
  }
  async login(path: string, nonce: string, credential = "") {
    const session = await this.request<{ csrf: string }>(path, {
      nonce,
      credential,
    });
    this.csrf = session.csrf;
  }
}
