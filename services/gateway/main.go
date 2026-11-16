package main

import (
    "context"
    "fmt"
    "io"
    "net/http"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {

    ctx := context.Background()

    tp, err := initTracer(ctx)
    if err != nil {
        panic(err)
    }

    defer tp.Shutdown(ctx)

    otel.SetTracerProvider(tp)

    otel.SetTextMapPropagator(
        propagation.TraceContext{},
    )

    client := &http.Client{
        Transport: otelhttp.NewTransport(http.DefaultTransport),
    }

    mux := http.NewServeMux()

    mux.HandleFunc("/checkout", func(w http.ResponseWriter, r *http.Request) {

        tracer := otel.Tracer("gateway")

        ctx, span := tracer.Start(r.Context(), "checkout.process")
        defer span.End()

        req, err := http.NewRequestWithContext(
            ctx,
            http.MethodPost,
            "http://localhost:8081/validate",
            nil,
        )

        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }

        resp, err := client.Do(req)

        if err != nil {
            http.Error(w, err.Error(), http.StatusBadGateway)
            return
        }

        defer resp.Body.Close()

        body, _ := io.ReadAll(resp.Body)

        fmt.Fprintf(w, "Gateway received: %s", body)
    })

    handler := otelhttp.NewHandler(mux, "gateway.server")

    fmt.Println("Gateway running on :8080")

    http.ListenAndServe(":8080", handler)
}