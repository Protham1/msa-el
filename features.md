# TraceFlow — Prototype Feature Specification

> **Deadline:** Tomorrow  
> **Goal:** Deliver a working, visually polished prototype that demonstrates distributed tracing, service dependencies, request latency, and bottleneck investigation.
>
> **Primary rule:** Build a reliable end-to-end demo before adding optional polish. Do not build a full observability platform.

---

## 1. Product overview

TraceFlow is a lightweight distributed tracing and microservice observability dashboard. It visualizes how a request travels through multiple services, lets a user inspect individual traces, and helps identify slow or failing services.

The prototype must demonstrate a real request flowing through instrumented Go services, with spans exported to Jaeger through OpenTelemetry. The React dashboard reads trace data through a small Go API/backend-for-frontend.

### Demo story

1. Open the TraceFlow dashboard and see service health and recent request activity.
2. Trigger a sample checkout request from the UI.
3. The request travels through Gateway → Auth → Order.
4. Order calls Payment and Inventory concurrently.
5. All services emit OpenTelemetry spans to Jaeger.
6. TraceFlow displays the resulting trace, its span hierarchy, service path, and latency breakdown.
7. Turn on a simulated delay or failure in Payment.
8. Trigger another checkout and show the longer/failed trace, identifying Payment as the bottleneck.

### Non-goals for this deadline

Do not implement Kubernetes, real payment processing, authentication/login for dashboard users, production-grade alerting, persistent application databases, automatic code dependency discovery, or a full log aggregation platform.

---

## 2. Technology choices

| Layer | Technology | Responsibility |
|---|---|---|
| Microservices | Go + `net/http` | Simulated distributed application |
| Instrumentation | OpenTelemetry Go SDK + `otelhttp` | Create spans and propagate context |
| Trace backend | Jaeger | Receive, store, and query traces |
| Dashboard API | Go + `net/http` | Proxy/normalize Jaeger query data and expose demo controls |
| Frontend | React + Vite + TypeScript | Dashboard UI |
| Styling | Tailwind CSS | Fast, consistent UI styling |
| Charts | Recharts | Latency and request charts |
| Dependency graph | React Flow (`@xyflow/react`) | Interactive service topology |
| Runtime | Docker Compose | Run the complete stack |
| Optional metrics | Prometheus | Only if time remains; not a blocker |

Keep the implementation simple. Avoid adding a database unless a concrete feature requires one.

---

## 3. MVP features — must work

### F1. Overview dashboard

**Purpose:** Give the evaluator an immediate view of the system.

Display:
- Total traces/requests in the selected time window.
- Average request duration.
- Error count or error rate, if available from trace data.
- Number of services observed.
- Recent traces table.
- Service status cards.

Behavior:
- Refresh button reloads data.
- Show a clear loading state.
- Show an empty state when Jaeger has no traces.
- Show a useful error state if Jaeger is unavailable.
- Display a visible “Demo mode” or “Live Jaeger data” indicator based on the actual data source.

Do not invent live metrics. If a value cannot be derived from Jaeger, label it as unavailable rather than fabricating it.

### F2. Service topology map

**Purpose:** Visualize the services and their observed communication paths.

Initial demo topology:

```text
                 ┌──────────────┐
                 │   Gateway    │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │     Auth     │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │    Order     │
                 └──────┬───────┘
                       / \
              ┌────────▼ └────────┐
              │                   │
       ┌──────▼──────┐    ┌───────▼─────┐
       │   Payment   │    │  Inventory  │
       └─────────────┘    └─────────────┘
```

Requirements:
- Render service nodes using React Flow.
- Draw directed edges based on observed parent/child span relationships or known demo dependencies.
- Show service name and a concise status/latency indicator where data supports it.
- Clicking a node opens a side panel with service details and recent related traces.
- Clicking an edge may show call count and average duration if these can be calculated from returned traces.
- Include a small legend.
- If no traces exist, show the known demo topology with an “Awaiting trace data” label; do not imply that the topology was discovered from telemetry.

### F3. Trace explorer

**Purpose:** Let users browse individual distributed requests.

