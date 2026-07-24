FROM otel/opentelemetry-collector-contrib:0.153.0

COPY infra/otel/collector.yaml /etc/otelcol-contrib/config.yaml

ENTRYPOINT ["/otelcol-contrib"]
CMD ["--config=/etc/otelcol-contrib/config.yaml"]
