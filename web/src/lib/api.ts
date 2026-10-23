import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ListService } from "../gen/life/v1/lists_pb";
import { HouseholdService } from "../gen/life/v1/households_pb";
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
export class ContextChanged extends Error {}
export class Api {
  csrf = "";
  private contextEpoch = 0;
  private currentIdentity = "";
  private currentSpace = "personal";
  get identity() {
    return this.currentIdentity;
  }
  set identity(value: string) {
    if (value !== this.currentIdentity) this.contextEpoch++;
    this.currentIdentity = value;
  }
  get space() {
    return this.currentSpace;
  }
  set space(value: string) {
    if (value !== this.currentSpace) this.contextEpoch++;
    this.currentSpace = value;
  }
  accessEnded?: () => void;
  displayName = "";
  spaceLabel = "Personal · Private";
  readonly households;
  readonly tasks;
  readonly lists;
  constructor(readonly origin: string) {
    const transport = createConnectTransport({
      baseUrl: origin,
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      interceptors: [
        (next) => async (request) => {
          const epoch = this.contextEpoch;
          const space = this.space;
          request.header.set("x-csrf-token", this.csrf);
          request.header.set("x-space-id", space);
          try {
            const response = await next(request);
            if (epoch !== this.contextEpoch) throw new ContextChanged();
            return response;
          } catch (error) {
            if (epoch !== this.contextEpoch) throw new ContextChanged();
            const scoped =
              ["life.v1.TaskService", "life.v1.ListService"].includes(
                request.service.typeName,
              ) ||
              (request.service.typeName === "life.v1.HouseholdService" &&
                [
                  "GetHousehold",
                  "ListHouseholdActivity",
                  "ChangeHousehold",
                ].includes(request.method.name));
            if (
              scoped &&
              space !== "personal" &&
              error instanceof ConnectError &&
              error.code === Code.PermissionDenied
            ) {
              this.space = "personal";
              this.accessEnded?.();
              throw new ContextChanged();
            }
            throw error;
          }
        },
      ],
    });
    this.households = createClient(HouseholdService, transport);
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
    const session = await this.request<{
      csrf: string;
      user_sub: string;
      display_name: string;
    }>("/auth/session");
    this.csrf = session.csrf;
    this.identity = session.user_sub;
    this.displayName = session.display_name;
  }
  async login(path: string, nonce: string, credential = "") {
    const session = await this.request<{
      csrf: string;
      user_sub: string;
      display_name: string;
    }>(path, {
      nonce,
      credential,
    });
    this.csrf = session.csrf;
    this.identity = session.user_sub;
    this.displayName = session.display_name;
  }
}