Requirements:
- Fetch recent traces from Jaeger.
- Show trace ID, root operation, start time, duration, and error status.
- Search by trace ID.
- Filter by service and status where supported by the available data.
- Clicking a trace opens its detail view.
- Provide loading, empty, and error states.

### F4. Trace detail / waterfall

**Purpose:** Make one distributed request understandable.

Requirements:
- Display trace metadata: trace ID, duration, service count, and span count.
- Display a hierarchical span tree.
- Display a timeline/waterfall showing each span's start offset and duration.
- Show service name, operation name, duration, and status for each span.
- Highlight error spans.
- Clicking a span opens a details panel with available attributes, events, status, and parent span information.
- Make nested spans collapsible.
- Clearly distinguish parent/child spans from concurrent sibling spans.

If a span has no parent, treat it as a root. Do not assume that span array order represents execution order.

### F5. Trigger a demo checkout

**Purpose:** Make the prototype interactive rather than a static dashboard.

Add a “Run checkout” button on the dashboard.

When clicked:
- Call `POST /api/demo/checkout` on the TraceFlow API.
- API calls the Gateway service.
- Gateway calls Auth, then Order.
- Order calls Payment and Inventory concurrently using goroutines.
- Every service uses OpenTelemetry instrumentation.
- Propagate trace context across every HTTP service boundary.
- Return a request result and, if available, the trace ID.
- Refresh trace data after the request completes.

Show:
- In-progress state while the request runs.
- Success or failure result.
- A link/button to open the corresponding trace.

Use simulated business responses only. No real payment or inventory mutation is required.

### F6. Fault and latency simulator

**Purpose:** Demonstrate why tracing is useful.

Add a “Simulation controls” panel with:
- Payment delay: 0 ms, 500 ms, 1500 ms, 3000 ms.
- Payment failure: on/off.
- Inventory delay: 0 ms, 500 ms, 1500 ms.
- Reset controls.

Behavior:
- Controls update demo service behavior through the TraceFlow API.
- The API forwards configuration to the relevant demo service or stores shared demo configuration.
- A new checkout uses the selected settings.
- The dashboard explains that these are controlled demo faults, not real infrastructure failures.

Important: Keep controls deterministic and safe. Do not kill containers or manipulate the host machine. Simulate latency and HTTP errors inside the application.

### F7. Bottleneck insight

**Purpose:** Turn trace data into an understandable finding.

For a selected trace:
- Identify the longest-duration service span or operation.
- Display its service, operation, and duration.
- Compare its duration to total trace duration.
- If a service has a simulated delay configured, display that setting separately.
- If the data is insufficient, say “Not enough span data to identify a bottleneck.”

Do not call a service the bottleneck solely because it is the deepest span. Use measured duration and explain the method.

---

## 4. Nice-to-have features — only after MVP works

1. **Latency trend chart:** Plot request duration over recent traces.
2. **Service comparison:** Compare average duration by service.
3. **Error-focused view:** Quickly list traces containing error spans.
4. **Trace JSON view:** Show raw trace payload for debugging.
5. **Auto-refresh:** Optional 5–10 second refresh toggle.
6. **Dark/light theme:** Only if the core UI is complete.
7. **Prometheus metrics:** Add service request counters and duration histograms if time remains.

Do not sacrifice the working demo to implement these.

---

## 5. Microservice behavior and request flow

### Expected request flow

```text
Browser
  |
  v
TraceFlow API (dashboard backend)
  |
  v
Gateway :8080
  |
  v
Auth Service :8081
  |
  v
Order Service :8082
  |                 \
  |                  \
  v                   v
Payment :8083     Inventory :8084
```

Order should call Payment and Inventory concurrently. The response should wait for both results, with sensible timeouts.

### Service responsibilities

| Service | Responsibilities | Suggested endpoints |
|---|---|---|
| Gateway | Entry point; starts checkout flow | `GET /health`, `POST /checkout` |
| Auth | Simulated authorization | `GET /health`, `POST /validate` |
| Order | Orchestrates downstream calls | `GET /health`, `POST /orders` |
| Payment | Simulated payment result, delay, failure | `GET /health`, `POST /charge`, `POST /config` |
| Inventory | Simulated stock check, delay | `GET /health`, `POST /check`, `POST /config` |
| TraceFlow API | Dashboard API, Jaeger query proxy, demo trigger/configuration | See API section |

