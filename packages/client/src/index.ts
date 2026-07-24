/**
 * Typed versionless SDK. Wire types are derived per pinned version from the
 * server's registered change chain (`ClientTypes`) — no codegen, and the
 * current shapes come from the same single parent source the server uses.
 *
 *   import type { demoApi } from "demo/versions";  // your app's registered chain
 *   const client = createClient<typeof demoApi, Shapes>()({
 *     baseUrl: "http://localhost:3000",
 *     version: "2025-06-01",
 *   });
 *   const user = await client.request("GET /users/:id", { params: { id: "u_1" } });
 *   // user: { id: string; email: string; name: string }  <- the 2025 shape
 */
import { HEADERS } from "@versionless/core";
import type {
  ClientTypes,
  CurrentShape,
  KnownVersion,
  VersionedApi,
} from "@versionless/core";

export class VersionlessClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly route: string,
  ) {
    super(`${route} responded ${status}`);
    this.name = "VersionlessClientError";
  }
}

export interface ClientOptions<V extends string> {
  baseUrl: string;
  /** Pinned API version — sent as the version header on every request. */
  version?: V;
  /**
   * Header the version pin is sent as. Defaults to "x-api-version"; override
   * it to mirror a custom server-side resolve chain.
   */
  versionHeader?: string;
  /** Consumer API key — sent as x-api-key (what the dashboard groups by). */
  apiKey?: string;
  headers?: Record<string, string>;
  /** Injectable transport — e.g. an in-process `app.handle` for tests. */
  fetch?: (req: Request) => Promise<Response>;
}

type PathParamNames<R extends string> = R extends `${string}:${infer Rest}`
  ? Rest extends `${infer Name}/${infer Tail}`
    ? Name | PathParamNames<`/${Tail}`>
    : Rest
  : never;

type ParamsFor<R extends string> = [PathParamNames<R>] extends [never]
  ? { params?: undefined }
  : { params: Record<PathParamNames<R>, string> };

type RequestOptions<R extends string, Body> = ParamsFor<R> & {
  query?: Record<string, string>;
} & ([Body] extends [never] | [undefined | unknown]
    ? { body?: Body }
    : { body: Body });

export interface Client<
  Api extends VersionedApi<any, any>,
  Shapes extends Record<string, CurrentShape>,
  V extends KnownVersion<Api>,
> {
  request<R extends keyof ClientTypes<Api, V, Shapes> & string>(
    route: R,
    options?: RequestOptions<
      R,
      ClientTypes<Api, V, Shapes>[R] extends { request: infer B } ? B : never
    >,
  ): Promise<
    ClientTypes<Api, V, Shapes>[R] extends { response: infer Res } ? Res : unknown
  >;
}

/**
 * Curried so the Api/Shapes type parameters can be supplied while the pinned
 * version is inferred from the options literal.
 */
export function createClient<
  Api extends VersionedApi<any, any>,
  Shapes extends Record<string, CurrentShape> = {},
>() {
  return <const V extends KnownVersion<Api>>(
    options: ClientOptions<V>,
  ): Client<Api, Shapes, V> => {
    const doFetch = options.fetch ?? ((req: Request) => fetch(req));

    return {
      async request(route: string, requestOptions?: {
        params?: Record<string, string>;
        query?: Record<string, string>;
        body?: unknown;
      }) {
        const space = route.indexOf(" ");
        const method = route.slice(0, space);
        let path = route.slice(space + 1);
        for (const [name, value] of Object.entries(requestOptions?.params ?? {})) {
          path = path.replace(`:${name}`, encodeURIComponent(value));
        }
        if (path.includes(":")) {
          throw new Error(`Missing path params for ${route} — got ${path}`);
        }
        const url = new URL(path, options.baseUrl);
        for (const [key, value] of Object.entries(requestOptions?.query ?? {})) {
          url.searchParams.set(key, value);
        }

        const headers = new Headers(options.headers);
        headers.set("accept", "application/json");
        if (options.version && options.version !== "floor") {
          headers.set(options.versionHeader ?? HEADERS.version, options.version);
        }
        if (options.apiKey) headers.set(HEADERS.apiKey, options.apiKey);

        let body: string | undefined;
        if (requestOptions?.body !== undefined) {
          headers.set("content-type", "application/json");
          body = JSON.stringify(requestOptions.body);
        }

        const response = await doFetch(
          new Request(url.toString(), { method, headers, ...(body ? { body } : {}) }),
        );
        const data = response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : await response.text();
        if (!response.ok) {
          throw new VersionlessClientError(response.status, data, route);
        }
        return data as never;
      },
    } as Client<Api, Shapes, V>;
  };
}
