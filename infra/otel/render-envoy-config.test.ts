import { describe, expect, test } from "bun:test";
import { renderEnvoyConfig } from "./render-envoy-config";

const template = await Bun.file(
  new URL("./envoy.template.yaml", import.meta.url),
).text();

describe("renderEnvoyConfig", () => {
  test("renders the local Docker Compose topology", () => {
    const config = renderEnvoyConfig(template, "local");

    expect(config).toContain("uri: http://host.docker.internal:3000");
    expect(config).toContain("path_override: /internal/otlp/auth");
    expect(config).toContain("address: otel-collector");
    expect(config).not.toContain("versionless_auth_proxy");
    expect(config).not.toContain("transport_sockets.tls");
    expect(config).not.toContain("{{");
  });

  test("renders the Railway topology", () => {
    const config = renderEnvoyConfig(template, "railway");

    expect(config).toContain("uri: http://127.0.0.1:10000");
    expect(config).toContain("path_override: /api/internal/otlp/auth");
    expect(config).toContain("name: versionless_auth_proxy");
    expect(config).toContain("address: versionless.vercel.app");
    expect(config).toContain("address: otel-collector.railway.internal");
    expect(config).toContain("transport_sockets.tls");
    expect(config).not.toContain("{{");
  });

  test("rejects unresolved template values", () => {
    expect(() => renderEnvoyConfig("{{UNKNOWN}}", "local")).toThrow(
      "Unresolved Envoy template values: {{UNKNOWN}}",
    );
  });
});