All services should:
- Have a `/health` endpoint.
- Use sensible HTTP timeouts.
- Return JSON for API responses.
- Log startup and request errors.
- Be instrumented with OpenTelemetry.
- Set the correct `service.name` resource attribute.
- Use `otelhttp` for incoming and outgoing HTTP requests.
- Propagate W3C Trace Context (`traceparent`) across service calls.
- Shut down gracefully where practical.

### Error handling

- A downstream timeout or failure should be represented in the trace.
- Set span status to error and record the error where appropriate.
- Return an appropriate HTTP status from the caller.
- Do not swallow errors and report false success.
- Always close response bodies.
- Use `context.Context` and request cancellation correctly.

---

## 6. TraceFlow API contract

Implement a small Go API that the React frontend calls. It should proxy Jaeger query APIs and normalize the responses into stable frontend DTOs.

Suggested endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | TraceFlow API health |
| `GET /api/overview` | Summary cards and recent activity |
| `GET /api/services` | Services known to Jaeger |
| `GET /api/traces?limit=20&service=&tags=` | Recent traces with filters |
| `GET /api/traces/:traceID` | One trace with spans |
| `GET /api/dependencies` | Service graph data derived from traces or explicitly marked demo topology |
| `POST /api/demo/checkout` | Trigger a checkout request through Gateway |
| `GET /api/demo/config` | Read simulator settings |
| `PUT /api/demo/config` | Update simulator settings |

### Jaeger integration guidance

- Configure Jaeger base URL using `JAEGER_QUERY_URL`, defaulting to `http://localhost:16686` for local non-container development.
- Inside Docker Compose, use the service DNS name, e.g. `http://jaeger:16686`.
- Before implementing the proxy, verify the actual Jaeger 2.23 query endpoints and JSON response shape. Do not assume the API shape from memory.
- The Jaeger UI query API commonly exposes service and trace query routes, but confirm against the running image.
- Add a small Jaeger client/repository layer in the API instead of calling Jaeger directly from React.
- Add a short timeout to Jaeger HTTP requests.
- Return clear `502`/`503` errors when Jaeger is unavailable.
- Keep raw Jaeger response handling isolated from frontend DTOs so the frontend does not depend on Jaeger's internal response shape.
- If the API cannot retrieve a value, return `null`/an explicit unavailable state rather than fabricated telemetry.

### Suggested normalized DTOs

These are application-owned response shapes, not claims about Jaeger's raw schema.

`TraceSummary`:
- `traceId: string`
- `rootOperation: string`
- `rootService: string`
- `startTime: string`
- `durationMs: number`
- `spanCount: number`
- `serviceNames: string[]`
- `hasError: boolean`

`TraceDetail`:
- `traceId: string`
- `durationMs: number`
- `startTime: string`
- `spans: Span[]`

`Span`:
- `spanId: string`
- `parentSpanId?: string`
- `serviceName: string`
- `operationName: string`
- `startTimeUnixNano: string`
- `durationMs: number`
- `status: "ok" | "error" | "unset"`
- `attributes: Record<string, unknown>`
- `events: Array<unknown>`

`ServiceNode`:
- `id: string`
- `name: string`
- `status: "healthy" | "degraded" | "unknown"`
- `averageLatencyMs?: number`
- `requestCount?: number`

`DependencyEdge`:
- `id: string`
- `source: string`
- `target: string`
- `callCount?: number`
- `averageLatencyMs?: number`

---

## 7. Frontend screens and layout

Build a polished developer-tool interface. Prefer a dark theme, restrained accent colors, clear typography, and compact data-dense components. Avoid a generic admin-template look.

### App shell

- Left sidebar with TraceFlow logo/name.
- Navigation: Overview, Service Map, Traces.
- Small environment indicator: `LOCAL DEMO`.
- Main content area.
- Top bar with refresh action and current data-source status.

### Screen A — Overview (`/`)

Layout:
- Page heading: “System Overview”.
- Four summary cards.
- Service health row/grid.
- Main service topology preview.
- Recent traces table.
- “Run checkout” primary action.
- Simulation controls panel.

### Screen B — Service Map (`/services`)

