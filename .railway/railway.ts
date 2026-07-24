import {
  defineRailway,
  github,
  image,
  postgres,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres");
  const clickhouseServerVolume = volume("clickhouse-server-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "us-west2",
    sizeMB: 5000,
  });
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "us-west2",
    sizeMB: 5000,
  });
  const clickhouseServer = service("clickhouse-server", {
    source: image("clickhouse/clickhouse-server:26.3-alpine"),
    replicas: { "us-west2": 1 },
    volumeMounts: {
      "/var/lib/clickhouse": clickhouseServerVolume,
    },
    env: {
      CLICKHOUSE_DB: preserve(),
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: preserve(),
      CLICKHOUSE_PASSWORD: preserve(),
      CLICKHOUSE_USER: preserve(),
      CLICKHOUSE_URL:
        "http://${{CLICKHOUSE_USER}}:${{CLICKHOUSE_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:8123/${{CLICKHOUSE_DB}}",
      CLICKHOUSE_NATIVE_ENDPOINT:
        "tcp://${{RAILWAY_PRIVATE_DOMAIN}}:9000",
    },
  });
  const otelCollector = service("otel-collector", {
    source: github("mantrakp04/versionless", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "infra/otel/collector.Dockerfile",
      watchPatterns: [
        "/infra/otel/collector.Dockerfile",
        "/infra/otel/collector.yaml",
      ],
    },
    healthcheck: "/",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    env: {
      PORT: "13133",
      CLICKHOUSE_ENDPOINT: clickhouseServer.env.CLICKHOUSE_NATIVE_ENDPOINT,
      CLICKHOUSE_USER: clickhouseServer.env.CLICKHOUSE_USER,
      CLICKHOUSE_PASSWORD: clickhouseServer.env.CLICKHOUSE_PASSWORD,
      CLICKHOUSE_DATABASE: clickhouseServer.env.CLICKHOUSE_DB,
    },
  });
  const otelGateway = service("otel-gateway", {
    source: github("mantrakp04/versionless", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "infra/otel/envoy.Dockerfile",
      watchPatterns: [
        "/infra/otel/envoy.Dockerfile",
        "/infra/otel/envoy.template.yaml",
        "/infra/otel/render-envoy-config.ts",
      ],
    },
    healthcheck: "/healthz",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    tcp: [4317],
    env: {
      PORT: "4318",
    },
  });

  return project("versionless", {
    resources: [
      Postgres,
      clickhouseServer,
      clickhouseServerVolume,
      postgresVolume,
      otelCollector,
      otelGateway,
    ],
  });
});
