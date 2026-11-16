package main

import (
    "context"
    "fmt"
    "net/http"
    "time"

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

    mux := http.NewServeMux()

    mux.HandleFunc("/validate", func(w http.ResponseWriter, r *http.Request) {

        tracer := otel.Tracer("auth-service")

        _, span := tracer.Start(r.Context(), "auth.validate")
        defer span.End()

        // Simulate authentication processing
        time.Sleep(100 * time.Millisecond)

        fmt.Fprintln(w, "Authentication successful")
    })

    handler := otelhttp.NewHandler(mux, "auth.server")

    fmt.Println("Auth Service running on :8081")

    http.ListenAndServe(":8081", handler)
}