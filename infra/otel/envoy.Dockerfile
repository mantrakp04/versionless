FROM oven/bun:1.3.14 AS config

WORKDIR /src
COPY infra/otel/envoy.template.yaml infra/otel/render-envoy-config.ts ./

ARG ENVOY_TARGET=railway
# Local only: the host port apps/server listens on, which follows PORT_PREFIX.
ARG AUTH_PORT=3000
RUN bun render-envoy-config.ts \
      --target "${ENVOY_TARGET}" \
      --auth-port "${AUTH_PORT}" \
      --output /tmp/envoy.yaml

FROM envoyproxy/envoy:v1.38.3

COPY --from=config /tmp/envoy.yaml /etc/envoy/envoy.yaml

RUN envoy --mode validate -c /etc/envoy/envoy.yaml

CMD ["envoy", "-c", "/etc/envoy/envoy.yaml"]