Layout:
- Large React Flow canvas.
- Service nodes and directed edges.
- Fit-view and reset-view controls.
- Legend.
- Node details side panel.
- Clearly mark static demo topology versus telemetry-derived topology.

### Screen C — Traces (`/traces`)

Layout:
- Trace list/table.
- Search by trace ID.
- Service filter.
- Error filter.
- Duration and start-time columns.
- Clicking a row opens trace detail.

### Screen D — Trace detail (`/traces/:traceId`)

Layout:
- Breadcrumb back to Traces.
- Trace ID with copy action.
- Summary cards: duration, spans, services, error state.
- Waterfall/timeline.
- Hierarchical span tree.
- Span details drawer/panel.
- Bottleneck insight panel.

### UI states

Every data-driven component must handle:
- Loading.
- Empty.
- Error/unavailable.
- Success.

Do not leave blank panels when data is missing. Provide helpful explanations and retry actions.

---

## 8. Recommended repository structure

Use this structure unless the existing repository already has a sensible equivalent. Preserve working code and avoid unnecessary renames.

```text
TraceFlow/
├── README.md
├── FEATURES.md
├── .gitignore
├── docker-compose.yml
│
├── services/
│   ├── common/
│   │   └── tracing/
│   │       ├── tracing.go
│   │       └── propagation.go
│   │
│   ├── gateway/
│   │   ├── main.go
│   │   ├── handlers/
│   │   │   └── checkout.go
│   │   ├── clients/
│   │   │   ├── auth.go
│   │   │   └── order.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   ├── auth-service/
│   │   ├── main.go
│   │   ├── handlers/
│   │   │   └── validate.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   ├── order-service/
│   │   ├── main.go
│   │   ├── handlers/
│   │   │   └── order.go
│   │   ├── clients/
│   │   │   ├── payment.go
│   │   │   └── inventory.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   ├── payment-service/
│   │   ├── main.go
│   │   ├── handlers/
│   │   │   └── charge.go
│   │   ├── config/
│   │   │   └── config.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   ├── inventory-service/
│   │   ├── main.go
│   │   ├── handlers/
│   │   │   └── check.go
│   │   ├── config/
│   │   │   └── config.go
│   │   ├── go.mod
│   │   └── Dockerfile
│   │
│   └── traceflow-api/
│       ├── main.go
│       ├── handlers/
│       │   ├── overview.go
│       │   ├── traces.go
│       │   ├── services.go
│       │   └── demo.go
│       ├── jaeger/
│       │   ├── client.go
│       │   └── mapper.go
│       ├── models/
│       │   └── models.go
│       ├── go.mod
│       └── Dockerfile
│
├── dashboard/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   └── client.ts
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── Topbar.tsx
│       │   ├── overview/
│       │   │   ├── MetricCard.tsx
│       │   │   ├── ServiceHealth.tsx
│       │   │   ├── RecentTraces.tsx
│       │   │   └── SimulationPanel.tsx
│       │   ├── topology/
│       │   │   ├── ServiceMap.tsx
│       │   │   ├── ServiceNode.tsx
│       │   │   └── ServiceDetails.tsx
│       │   ├── traces/
│       │   │   ├── TraceTable.tsx
│       │   │   ├── TraceWaterfall.tsx
│       │   │   ├── SpanTree.tsx
│       │   │   ├── SpanDetails.tsx
│       │   │   └── BottleneckInsight.tsx
│       │   └── common/
│       │       ├── LoadingState.tsx
│       │       ├── EmptyState.tsx
│       │       └── ErrorState.tsx
│       ├── pages/
│       │   ├── OverviewPage.tsx
│       │   ├── ServiceMapPage.tsx
│       │   ├── TracesPage.tsx
│       │   └── TraceDetailPage.tsx
│       ├── hooks/
│       │   ├── useOverview.ts
│       │   ├── useTraces.ts
│       │   └── useTraceDetail.ts
│       ├── types/
│       │   └── tracing.ts
│       └── styles/
│           └── index.css
│
└── infrastructure/
    ├── jaeger/
    │   └── README.md
    ├── prometheus/
    │   └── prometheus.yml
    └── otel-collector/
        └── config.yaml
```

### Repository structure notes

