package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
)

var (
	mu           sync.RWMutex
	delayMs      int
	failureOn    bool
)

func init() {
	// Read initial config from environment
	if v := os.Getenv("PAYMENT_DELAY_MS"); v != "" {
		delayMs, _ = strconv.Atoi(v)
	}
	if v := os.Getenv("PAYMENT_FAILURE"); v != "" {
		failureOn = strings.EqualFold(v, "true")
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
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "payment-service"})
	})

	mux.HandleFunc("/charge", func(w http.ResponseWriter, r *http.Request) {

		tracer := otel.Tracer("payment-service")

		_, span := tracer.Start(r.Context(), "payment.charge")
		defer span.End()

		mu.RLock()
		currentDelay := delayMs
		currentFailure := failureOn
		mu.RUnlock()

		// Apply simulated delay
		if currentDelay > 0 {
			time.Sleep(time.Duration(currentDelay) * time.Millisecond)
		}

		// Apply simulated failure
		if currentFailure {
			span.SetStatus(codes.Error, "payment processing failed (simulated)")
			span.RecordError(fmt.Errorf("simulated payment failure"))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{
				"error":  "payment_failed",
				"message": "payment processing failed (simulated)",
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "charged",
			"message": "payment processed successfully",
		})
	})

	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			mu.RLock()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"delayMs": delayMs,
				"failure": failureOn,
			})
			mu.RUnlock()

		case http.MethodPost:
			var cfg struct {
				DelayMs *int  `json:"delayMs"`
				Failure *bool `json:"failure"`
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
			if cfg.Failure != nil {
				failureOn = *cfg.Failure
			}
			mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	handler := otelhttp.NewHandler(mux, "payment.server")

	fmt.Println("Payment Service running on :8083")

	http.ListenAndServe(":8083", handler)
}
