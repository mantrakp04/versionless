export type EnvoyTarget = "local" | "railway";

/**
 * apps/server's default host port. Duplicated from packages/env/src/ports.ts
 * (`PORT_PREFIX` 30 + offset 00) because the Docker build context copies only
 * this file and the template — docker-compose passes the real value through
 * the AUTH_PORT build arg whenever the prefix moves.
 */
const DEFAULT_LOCAL_AUTH_PORT = "3000";

const railwayProxyListener = `    - name: versionless_auth_proxy
      address:
        socket_address: { address: 127.0.0.1, port_value: 10000 }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: versionless_auth_proxy
                codec_type: AUTO
                route_config:
                  name: versionless_auth_proxy
                  virtual_hosts:
                    - name: versionless
                      domains: ["*"]
                      routes:
                        - match: { prefix: "/" }
                          route:
                            cluster: versionless_auth
                            host_rewrite_literal: versionless.vercel.app
                            timeout: 2s
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router`;

const railwayProxyCluster = `    - name: versionless_auth_proxy
      connect_timeout: 1s
      type: STATIC
      load_assignment:
        cluster_name: versionless_auth_proxy
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: 127.0.0.1
                      port_value: 10000
`;

const railwayTls = `      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: versionless.vercel.app`;

export interface RenderEnvoyConfigOptions {
  /**
   * Host port apps/server listens on. Local only — the Railway topology
   * authorizes against the public Vercel origin over TLS.
   */
  authPort?: string;
}

const valuesByTarget = (
  authPort: string,
): Record<EnvoyTarget, Record<string, string>> => ({
  local: {
    AUTH_URI: `http://host.docker.internal:${authPort}`,
    AUTH_CLUSTER: "versionless_auth",
    AUTH_PATH: "/internal/otlp/auth",
    AUTH_PROXY_LISTENER: "",
    AUTH_PROXY_CLUSTER: "",
    AUTH_HOST: "host.docker.internal",
    AUTH_PORT: authPort,
    AUTH_TLS: "",
    COLLECTOR_HOST: "otel-collector",
  },
  railway: {
    AUTH_URI: "http://127.0.0.1:10000",
    AUTH_CLUSTER: "versionless_auth_proxy",
    AUTH_PATH: "/api/internal/otlp/auth",
    AUTH_PROXY_LISTENER: railwayProxyListener,
    AUTH_PROXY_CLUSTER: railwayProxyCluster,
    AUTH_HOST: "versionless.vercel.app",
    AUTH_PORT: "443",
    AUTH_TLS: railwayTls,
    COLLECTOR_HOST: "otel-collector.railway.internal",
  },
});

export function renderEnvoyConfig(
  template: string,
  target: EnvoyTarget,
  { authPort = DEFAULT_LOCAL_AUTH_PORT }: RenderEnvoyConfigOptions = {},
): string {
  const values = valuesByTarget(authPort)[target];
  let rendered = template;

  for (const [key, value] of Object.entries(values)) {
    const token = `{{${key}}}`;
    rendered = value
      ? rendered.replaceAll(token, value)
      : rendered.replaceAll(`${token}\n`, "").replaceAll(token, "");
  }

  const unresolved = rendered.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unresolved Envoy template values: ${unresolved.join(", ")}`);
  }

  return `${rendered.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

const targets: EnvoyTarget[] = ["local", "railway"];

async function main() {
  const args = Bun.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const target = flag("--target") as EnvoyTarget | undefined;
  const output = flag("--output");
  const authPort = flag("--auth-port");

  if (!target || !targets.includes(target) || !output) {
    throw new Error(
      "Usage: bun render-envoy-config.ts --target <local|railway> --output <path> [--auth-port <port>]",
    );
  }

  const template = await Bun.file(
    new URL("./envoy.template.yaml", import.meta.url),
  ).text();
  await Bun.write(output, renderEnvoyConfig(template, target, { authPort }));
}

if (import.meta.main) {
  await main();
}
