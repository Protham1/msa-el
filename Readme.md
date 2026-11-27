# TraceFlow

A distributed tracing demonstration built with Go microservices, OpenTelemetry, and Jaeger. TraceFlow simulates a real-world e-commerce checkout flow across five independently running services, making the invisible journey of a single request visible through distributed traces.

---

## Why Distributed Tracing?

In a monolithic application, debugging is straightforward — you read one log file, set one breakpoint, and follow one call stack. But the moment you split your application into microservices, a single user action (like clicking "Checkout") triggers a chain of HTTP calls across multiple independent processes, each with its own logs, its own errors, and its own latency.

**The core problem:** When a checkout request takes 5 seconds instead of 200ms, which service caused the delay? When an order fails, did the payment service reject it, or did the inventory service time out? Traditional logging can't answer these questions easily because each service only sees its own piece of the puzzle.

### What is a Trace?

A **trace** represents the complete lifecycle of a single request as it travels through your distributed system. Think of it as a unique receipt that follows your request everywhere it goes.

```
One checkout request = One trace
```

Each trace is identified by a globally unique **Trace ID** (e.g., `4bf92f3577b34da6a3ce929d0e0e4736`). Every service that handles this request tags its work with this same ID, creating a connected story across service boundaries.

### What is a Span?

A **span** represents a single unit of work within a trace. Each service creates one or more spans to describe what it did and how long it took.

```
Trace (checkout request)
├── Span: gateway.server         [0ms ─────────────────────── 350ms]
│   └── Span: checkout.process   [2ms ────────────────────── 348ms]
│       ├── Span: auth.server    [10ms ──── 115ms]
│       │   └── Span: auth.validate [12ms ── 112ms]  (100ms simulated delay)
│       └── Span: order.server   [120ms ─────────────────── 345ms]
│           └── Span: order.process [122ms ──────────────── 343ms]
│               ├── Span: payment.server   [125ms ──── 230ms]  ← concurrent
│               │   └── Span: payment.charge [127ms ── 228ms]
│               └── Span: inventory.server [125ms ── 180ms]    ← concurrent
│                   └── Span: inventory.check [127ms ── 178ms]
```

Each span records:
- **Operation name** — what work was performed (`checkout.process`, `payment.charge`)
- **Start time and duration** — exactly when it started and how long it took
- **Parent span ID** — which span triggered this one (forming the hierarchy)
- **Status** — success or error
- **Attributes and events** — additional metadata and error details

### Context Propagation (W3C Trace Context)

The magic that connects spans across services is **context propagation**. When Gateway calls Auth, it doesn't just send the business request — it also injects a special HTTP header called `traceparent`:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              ──  ────────────── trace id ──────────────  ── parent ──  flags
```

The receiving service (Auth) extracts this header, learns the trace ID and the calling span's ID, and creates its own span as a **child** of the caller. This is how a single trace connects work across five independently running processes — they all share the same trace ID, passed through HTTP headers.

This project uses the **W3C Trace Context** standard, which is the industry-standard propagation format supported by OpenTelemetry, Jaeger, Zipkin, Datadog, and most modern observability platforms.

### Why Not Just Use Logs?

| Capability | Logs | Distributed Tracing |
|---|---|---|
| See what one service did | ✅ | ✅ |
| Correlate across services | ❌ Manual grep | ✅ Automatic via Trace ID |
| See request duration breakdown | ❌ Timestamps only | ✅ Waterfall visualization |
| Identify the slowest service | ❌ Guesswork | ✅ Span duration comparison |
| Detect concurrent vs sequential calls | ❌ | ✅ Visual overlap in timeline |
| Find the root cause of failures | ❌ Check every log | ✅ Error span with full call path |

---

## Architecture

### Request Flow

A single checkout request travels through all five services:

```
Client (curl / browser)
  │
  ▼
┌─────────────────────────────┐
│  Gateway Service (:8080)    │  Entry point — orchestrates the checkout
│  POST /checkout             │
└─────────┬───────────────────┘
          │  POST /validate
          ▼
┌─────────────────────────────┐
│  Auth Service (:8081)       │  Validates the request (simulated)
│  POST /validate             │
└─────────┬───────────────────┘
          │  POST /orders
          ▼
┌─────────────────────────────┐
│  Order Service (:8082)      │  Orchestrates payment + inventory
│  POST /orders               │
└─────────┬──────────┬────────┘
          │          │
          ▼          ▼         ← concurrent goroutines
