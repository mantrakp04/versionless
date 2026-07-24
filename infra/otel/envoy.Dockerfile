FROM oven/bun:1.3.14 AS config

WORKDIR /src
COPY infra/otel/envoy.template.yaml infra/otel/render-envoy-config.ts ./

ARG ENVOY_TARGET=railway
RUN bun render-envoy-config.ts --target "${ENVOY_TARGET}" --output /tmp/envoy.yaml

FROM envoyproxy/envoy:v1.38.3

COPY --from=config /tmp/envoy.yaml /etc/envoy/envoy.yaml

RUN envoy --mode validate -c /etc/envoy/envoy.yaml

CMD ["envoy", "-c", "/etc/envoy/envoy.yaml"]
