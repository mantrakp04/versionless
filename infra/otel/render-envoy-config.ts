export type EnvoyTarget = "local" | "railway";

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

const valuesByTarget: Record<EnvoyTarget, Record<string, string>> = {
  local: {
    AUTH_URI: "http://host.docker.internal:3000",
    AUTH_CLUSTER: "versionless_auth",
    AUTH_PATH: "/internal/otlp/auth",
    AUTH_PROXY_LISTENER: "",
    AUTH_PROXY_CLUSTER: "",
    AUTH_HOST: "host.docker.internal",
    AUTH_PORT: "3000",
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
};

export function renderEnvoyConfig(template: string, target: EnvoyTarget): string {
  const values = valuesByTarget[target];
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

async function main() {
  const args = Bun.argv.slice(2);
  const targetIndex = args.indexOf("--target");
  const outputIndex = args.indexOf("--output");
  const target = args[targetIndex + 1] as EnvoyTarget | undefined;
  const output = args[outputIndex + 1];

  if (!target || !(target in valuesByTarget) || !output) {
    throw new Error(
      "Usage: bun render-envoy-config.ts --target <local|railway> --output <path>",
    );
  }

  const template = await Bun.file(
    new URL("./envoy.template.yaml", import.meta.url),
  ).text();
  await Bun.write(output, renderEnvoyConfig(template, target));
}

if (import.meta.main) {
  await main();
}
