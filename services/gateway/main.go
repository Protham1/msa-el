package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
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
		Timeout:   30 * time.Second,
	}

	authURL := os.Getenv("AUTH_SERVICE_URL")
	if authURL == "" {
		authURL = "http://localhost:8081"
	}

	orderURL := os.Getenv("ORDER_SERVICE_URL")
	if orderURL == "" {
		orderURL = "http://localhost:8082"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "gateway"})
	})

	mux.HandleFunc("/checkout", func(w http.ResponseWriter, r *http.Request) {

		tracer := otel.Tracer("gateway")

		ctx, span := tracer.Start(r.Context(), "checkout.process")
		defer span.End()

		// Step 1: Call Auth service
		authReq, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			authURL+"/validate",
			nil,
		)

		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to create auth request", "details": err.Error()})
			return
		}

		authResp, err := client.Do(authReq)
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": "auth service unavailable", "details": err.Error()})
			return
		}
		defer authResp.Body.Close()
		io.ReadAll(authResp.Body)

		if authResp.StatusCode != http.StatusOK {
			span.SetStatus(codes.Error, "auth validation failed")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "authentication failed"})
			return
		}

		// Step 2: Call Order service
		orderReq, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			orderURL+"/orders",
			nil,
		)

		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "failed to create order request", "details": err.Error()})
			return
		}

		orderResp, err := client.Do(orderReq)
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": "order service unavailable", "details": err.Error()})
			return
		}
		defer orderResp.Body.Close()

		orderBody, _ := io.ReadAll(orderResp.Body)

		w.Header().Set("Content-Type", "application/json")

		if orderResp.StatusCode != http.StatusOK {
			span.SetStatus(codes.Error, "order processing failed")
			w.WriteHeader(orderResp.StatusCode)
			w.Write(orderBody)
			return
		}

		// Return success with order response
		var orderResult map[string]interface{}
		json.Unmarshal(orderBody, &orderResult)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "success",
			"message": "checkout completed",
			"order":   orderResult,
		})
	})

	handler := otelhttp.NewHandler(mux, "gateway.server")

	fmt.Println("Gateway running on :8080")

	http.ListenAndServe(":8080", handler)
}
