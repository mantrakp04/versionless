import {
  defineRailway,
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
    },
  });

  return project("versionless", {
    resources: [Postgres, clickhouseServer, clickhouseServerVolume, postgresVolume],
  });
});