- The above is a target structure, not a requirement to create empty files.
- Do not create a separate Go module for `services/common` unless the current Go workspace/module setup makes that practical. For a fast prototype, duplicate a small tracing initializer if module sharing becomes a time sink; keep it consistent.
- If using a Go workspace, add a root `go.work` and configure it correctly. Otherwise each service can remain an independent module.
- Keep React components small and focused.
- Do not put all frontend code in one giant `App.tsx`.
- Do not put all Go handlers and Jaeger parsing logic in `main.go`.
- Do not add unused files or empty abstractions.

---

## 9. Docker Compose requirements

The final prototype should start with one command:

```bash
docker compose up --build
```

Compose should include:
- `jaeger`
- `gateway`
- `auth-service`
- `order-service`
- `payment-service`
- `inventory-service`
- `traceflow-api`
- `dashboard` (optional to serve through a lightweight web server)

Requirements:
- Services communicate using Compose service names, not `localhost`.
- Jaeger OTLP HTTP endpoint inside Compose should be `http://jaeger:4318`.
- Jaeger query endpoint inside Compose should be `http://jaeger:16686`.
- Expose dashboard on `http://localhost:5173` for Vite development, or `http://localhost:3000` if serving a production build.
- Expose Jaeger UI on `http://localhost:16686`.
- Expose TraceFlow API on `http://localhost:8090`.
- Expose Gateway on `http://localhost:8080` if useful for manual testing.
- Add health checks where practical and sensible startup dependencies.
- Avoid hard-coding host-only URLs inside containers.
- Use environment variables for service URLs and telemetry endpoints.

The currently running standalone Jaeger container may conflict with Compose port bindings. Before starting the Compose Jaeger service, stop/remove or rename the standalone container. Preserve the image; there is no need to download it again.

---

## 10. Environment variables

Document these in `.env.example`:

```env
# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf

# Jaeger query API
JAEGER_QUERY_URL=http://jaeger:16686

# Service URLs
AUTH_SERVICE_URL=http://auth-service:8081
ORDER_SERVICE_URL=http://order-service:8082
PAYMENT_SERVICE_URL=http://payment-service:8083
INVENTORY_SERVICE_URL=http://inventory-service:8084
GATEWAY_URL=http://gateway:8080

# TraceFlow API
TRACEFLOW_API_PORT=8090
VITE_API_BASE_URL=http://localhost:8090
```

Use the endpoint configuration correctly for the OTLP HTTP exporter. If using `WithEndpoint`, ensure the code expects a host:port rather than accidentally appending or duplicating a URL path. Do not commit secrets.

---

## 11. Visual design direction

Create a polished infrastructure/developer-tool interface.

- Dark navy/charcoal background.
- Subtle borders and restrained blue/cyan accents.
- Green for healthy/success, amber for degraded/warning, red for errors.
- Dense but readable tables.
- Clear typography and consistent spacing.
- Avoid oversized marketing-style cards.
- Use monospace for trace IDs, span IDs, endpoints, and durations.
- Use tooltips for technical terms.
- Use realistic sample data only in an explicitly labelled demo/empty fallback state.
- The main screen should look credible in a classroom presentation projected on a screen.

---

## 12. Build order for the deadline

Work in this exact order. At every stage, keep the project runnable.

### Phase 1 — Preserve and verify current working setup
1. Inspect the existing repository before editing.
2. Confirm Gateway and Auth still work.
3. Confirm both services export spans to Jaeger.
4. Keep the existing trace pipeline working.
5. Add a README note describing current local run commands.

### Phase 2 — Complete the demo request path
1. Add Order Service.
2. Add Payment Service.
3. Add Inventory Service.
4. Implement Order's concurrent calls to Payment and Inventory.
5. Instrument every incoming and outgoing HTTP request.
6. Verify one checkout creates one connected trace across all services.
7. Verify a delayed Payment span is visible in Jaeger.

### Phase 3 — Build the dashboard API
1. Verify Jaeger 2.23 query API endpoints and response payloads.
2. Implement Jaeger client and response mapper.
3. Implement `/api/health`, `/api/traces`, `/api/traces/:traceID`, `/api/services`.
4. Implement `/api/demo/checkout`.
5. Implement demo configuration endpoints.
6. Test the API with curl or Bruno.

