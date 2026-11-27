# TraceFlow — One-Hour Sprint Plan

**Goal:** Complete the full checkout request path and demonstrate normal, delayed, and failed distributed traces in Jaeger.

**Target:** Gateway -> Auth -> Order -> Payment + Inventory

## Current state

Already available:

- Gateway service on port `8080`
- Auth service on port `8081`
- OpenTelemetry HTTP instrumentation
- W3C Trace Context propagation
- Gateway -> Auth trace flow
- Both existing Go modules compile successfully

Not yet available:

- Order service
- Payment service
- Inventory service
- TraceFlow API
- React dashboard
- Docker Compose
- Dashboard simulator controls

Do not start the dashboard or infrastructure work during this hour. The priority is a complete, visible distributed trace.

---

## 0-10 minutes: Start the tracing infrastructure

1. Start Jaeger 2.23:

   ```powershell
   docker run --rm -d --name jaeger `
     -p 16686:16686 `
     -p 4318:4318 `
     jaegertracing/all-in-one:latest
   ```

2. Verify Jaeger:

   ```powershell
   curl.exe http://localhost:16686/api/services
   ```

3. Prepare the existing Gateway and Auth services:
   - Replace the hardcoded OTLP endpoint with `OTEL_EXPORTER_OTLP_ENDPOINT`
   - Replace the hardcoded Auth URL in Gateway with `AUTH_SERVICE_URL`
   - Add `GET /health` endpoints
   - Return JSON responses from checkout and validation endpoints

Relevant files:

- `services/gateway/main.go`
- `services/gateway/tracing.go`
- `services/auth-service/main.go`
- `services/auth-service/tracing.go`

**Checkpoint:** Jaeger opens, the query API responds, and both existing modules compile.

---

## 10-25 minutes: Add the Order service

Create:

- `services/order-service/main.go`
- `services/order-service/tracing.go`

The service should:

- Listen on port `8082`
- Expose `GET /health`
- Expose `POST /orders`
- Call Payment at `8083`
- Call Inventory at `8084`
- Use `otelhttp.NewTransport` for outgoing requests
- Use `context.WithTimeout` for downstream calls
- Read service URLs from environment variables
- Close downstream response bodies

Suggested environment variables:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4318
PAYMENT_SERVICE_URL=http://localhost:8083
INVENTORY_SERVICE_URL=http://localhost:8084
```

**Checkpoint:** An HTTP request to `/orders` reaches the Order handler. The downstream calls can be placeholders initially, but the endpoint must return JSON.

---

## 25-40 minutes: Add Payment and Inventory services

### Payment service

Create `services/payment-service/main.go` and `services/payment-service/tracing.go`.

It should:

- Listen on port `8083`
- Expose `GET /health`
- Expose `POST /charge`
- Read a simulated delay
- Read a simulated failure setting
- Sleep for the configured delay
- Return HTTP `500` when failure is enabled
- Set the OpenTelemetry span status to error on failure

For this first hour, configuration can initially be environment variables or simple in-memory variables:

```env
PAYMENT_DELAY_MS=0
PAYMENT_FAILURE=false
```

### Inventory service

Create `services/inventory-service/main.go` and `services/inventory-service/tracing.go`.

It should:

- Listen on port `8084`
- Expose `GET /health`
- Expose `POST /check`
- Read an inventory delay
- Return a successful in-stock JSON response

### Concurrent Order calls

Update Order to call Payment and Inventory concurrently using goroutines or `errgroup`.

Both calls should:

- Receive the same parent trace context
- Use an independent client call span
- Run at the same time
- Use separate timeouts
- Wait for both responses before completing

**Checkpoint:** `/orders` takes approximately as long as the slower Payment or Inventory branch, not the sum of both branches.

---

## 40-50 minutes: Complete the Gateway checkout flow

Update `services/gateway/main.go`:

1. Keep `POST /checkout`.
2. Call Auth with `POST /validate`.
3. If Auth succeeds, call Order with `POST /orders`.
4. If Auth or Order fails, return the appropriate HTTP status.
5. Propagate the existing request context across both calls.
6. Return JSON for success and failure responses.

Expected flow:

```text
POST /checkout
  -> POST /validate
  -> POST /orders
     -> POST /charge
     -> POST /check
```

Test:

```powershell
curl.exe -X POST http://localhost:8080/checkout
```

**Checkpoint:** One checkout request reaches all five services and returns success.

---

## 50-55 minutes: Verify a normal trace

1. Open Jaeger at `http://localhost:16686`.
2. Select the `gateway` service.
3. Find the newest trace.
4. Open the trace waterfall.

Confirm the trace includes:

- `gateway`
- `auth-service`
- `order-service`
- `payment-service`
- `inventory-service`

Confirm:

- Every downstream service shares the same trace ID
- Parent and child spans form a hierarchy
- Payment and Inventory sibling spans overlap

**Checkpoint:** One checkout produces one connected distributed trace.

---

## 55-60 minutes: Verify delay and failure behavior

### Delay test

1. Set `PAYMENT_DELAY_MS=3000`.
2. Restart or reconfigure Payment.
3. Run another checkout.
4. Open the new trace in Jaeger.

Confirm:

- Payment span lasts approximately 3 seconds
- Total trace duration increases
- Payment is the longest span

### Failure test

1. Set `PAYMENT_DELAY_MS=0`.
2. Set `PAYMENT_FAILURE=true`.
3. Restart or reconfigure Payment.
4. Run another checkout.

Confirm:

- Payment returns HTTP `500`
- Payment span is marked with error status
- Gateway or Order represents the propagated failure clearly

**Checkpoint:** The demo visibly changes trace duration and error status.

---

## Stop list

Do not begin these tasks during this sprint:

- React dashboard
- TraceFlow API
- Jaeger response mapping
- React Flow service map
- Docker Compose
- Prometheus
- Raw trace JSON view
- Dark/light theme
- Database or authentication
- Full simulator API

---

## Hour-end success criteria

The prototype has reached the first-hour milestone when:

- [ ] Gateway runs on port `8080`
- [ ] Auth runs on port `8081`
- [ ] Order runs on port `8082`
- [ ] Payment runs on port `8083`
- [ ] Inventory runs on port `8084`
- [ ] Jaeger UI is accessible
- [ ] One checkout reaches all five services
- [ ] Payment and Inventory execute concurrently
- [ ] One checkout produces one connected trace
- [ ] Payment delay changes the trace duration
- [ ] Payment delay is visible in the waterfall
- [ ] Payment failure creates an error span
- [ ] `/health` is available on every service

## Suggested final demo sequence

1. Run a normal checkout.
2. Open the trace in Jaeger and explain the service hierarchy.
3. Enable a 3000 ms Payment delay.
4. Run another checkout.
5. Compare trace durations and identify Payment as the bottleneck.
6. Enable Payment failure.
7. Run one final checkout.
8. Show the failed span and explain failure propagation.
