package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
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

	paymentURL := os.Getenv("PAYMENT_SERVICE_URL")
	if paymentURL == "" {
		paymentURL = "http://localhost:8083"
	}

	inventoryURL := os.Getenv("INVENTORY_SERVICE_URL")
	if inventoryURL == "" {
		inventoryURL = "http://localhost:8084"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "order-service"})
	})

	mux.HandleFunc("/orders", func(w http.ResponseWriter, r *http.Request) {

		tracer := otel.Tracer("order-service")

		ctx, span := tracer.Start(r.Context(), "order.process")
		defer span.End()

		type serviceResult struct {
			name       string
			statusCode int
			body       []byte
			err        error
		}

		var wg sync.WaitGroup
		results := make(chan serviceResult, 2)

		// Call Payment concurrently
		wg.Add(1)
		go func() {
			defer wg.Done()

			payCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			req, err := http.NewRequestWithContext(payCtx, http.MethodPost, paymentURL+"/charge", nil)
			if err != nil {
				results <- serviceResult{name: "payment", err: err}
				return
			}

			resp, err := client.Do(req)
			if err != nil {
				results <- serviceResult{name: "payment", err: err}
				return
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(resp.Body)
			results <- serviceResult{name: "payment", statusCode: resp.StatusCode, body: body}
		}()

		// Call Inventory concurrently
		wg.Add(1)
		go func() {
			defer wg.Done()

			invCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			req, err := http.NewRequestWithContext(invCtx, http.MethodPost, inventoryURL+"/check", nil)
			if err != nil {
				results <- serviceResult{name: "inventory", err: err}
				return
			}

			resp, err := client.Do(req)
			if err != nil {
				results <- serviceResult{name: "inventory", err: err}
				return
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(resp.Body)
			results <- serviceResult{name: "inventory", statusCode: resp.StatusCode, body: body}
		}()

		// Wait for both to complete
		go func() {
			wg.Wait()
			close(results)
		}()

		paymentOk := false
		inventoryOk := false

		for res := range results {
			if res.err != nil {
				span.SetStatus(codes.Error, fmt.Sprintf("%s call failed: %s", res.name, res.err.Error()))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]string{
					"error":   fmt.Sprintf("%s service unavailable", res.name),
					"details": res.err.Error(),
				})
				return
			}

			if res.statusCode != http.StatusOK {
				span.SetStatus(codes.Error, fmt.Sprintf("%s returned %d", res.name, res.statusCode))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(res.statusCode)
				w.Write(res.body)
				return
			}

			if res.name == "payment" {
				paymentOk = true
			} else {
				inventoryOk = true
			}
		}

		if !paymentOk || !inventoryOk {
			span.SetStatus(codes.Error, "incomplete downstream responses")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "order processing incomplete"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "confirmed",
			"orderId": fmt.Sprintf("ORD-%d", time.Now().UnixMilli()),
			"payment": map[string]string{"status": "charged"},
			"inventory": map[string]string{"status": "reserved"},
		})
	})

	handler := otelhttp.NewHandler(mux, "order.server")

	fmt.Println("Order Service running on :8082")

	http.ListenAndServe(":8082", handler)
}