### Phase 4 — Build the frontend
1. Create the React + Vite + TypeScript app.
2. Build the app shell and navigation.
3. Build Overview and Run Checkout interaction.
4. Build Trace Explorer.
5. Build Trace Detail and waterfall.
6. Build Service Map with React Flow.
7. Add simulation controls and bottleneck insight.
8. Add loading, empty, and error states.

### Phase 5 — Dockerize and rehearse
1. Add Dockerfiles.
2. Add Docker Compose.
3. Configure internal service URLs.
4. Run the entire stack from a clean start.
5. Trigger checkout from the UI.
6. Confirm trace appears in the dashboard and Jaeger.
7. Trigger a delay and show the bottleneck.
8. Trigger a failure and show error spans.
9. Rehearse the demo and prepare screenshots as backup.

If time is running out, prioritize: real checkout trace → trace explorer/detail → delay simulator → service map → overview polish.

---

## 13. Acceptance criteria

The prototype is ready to present when all of the following work:

- [ ] The full stack starts using documented commands.
- [ ] Jaeger UI is accessible.
- [ ] Gateway, Auth, Order, Payment, and Inventory are independently running services.
- [ ] A checkout request flows through all expected services.
- [ ] Trace context propagates across every service boundary.
- [ ] Payment and Inventory execute concurrently.
- [ ] One checkout produces a connected distributed trace.
- [ ] TraceFlow dashboard lists real traces from Jaeger.
- [ ] Selecting a trace displays its span hierarchy and waterfall.
- [ ] The service map displays the expected topology and clearly labels its data source.
- [ ] Changing Payment delay changes the observed trace duration.
- [ ] Simulated Payment failure produces an error trace.
- [ ] Bottleneck insight identifies the deliberately delayed Payment operation.
- [ ] Loading, empty, and unavailable states are handled.
- [ ] README explains architecture, features, setup, ports, and demo flow.

---

## 14. Instructions for the coding agent

You are working in an existing TraceFlow repository. The user has already built a working Go Gateway and Auth Service, instrumented them with OpenTelemetry, and confirmed a connected two-service trace in Jaeger 2.23. Do not overwrite or break this working implementation.

### How to work

1. Inspect the current repository and read existing Go files before changing anything.
2. Identify the current module layout, ports, exporter configuration, and working Jaeger setup.
3. Make a short implementation plan, then implement in small, testable increments.
4. Preserve working code and reuse existing patterns.
5. Run formatting, compilation, and tests after each backend change.
6. Verify actual Jaeger 2.23 query API behavior before writing the Jaeger client.
7. Do not invent trace data, service health, metrics, or API response fields.
8. Keep the frontend connected to the real TraceFlow API. Avoid hardcoded mock data except for a clearly labelled empty/demo fallback.
9. Never put Jaeger query logic directly in React.
10. Use environment variables for URLs and ports.
11. Do not introduce Kubernetes, a database, Kafka, authentication, or other scope-expanding infrastructure.
12. If a requested feature threatens the deadline, implement the smallest working version and report what was deferred.
13. Do not stop after generating files. Run the project and verify the actual end-to-end flow.
14. Update README with commands that have actually been tested.
15. Keep the code understandable enough for a student to explain during a project evaluation.

### First action

Inspect the existing repository and report:
- What is already implemented.
- What currently works.
- What needs to be added.
- Any conflicts between the current code and this specification.

Then proceed with Phase 2, preserving the existing Gateway/Auth tracing implementation. Do not rewrite the entire repository from scratch.

---

## 15. Suggested classroom demo script

1. Open TraceFlow Overview and explain the services.
2. Click **Run checkout**.
3. Open the resulting trace and explain Trace ID, spans, parent-child relationships, and service boundaries.
4. Open Service Map and explain the observed request dependencies.
5. Set Payment delay to 3000 ms.
6. Run checkout again and compare trace durations.
7. Open the new trace and identify Payment as the bottleneck.
8. Enable Payment failure and run checkout once more.
9. Show the failed span and explain how distributed tracing helps debug failures across services.

**Closing message:** TraceFlow demonstrates how distributed tracing makes the behavior, latency, and failure propagation of a microservice architecture observable from a single request-level view.
