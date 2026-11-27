package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"traceflow/traceflow-api/handlers"
	"traceflow/traceflow-api/jaeger"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	provider, err := initTracer(ctx)
	if err != nil {
		log.Fatalf("initialize tracing: %v", err)
	}

	queryURL := envOr("JAEGER_QUERY_URL", "http://localhost:16686")
	jaegerClient, err := jaeger.NewClient(queryURL)
	if err != nil {
		log.Fatalf("configure Jaeger client: %v", err)
	}

	gatewayURL := envOr("GATEWAY_URL", "http://localhost:8080")
	paymentURL := envOr("PAYMENT_SERVICE_URL", "http://localhost:8083")
	inventoryURL := envOr("INVENTORY_SERVICE_URL", "http://localhost:8084")
	for name, serviceURL := range map[string]string{
		"GATEWAY_URL": gatewayURL, "PAYMENT_SERVICE_URL": paymentURL, "INVENTORY_SERVICE_URL": inventoryURL,
	} {
		if err := handlers.ValidateServiceURL(serviceURL); err != nil {
			log.Fatalf("%s: %v", name, err)
		}
	}

	outbound := &http.Client{
		Timeout:   30 * time.Second,
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}
	api := handlers.New(jaegerClient, gatewayURL, paymentURL, inventoryURL, outbound)
	handler := otelhttp.NewHandler(
		api.Handler(handlers.ParseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))),
		"traceflow-api.server",
		otelhttp.WithFilter(func(r *http.Request) bool {
			return r.URL.Path == "/api/demo/checkout"
		}),
	)

	port := envOr("TRACEFLOW_API_PORT", "8090")
	if _, err := strconv.Atoi(port); err != nil {
		log.Fatalf("TRACEFLOW_API_PORT must be a port number, got %q", port)
	}
	server := &http.Server{
		Addr:              net.JoinHostPort("", port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP server shutdown failed: %v", err)
		}
	}()

	log.Printf("TraceFlow API listening on :%s (Jaeger: %s)", port, strings.TrimRight(queryURL, "/"))
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("HTTP server failed: %v", err)
	}
	if err := provider.Shutdown(context.Background()); err != nil {
		log.Printf("tracer provider shutdown failed: %v", err)
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