┌──────────────┐ ┌──────────────┐
│ Payment      │ │ Inventory    │
│ Service      │ │ Service      │
│ (:8083)      │ │ (:8084)      │
│ POST /charge │ │ POST /check  │
└──────────────┘ └──────────────┘
```

**Key design decisions:**
- Gateway calls Auth **then** Order (sequential — auth must pass before ordering)
- Order calls Payment and Inventory **concurrently** (using Go goroutines — both are independent)
- Total checkout duration ≈ Auth time + max(Payment time, Inventory time), not the sum of all services

### Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Microservices | Go + `net/http` | Five independent HTTP services |
| Instrumentation | OpenTelemetry Go SDK | Create spans, propagate context |
| HTTP Instrumentation | `otelhttp` | Automatic span creation for HTTP handlers and clients |
| Trace Export | OTLP over HTTP | Send spans to Jaeger via port 4318 |
| Trace Backend | Jaeger (all-in-one) | Collect, store, and query traces |
| Propagation | W3C Trace Context | `traceparent` header across service boundaries |

### Project Structure

```
msa-el/
├── services/
│   ├── gateway/              # Port 8080 — Entry point
│   │   ├── main.go           # HTTP handlers: /checkout, /health
│   │   ├── tracing.go        # OpenTelemetry tracer initialization
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── auth-service/         # Port 8081 — Auth validation
│   │   ├── main.go           # HTTP handlers: /validate, /health
│   │   ├── tracing.go        # OpenTelemetry tracer initialization
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── order-service/        # Port 8082 — Order orchestration
│   │   ├── main.go           # HTTP handlers: /orders, /health
│   │   ├── tracing.go        # OpenTelemetry tracer initialization
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── payment-service/      # Port 8083 — Payment processing
│   │   ├── main.go           # HTTP handlers: /charge, /config, /health
│   │   ├── tracing.go        # OpenTelemetry tracer initialization
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── inventory-service/    # Port 8084 — Inventory check
│   │   ├── main.go           # HTTP handlers: /check, /config, /health
│   │   ├── tracing.go        # OpenTelemetry tracer initialization
│   │   ├── go.mod
│   │   └── go.sum
│
│   └── traceflow-api/         # Port 8090 — Dashboard backend-for-frontend
│       ├── main.go
│       ├── handlers/
│       ├── jaeger/
│       ├── models/
│       ├── tracing.go
│       ├── go.mod
│       └── go.sum
│
├── features.md               # Full feature specification
├── api_guide.md               # TraceFlow API scope and verification record
└── Readme.md                 # This file
```

---

## Services

### Gateway (`:8080`)

The single entry point for checkout requests. It calls Auth first, and if authentication passes, forwards the request to Order.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/checkout` | POST | Full checkout flow: Auth → Order |

**Environment variables:**
| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `localhost:4318` | Jaeger OTLP receiver |
| `AUTH_SERVICE_URL` | `http://localhost:8081` | Auth service base URL |
| `ORDER_SERVICE_URL` | `http://localhost:8082` | Order service base URL |

### Auth Service (`:8081`)

Simulates request authentication with a 100ms processing delay.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/validate` | POST | Validate request (simulated — always succeeds) |

### Order Service (`:8082`)

Orchestrates downstream calls to Payment and Inventory **concurrently** using goroutines. Both calls receive the same parent trace context, so they appear as sibling spans in the trace.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/orders` | POST | Process order: calls Payment + Inventory concurrently |

**Environment variables:**
| Variable | Default | Description |
|---|---|---|
| `PAYMENT_SERVICE_URL` | `http://localhost:8083` | Payment service base URL |
| `INVENTORY_SERVICE_URL` | `http://localhost:8084` | Inventory service base URL |

### Payment Service (`:8083`)

Simulates payment processing with **configurable delay and failure** — this is what makes traces interesting to explore.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/charge` | POST | Process payment (affected by delay/failure settings) |
| `/config` | GET | Read current delay and failure settings |
| `/config` | POST | Update delay and failure settings |

**Configuration (env vars or `/config` endpoint):**
| Variable | Default | Description |
|---|---|---|
| `PAYMENT_DELAY_MS` | `0` | Simulated processing delay in milliseconds |
| `PAYMENT_FAILURE` | `false` | When `true`, returns HTTP 500 with error span |

### Inventory Service (`:8084`)

Simulates an inventory availability check with configurable delay.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/check` | POST | Check inventory (always returns in-stock) |
| `/config` | GET | Read current delay setting |
| `/config` | POST | Update delay setting |

**Configuration:**
| Variable | Default | Description |
|---|---|---|
| `INVENTORY_DELAY_MS` | `0` | Simulated processing delay in milliseconds |

---

## How to Run

