package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

var (
	mu      sync.RWMutex
	delayMs int
)

func init() {
	if v := os.Getenv("INVENTORY_DELAY_MS"); v != "" {
		delayMs, _ = strconv.Atoi(v)
	}
}

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

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "inventory-service"})
	})

	mux.HandleFunc("/check", func(w http.ResponseWriter, r *http.Request) {

		tracer := otel.Tracer("inventory-service")

		_, span := tracer.Start(r.Context(), "inventory.check")
		defer span.End()

		mu.RLock()
		currentDelay := delayMs
		mu.RUnlock()

		// Apply simulated delay
		if currentDelay > 0 {
			time.Sleep(time.Duration(currentDelay) * time.Millisecond)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "in_stock",
			"message":   "inventory check passed",
			"available": 42,
		})
	})

	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			mu.RLock()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"delayMs": delayMs,
			})
			mu.RUnlock()

		case http.MethodPost:
			var cfg struct {
				DelayMs *int `json:"delayMs"`
			}
			if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "invalid config"})
				return
			}

			mu.Lock()
			if cfg.DelayMs != nil {
				delayMs = *cfg.DelayMs
			}
			mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	handler := otelhttp.NewHandler(mux, "inventory.server")

	fmt.Println("Inventory Service running on :8084")

	http.ListenAndServe(":8084", handler)
}
