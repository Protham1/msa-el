# TraceFlow API — Next One-Hour Implementation Plan

> Issue-ready engineering plan for teammates. This document covers the next implementation phase only: build the backend-for-frontend TraceFlow API.

## Goal

Build a small Go API on port `8090` that:

- Queries real traces from Jaeger
- Normalizes Jaeger responses into stable frontend DTOs
- Exposes overview, service, trace, dependency, checkout, and simulator endpoints
- Allows the React dashboard to trigger the existing demo checkout flow
- Preserves real trace data and never fabricates telemetry

The dashboard frontend is out of scope for this issue.

---

## Current implementation status

The first implementation phase is complete.

### Implemented

- Five Go microservices:
  - Gateway on port `8080`
  - Auth on port `8081`
  - Order on port `8082`
  - Payment on port `8083`
  - Inventory on port `8084`
- `GET /health` on all five services
- JSON HTTP responses
- OpenTelemetry OTLP HTTP trace export
- W3C Trace Context propagation
- Gateway -> Auth -> Order checkout flow
- Concurrent Order calls to Payment and Inventory
- Payment delay configuration
- Payment failure simulation
- Inventory delay configuration
- Individual Payment and Inventory `/config` endpoints
- Five-service distributed traces in Jaeger
- Jaeger UI and OTLP receiver on:
  - UI and query API: `http://localhost:16686`
  - OTLP HTTP receiver: `http://localhost:4318`

### Reference

- Architecture and demo instructions: [Readme.md](Readme.md)
- API and frontend requirements: [features.md](features.md)
- Existing services:
  - [services/gateway/main.go](services/gateway/main.go)
  - [services/auth-service/main.go](services/auth-service/main.go)
  - [services/order-service/main.go](services/order-service/main.go)
  - [services/payment-service/main.go](services/payment-service/main.go)
  - [services/inventory-service/main.go](services/inventory-service/main.go)

---

## Deliverables

Create `services/traceflow-api/` with:

```text
services/traceflow-api/
├── main.go
├── go.mod
├── handlers/
│   ├── health.go
│   ├── overview.go
│   ├── traces.go
│   ├── services.go
│   ├── dependencies.go
│   └── demo.go
├── jaeger/
│   ├── client.go
│   └── mapper.go
└── models/
    └── models.go
```

Do not create unused files or broad abstractions. Keep the API understandable for a student demo.

---

## Environment variables

Use these defaults for local development:

```env
TRACEFLOW_API_PORT=8090
JAEGER_QUERY_URL=http://localhost:16686
GATEWAY_URL=http://localhost:8080
PAYMENT_SERVICE_URL=http://localhost:8083
INVENTORY_SERVICE_URL=http://localhost:8084
OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4318
```

Inside Docker Compose, the corresponding URLs must use service names:

```env
JAEGER_QUERY_URL=http://jaeger:16686
GATEWAY_URL=http://gateway:8080
PAYMENT_SERVICE_URL=http://payment-service:8083
INVENTORY_SERVICE_URL=http://inventory-service:8084
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
```

---

## API contract

Implement these endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | `GET` | API health and Jaeger reachability |
| `/api/overview` | `GET` | Summary cards and recent traces |
| `/api/services` | `GET` | Services observed by Jaeger |
| `/api/traces` | `GET` | Recent trace summaries with filters |
| `/api/traces/{traceID}` | `GET` | One normalized trace with spans |
| `/api/dependencies` | `GET` | Static or telemetry-derived dependency graph |
| `/api/demo/checkout` | `POST` | Trigger Gateway checkout |
| `/api/demo/config` | `GET` | Read Payment and Inventory configuration |
| `/api/demo/config` | `PUT` | Update Payment and Inventory configuration |

Suggested query parameters:

```text
GET /api/traces?limit=20&service=gateway&tags=
```

---

## Minute-by-minute plan

### 0-10 minutes: Confirm Jaeger 2.23 endpoints

1. Start or verify Jaeger.
2. Verify the running API with curl:

   ```powershell
   curl.exe -s http://localhost:16686/api/services
   curl.exe -s "http://localhost:16686/api/traces?service=gateway&limit=20"
   ```