### Prerequisites

- **Go 1.21+** installed ([download](https://go.dev/dl/))
- **Docker** installed and running ([download](https://www.docker.com/products/docker-desktop/))

### Step 1: Start Jaeger

Jaeger is the trace backend that receives, stores, and lets you visualize traces.

```powershell
docker run --rm -d --name jaeger `
  -p 16686:16686 `
  -p 4318:4318 `
  jaegertracing/all-in-one:latest
```

Verify Jaeger is running:

```powershell
curl.exe http://localhost:16686/api/v3/services
# Expected: {"services":["jaeger"]}
```

You can also open the Jaeger UI at [http://localhost:16686](http://localhost:16686).

### Step 2: Build all services

Open a terminal in the project root and build each service:

```powershell
# Build all five services
Set-Location services\gateway;           go build -o gateway.exe .;           Set-Location ..\..
Set-Location services\auth-service;      go build -o auth-service.exe .;      Set-Location ..\..
Set-Location services\order-service;     go build -o order-service.exe .;     Set-Location ..\..
Set-Location services\payment-service;   go build -o payment-service.exe .;   Set-Location ..\..
Set-Location services\inventory-service; go build -o inventory-service.exe .; Set-Location ..\..
```

### Step 3: Start all services

Open **five separate terminals** (one per service) from the project root:

**Terminal 1 — Inventory (`:8084`):**
```powershell
cd services\inventory-service
.\inventory-service.exe
```

**Terminal 2 — Payment (`:8083`):**
```powershell
cd services\payment-service
.\payment-service.exe
```

**Terminal 3 — Order (`:8082`):**
```powershell
cd services\order-service
.\order-service.exe
```

**Terminal 4 — Auth (`:8081`):**
```powershell
cd services\auth-service
.\auth-service.exe
```

**Terminal 5 — Gateway (`:8080`):**
```powershell
cd services\gateway
.\gateway.exe
```

### Step 4: Verify all services are healthy

```powershell
curl.exe -s http://localhost:8080/health  # Gateway
curl.exe -s http://localhost:8081/health  # Auth
curl.exe -s http://localhost:8082/health  # Order
curl.exe -s http://localhost:8083/health  # Payment
curl.exe -s http://localhost:8084/health  # Inventory
```

Each should return `{"service":"<name>","status":"ok"}`.

---

## Demo Walkthrough

### 1. Normal Checkout

Send a checkout request through the full pipeline:

```powershell
curl.exe -s -X POST http://localhost:8080/checkout
```

Expected response:
```json
{
  "status": "success",
  "message": "checkout completed",
  "order": {
    "status": "confirmed",
    "orderId": "ORD-1795757087225",
    "payment": { "status": "charged" },
    "inventory": { "status": "reserved" }
  }
}
```

**View the trace in Jaeger:**
1. Open [http://localhost:16686](http://localhost:16686)
2. Select **gateway** from the Service dropdown
3. Click **Find Traces**
4. Click the trace — you'll see a waterfall showing all 5 services
5. Notice that Payment and Inventory spans **overlap** (concurrent execution)

### 2. Delayed Payment (Bottleneck Detection)

Add a 3-second delay to the Payment service:

```powershell
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"delayMs\":3000}" http://localhost:8083/config
```

Run another checkout:

```powershell
curl.exe -s -X POST http://localhost:8080/checkout
```

**What to observe in Jaeger:**
- The total trace duration is now ~3.2 seconds instead of ~200ms
- The Payment span is clearly the longest — it's the **bottleneck**
- Inventory still completes in ~50ms but the trace waits for Payment
- This is exactly how you identify performance issues in production

### 3. Payment Failure (Error Propagation)

Enable payment failure and reset the delay:

```powershell
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"delayMs\":0,\"failure\":true}" http://localhost:8083/config
```

Run another checkout:

```powershell
curl.exe -s -X POST http://localhost:8080/checkout
```

Expected response:
```json
{
  "error": "payment_failed",
  "message": "payment processing failed (simulated)"
}
```

**What to observe in Jaeger:**
- The Payment span is marked with an **error status** (red)
- The error includes a recorded exception event
- The Order and Gateway spans also reflect the failure
- You can trace exactly which service caused the checkout to fail

### 4. Reset to Normal

```powershell
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"delayMs\":0,\"failure\":false}" http://localhost:8083/config
```

---

## How OpenTelemetry is Configured

Each service follows the same instrumentation pattern:

### 1. Tracer Initialization (`tracing.go`)

```go
exporter, _ := otlptracehttp.New(ctx,
    otlptracehttp.WithEndpoint("localhost:4318"),  // Jaeger OTLP receiver
    otlptracehttp.WithInsecure(),
)

tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exporter),                // Batch spans before sending
    sdktrace.WithResource(resource.NewWithAttributes(
        "", attribute.String("service.name", "gateway"),  // Identify this service
    )),
)
```

### 2. HTTP Server Instrumentation (`main.go`)

```go
// Wrap the HTTP handler — automatically creates a span for every incoming request
handler := otelhttp.NewHandler(mux, "gateway.server")
http.ListenAndServe(":8080", handler)
```

### 3. HTTP Client Instrumentation

```go
// Wrap the HTTP transport — automatically creates a span for every outgoing request
// and injects the traceparent header for context propagation
client := &http.Client{
    Transport: otelhttp.NewTransport(http.DefaultTransport),
}
```

### 4. Manual Span Creation

```go
tracer := otel.Tracer("gateway")
ctx, span := tracer.Start(r.Context(), "checkout.process")
defer span.End()

// Error recording
span.SetStatus(codes.Error, "payment failed")
span.RecordError(err)
```

---

## Ports Summary

| Port | Service | Purpose |
|---|---|---|
| 8080 | Gateway | Checkout entry point |
| 8081 | Auth Service | Request validation |
| 8082 | Order Service | Order orchestration |
| 8083 | Payment Service | Payment processing |
| 8084 | Inventory Service | Stock availability |
| 8090 | TraceFlow API | Dashboard backend-for-frontend |
| 4318 | Jaeger | OTLP HTTP receiver (spans go here) |
| 16686 | Jaeger | UI and query API |

---

## Stopping Everything

Stop the services by pressing `Ctrl+C` in each terminal, then stop Jaeger:

```powershell
docker stop jaeger
```

---

## TraceFlow Dashboard

The React dashboard is in `dashboard/`. It is ready to consume the TraceFlow API on port `8090` and does not contain hardcoded trace or service telemetry.

### Start the dashboard

```powershell
cd dashboard
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The dashboard expects:

| API | Default URL |
|---|---|
| TraceFlow API | `http://localhost:8090` |

Set a different API origin with:

```env
VITE_API_BASE_URL=http://localhost:8090
```

Before the API is running, the Overview, Traces, and Service Map screens show explicit unavailable or waiting states rather than fabricated telemetry.

### Dashboard screens

- `/` — overview metrics, recent traces, checkout trigger, and simulator controls
- `/services` — React Flow service topology and service detail panel
- `/traces` — searchable trace table with service and status filters
- `/traces/:traceId` — trace summary, waterfall, span hierarchy, span inspector, and measured bottleneck

### API contract used by the dashboard

| Endpoint | Purpose |
|---|---|
| `GET /api/overview` | Dashboard summary cards and recent activity |
| `GET /api/services` | Observed services |
| `GET /api/traces` | Recent trace summaries |
| `GET /api/traces/:traceID` | Trace detail and spans |
| `GET /api/dependencies` | Telemetry-derived or static demo topology |
| `POST /api/demo/checkout` | Trigger a checkout through Gateway |
| `GET /api/demo/config` | Read Payment and Inventory configuration |
| `PUT /api/demo/config` | Update Payment and Inventory configuration |

### Start the TraceFlow API

Start Jaeger first. The five business services are required for checkout and simulator controls; trace browsing only requires Jaeger to have stored traces.

```powershell
cd services\traceflow-api
go run .
```

By default, the API listens on `http://localhost:8090` and queries Jaeger at `http://localhost:16686`. Configure alternate addresses with:

```env
TRACEFLOW_API_PORT=8090
JAEGER_QUERY_URL=http://localhost:16686
GATEWAY_URL=http://localhost:8080
PAYMENT_SERVICE_URL=http://localhost:8083
INVENTORY_SERVICE_URL=http://localhost:8084
OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4318
```

The API uses Jaeger 2.23's stable `/api/v3/*` query endpoints and maps OTLP trace responses into dashboard-owned response DTOs. Its service and trace routes return observed telemetry; the dependency map is explicitly marked as the static demo topology. Services only appear as `unknown` health because Jaeger trace data does not establish current process health.

The trace search covers the previous 24 hours. Overview metrics are computed from up to 1,000 returned traces; `totalTraces` is `null` and `metricsPartial` is `true` when the result reaches that cap. `sampleCount` reports the number of traces used in the calculations.

For browser development, the API allows the Vite origins `http://localhost:5173` and `http://127.0.0.1:5173` by default. Override with a comma-separated `CORS_ALLOWED_ORIGINS` value if needed.
