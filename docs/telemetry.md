---
id: telemetry
title: Telemetry
description: Monitor your ChadStart backend with OpenTelemetry. Send traces and metrics to any OTLP-compatible backend like Grafana, Datadog, or Jaeger.
---

# Telemetry

ChadStart includes built-in observability via **OpenTelemetry** (OTel). Enable it to export distributed traces to any OTLP-compatible collector such as [Grafana Tempo](https://grafana.com/oss/tempo/), [Datadog](https://www.datadoghq.com/), [Jaeger](https://www.jaegertracing.io/), or [Honeycomb](https://www.honeycomb.io/).

## Configuration

Add a `telemetry` block to your `chadstart.yaml`:

```yaml title="chadstart.yaml"
telemetry:
  enabled: true
  serviceName: my-app
  endpoint: http://localhost:4318
```

| Option          | Default                    | Description                                               |
| --------------- | -------------------------- | --------------------------------------------------------- |
| **enabled**     | `false`                    | Set to `true` to activate OpenTelemetry tracing           |
| **serviceName** | `chadstart-app`            | The service name reported to your collector               |
| **endpoint**    | `http://localhost:4318`    | Base URL of your OTLP collector (HTTP protocol)           |

!!! warning "Auth headers are secrets"
    If your collector requires an API key or bearer token, **never** put it in `chadstart.yaml`. Use the `OTEL_EXPORTER_OTLP_HEADERS` environment variable instead (see below).

## Environment variables

All telemetry options can be set (or overridden) via environment variables. Environment variables always take precedence over YAML values.

| Variable                        | Description                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `OTEL_ENABLED=true`             | Enable tracing (overrides `telemetry.enabled`)                                           |
| `OTEL_SERVICE_NAME`             | Service name sent to the collector (overrides `telemetry.serviceName`)                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | Collector base URL (overrides `telemetry.endpoint`)                                      |
| `OTEL_EXPORTER_OTLP_HEADERS`    | Comma-separated `key=value` auth headers, e.g. `authorization=Bearer <token>` **(secrets — env only)** |

Add these to your `.env` file:

```bash title=".env"
OTEL_ENABLED=true
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer my-secret-token
```

## Example: Grafana Cloud

1. Create a free account at [grafana.com](https://grafana.com/auth/sign-up).
2. Go to **My Account → Grafana Cloud → OpenTelemetry**.
3. Copy your OTLP endpoint and instance token.
4. Add the following to your `.env`:

```bash title=".env"
OTEL_ENABLED=true
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic <base64-encoded-token>
```

## Example: Datadog

```bash title=".env"
OTEL_ENABLED=true
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com
OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=<your-datadog-api-key>
```

## Local development with Jaeger

Run a local [Jaeger](https://www.jaegertracing.io/) instance with Docker to visualise traces during development:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then in your `chadstart.yaml`:

```yaml title="chadstart.yaml"
telemetry:
  enabled: true
  serviceName: my-app
  endpoint: http://localhost:4318
```

Open [http://localhost:16686](http://localhost:16686) to explore traces.

!!! note
    Telemetry uses the OTLP **HTTP** protocol on port `4318` (not the gRPC port `4317`). Make sure your collector is configured to accept HTTP.