3. If the running Jaeger image uses a different API route, use the routes returned by that instance rather than guessing.
4. Trigger at least one checkout before querying traces:

   ```powershell
   curl.exe -X POST http://localhost:8080/checkout
   ```

5. Inspect one raw service response and one raw trace response.

**Required evidence:** Save or document the actual endpoint paths and top-level JSON fields before implementing the mapper.

**Checkpoint:** A service list and a trace response are both reachable through the running Jaeger instance.

---

### 10-20 minutes: Create the API module

Create `services/traceflow-api/go.mod` and `main.go`.

The API should:

- Listen on port `8090`
- Register all `/api/*` routes
- Set JSON content type
- Add a short Jaeger HTTP client timeout, such as 5 seconds
- Read `JAEGER_QUERY_URL`, `GATEWAY_URL`, `PAYMENT_SERVICE_URL`, and `INVENTORY_SERVICE_URL`
- Return JSON for success and error responses
- Support CORS if the dashboard is served from a separate Vite origin

Add a basic health endpoint:

```json
{
  "status": "ok",
  "service": "traceflow-api",
  "jaegerReachable": true
}
```

`jaegerReachable` must be based on an actual Jaeger request, not a hardcoded value.

**Checkpoint:** `GET /api/health` is reachable on port `8090`.

---

### 20-35 minutes: Implement the Jaeger client and trace mapper

Add a small Jaeger client in `jaeger/client.go`.

The client should isolate:

- Base URL configuration
- HTTP requests
- Short request timeouts
- Raw response decoding
- Clear `502` or `503` errors

Add mapping logic in `jaeger/mapper.go`.

Do not expose raw Jaeger structs directly to React.

### Trace summary DTO

```json
{
  "traceId": "string",
  "rootOperation": "string",
  "rootService": "string",
  "startTime": "ISO-8601 string",
  "durationMs": 0,
  "spanCount": 0,
  "serviceNames": ["gateway"],
  "hasError": false
}
```

### Trace detail DTO

```json
{
  "traceId": "string",
  "durationMs": 0,
  "startTime": "ISO-8601 string",
  "spans": []
}
```

### Span DTO

```json
{
  "spanId": "string",
  "parentSpanId": "string",
  "serviceName": "gateway",
  "operationName": "checkout.process",
  "startTimeUnixNano": "string",
  "durationMs": 0,
  "status": "ok",
  "attributes": {},
  "events": []
}
```

Mapper rules:

- Determine the root span by checking for an absent or unknown parent span ID
- Do not assume the span array is in execution order
- Sort spans by start time only for presentation
- Convert Jaeger microseconds or nanoseconds carefully using the actual raw response fields
- Convert error status from real tags/status data
- Preserve available attributes and events
- Return explicit unavailable values where a field cannot be derived

**Checkpoint:** `/api/traces` and `/api/traces/{traceID}` return application-owned JSON without raw Jaeger payloads.

---

### 35-42 minutes: Implement overview and services

### `GET /api/services`

Return service names observed by Jaeger.

If Jaeger is unavailable, return a clear `502` or `503` JSON error.

If no services exist, return an empty list and an empty-state-compatible response.

### `GET /api/overview`

Derive only values that Jaeger supports:

- Trace count
- Average duration
- Error count or error rate
- Number of observed services
- Recent trace summaries

Do not invent metrics.

If a value cannot be derived, return `null` or an explicit unavailable field.

**Checkpoint:** Overview and services endpoints return valid JSON for both successful and empty Jaeger results.

---

### 42-50 minutes: Implement dependencies and demo checkout

### `GET /api/dependencies`

For the first pass:

- Return the known demo topology
- Mark the result as static demo topology
- Do not claim the topology was discovered from Jaeger unless parent/child data has been used to derive edges

Known nodes:

```text
gateway -> auth-service -> order-service
order-service -> payment-service
order-service -> inventory-service
```

### `POST /api/demo/checkout`

Call:

```text
POST {GATEWAY_URL}/checkout
```

Return:

- Gateway HTTP status
- Success or failure
- Message
- Gateway response body
- Trace ID only if one can be determined

Do not generate a fake trace ID.

Use a short HTTP timeout and close response bodies.

