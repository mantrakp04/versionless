import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@versionless/env/vite";

export const Route = createFileRoute("/")({
  component: DemoPage,
});

/** Headers every simulated client sends — the dashboard groups by this key. */
const CONSUMER_KEY = "demo-browser";

interface ActionResult {
  label: string;
  status: number;
  ok: boolean;
  body: unknown;
  headers: Record<string, string>;
  durationMs: number;
}

interface Action {
  title: string;
  pin?: string;
  desc: string;
  run: (base: string) => Promise<Response>;
}

const SHOWN_HEADERS = ["deprecation", "sunset", "x-versionless-error"];

function api(
  base: string,
  path: string,
  init: RequestInit = {},
  version?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", CONSUMER_KEY);
  if (version) headers.set("x-api-version", version);
  return fetch(`${base}${path}`, { ...init, headers });
}

/** oRPC RPC protocol: POST <prefix>/<segment/path> with a `{"json": input}` envelope. */
function rpc(
  base: string,
  procedure: string,
  input: unknown,
  version?: string,
): Promise<Response> {
  return api(
    base,
    `rpc/${procedure.replaceAll(".", "/")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    },
    version,
  );
}

const ACTIONS: Action[] = [
  {
    title: "GET /users",
    desc: "Current client — firstName/lastName, the shape handlers speak.",
    run: (base) => api(base, "users"),
  },
  {
    title: "GET /users",
    pin: "x-api-version: 2025-01-01",
    desc: "Oldest cohort — served by the registered jump: merged name, plus Deprecation/Sunset headers.",
    run: (base) => api(base, "users", {}, "2025-01-01"),
  },
  {
    title: "GET /users/u_1",
    pin: "x-api-version: 2025-06-01",
    desc: "Pinned before the 2026-05-14 name split — response is down-transformed to { name }.",
    run: (base) => api(base, "users/u_1", {}, "2025-06-01"),
  },
  {
    title: "POST /users",
    pin: "x-api-version: 2025-06-01",
    desc: "Old request shape { name, email } — up-transformed before the handler validates.",
    run: (base) =>
      api(
        base,
        "users",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Barbara Liskov",
            email: `barbara+${Date.now().toString(36)}@demo.example.com`,
          }),
        },
        "2025-06-01",
      ),
  },
  {
    title: "GET /orgs/t_1",
    pin: "x-api-version: 2025-01-01",
    desc: "Rewrite: /orgs was renamed to /teams in 2025-06-01 — old pins still get an answer.",
    run: (base) => api(base, "orgs/t_1", {}, "2025-01-01"),
  },
  {
    title: "GET /orgs/t_1",
    desc: "Same path for a current client — 404, the old route no longer exists for them.",
    run: (base) => api(base, "orgs/t_1"),
  },
  {
    title: "oRPC demo.userList",
    pin: "x-api-version: 2025-06-01",
    desc: "Procedure-keyed transforms — the oRPC client interceptor downs each result.",
    run: (base) => rpc(base, "demo.userList", undefined, "2025-06-01"),
  },
  {
    title: "oRPC demo.userCreate",
    pin: "x-api-version: 2025-06-01",
    desc: "Old-shape input through oRPC — upped before .input() validation, response downed.",
    run: (base) =>
      rpc(
        base,
        "demo.userCreate",
        {
          name: "Annie Easley",
          email: `annie+${Date.now().toString(36)}@demo.example.com`,
        },
        "2025-06-01",
      ),
  },
  {
    title: "GET /users",
    pin: "x-api-version: not-a-date",
    desc: "Invalid pin — stable 400 { error: \"invalid_api_version\" }.",
    run: (base) => api(base, "users", {}, "not-a-date"),
  },
];

function DemoPage() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async (action: Action) => {
    setBusy(true);
    const started = performance.now();
    try {
      const base = env.BASE_URL; // "/demo/"
      const res = await action.run(base);
      const durationMs = Math.round(performance.now() - started);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => "");
      }
      const headers: Record<string, string> = {};
      for (const name of SHOWN_HEADERS) {
        const value = res.headers.get(name);
        if (value) headers[name] = value;
      }
      setResult({
        label: action.pin ? `${action.title} · ${action.pin}` : action.title,
        status: res.status,
        ok: res.ok,
        body,
        headers,
        durationMs,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>
        versionless <span>demo</span>
      </h1>
      <p className="lede">
        One API serving every version it ever shipped. Every button below is a
        real request against this app's own TanStack Start routes and oRPC
        procedures — handlers only speak the current shape; pinned clients get
        theirs from registered transforms. Telemetry from your clicks lands on
        the demo team's dashboard.
      </p>
      <div className="grid">
        <section>
          <h2>Simulate a client</h2>
          <div className="actions">
            {ACTIONS.map((action, i) => (
              <button
                key={i}
                className="action"
                disabled={busy}
                onClick={() => void runAction(action)}
              >
                <span className="title">{action.title}</span>
                {action.pin ? <span className="pin">{action.pin}</span> : null}
                <span className="desc">{action.desc}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>Wire response</h2>
          <div className="result">
            {result ? (
              <>
                <div className="status">
                  <span className={result.ok ? "ok" : "err"}>
                    {result.status}
                  </span>{" "}
                  {result.label} · {result.durationMs}ms
                </div>
                <pre>{JSON.stringify(result.body, null, 2)}</pre>
                {Object.keys(result.headers).length > 0 ? (
                  <div className="headers">
                    {Object.entries(result.headers).map(([name, value]) => (
                      <div key={name}>
                        <b>{name}</b>: {value}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="hint">
                Click an action to see the exact wire response that cohort of
                clients receives — body, status, and sunset headers.
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