**Checkpoint:** Calling the API checkout endpoint triggers a real five-service checkout and refreshes Jaeger data.

---

### 50-55 minutes: Implement simulator configuration

### `GET /api/demo/config`

Read:

- Payment configuration from `GET {PAYMENT_SERVICE_URL}/config`
- Inventory configuration from `GET {INVENTORY_SERVICE_URL}/config`

### `PUT /api/demo/config`

Accept Payment and Inventory values:

```json
{
  "payment": {
    "delayMs": 3000,
    "failure": false
  },
  "inventory": {
    "delayMs": 500
  }
}
```

Forward updates with:

- `POST {PAYMENT_SERVICE_URL}/config`
- `POST {INVENTORY_SERVICE_URL}/config`

Validate:

- Payment delay: `0`, `500`, `1500`, or `3000`
- Payment failure: boolean
- Inventory delay: `0`, `500`, or `1500`

Return `400` for invalid values and `502` if a demo service is unavailable.

**Checkpoint:** Dashboard-style API calls can change Payment delay/failure and Inventory delay.

---

### 55-60 minutes: End-to-end verification

Start the stack:

1. Start Jaeger
2. Start Inventory
3. Start Payment
4. Start Order
5. Start Auth
6. Start Gateway
7. Start TraceFlow API

Run these checks:

```powershell
curl.exe -s http://localhost:8090/api/health
curl.exe -s http://localhost:8090/api/services
curl.exe -s http://localhost:8090/api/traces?limit=20
curl.exe -X POST -H "Content-Type: application/json" `
  -d "{\"payment\":{\"delayMs\":3000,\"failure\":false},\"inventory\":{\"delayMs\":0}}" `
  http://localhost:8090/api/demo/config
curl.exe -X POST http://localhost:8090/api/demo/checkout
curl.exe -s http://localhost:8090/api/traces?limit=20
```

Then test failure:

```powershell
curl.exe -X POST -H "Content-Type: application/json" `
  -d "{\"payment\":{\"delayMs\":0,\"failure\":true},\"inventory\":{\"delayMs\":0}}" `
  http://localhost:8090/api/demo/config
curl.exe -X POST http://localhost:8090/api/demo/checkout
```

**Final checkpoint:** A single TraceFlow API call triggers a real checkout, and trace list/detail responses can represent its delay and failure.

---

## Testing checklist

- [ ] API starts on port `8090`
- [ ] API health endpoint responds
- [ ] API detects Jaeger availability
- [ ] Jaeger query endpoints match the running Jaeger 2.23 instance
- [ ] `/api/services` returns real services
- [ ] `/api/traces` returns real trace summaries
- [ ] `/api/traces/{traceID}` returns normalized spans
- [ ] Root span and parent span IDs are mapped correctly
- [ ] Error spans are identified from real trace data
- [ ] Trace list handles an empty Jaeger database
- [ ] Jaeger outage returns a clear `502` or `503`
- [ ] Overview does not fabricate unavailable metrics
- [ ] Dependencies endpoint clearly identifies static demo topology
- [ ] Demo checkout calls Gateway
- [ ] Demo checkout propagates success and failure status
- [ ] Payment delay can be updated through the API
- [ ] Payment failure can be enabled through the API
- [ ] Inventory delay can be updated through the API
- [ ] Invalid config values return `400`
- [ ] Unavailable demo services return `502`

---

## Deferred work

Do not include these in this issue:

- React dashboard
- React Flow topology
- Trace waterfall UI
- Bottleneck insight UI
- Docker Compose
- Prometheus
- Authentication
- Database
- Raw trace JSON UI
- Dark/light theme
- Auto-refresh
- Latency charts

These can begin only after the API contract is stable and verified.

---

## Definition of done

This phase is complete when a teammate can:

1. Start Jaeger and all five existing microservices.
2. Start the TraceFlow API on port `8090`.
3. Fetch real services and traces from Jaeger through the API.
4. Fetch a single trace with normalized span data.
5. Trigger a checkout through `POST /api/demo/checkout`.
6. Change Payment delay/failure and Inventory delay through `/api/demo/config`.
7. Verify that normal, delayed, and failed checkouts are visible through API trace responses.
