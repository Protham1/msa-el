package handlers

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/trace"
	"traceflow/traceflow-api/jaeger"
	"traceflow/traceflow-api/models"
)

const (
	defaultTraceLimit  = 20
	overviewTraceLimit = 1000
	maxRequestBody     = 1 << 20
)

type API struct {
	jaeger       *jaeger.Client
	gatewayURL   string
	paymentURL   string
	inventoryURL string
	httpClient   *http.Client
}

func New(client *jaeger.Client, gatewayURL, paymentURL, inventoryURL string, httpClient *http.Client) *API {
	return &API{
		jaeger:       client,
		gatewayURL:   strings.TrimRight(gatewayURL, "/"),
		paymentURL:   strings.TrimRight(paymentURL, "/"),
		inventoryURL: strings.TrimRight(inventoryURL, "/"),
		httpClient:   httpClient,
	}
}

func (a *API) Handler(allowedOrigins []string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/overview", a.overview)
	mux.HandleFunc("GET /api/services", a.services)
	mux.HandleFunc("GET /api/traces", a.traces)
	mux.HandleFunc("GET /api/traces/{traceID}", a.trace)
	mux.HandleFunc("GET /api/dependencies", a.dependencies)
	mux.HandleFunc("POST /api/demo/checkout", a.checkout)
	mux.HandleFunc("GET /api/demo/config", a.getDemoConfig)
	mux.HandleFunc("PUT /api/demo/config", a.putDemoConfig)

	return cors(mux, allowedOrigins)
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	_, err := a.jaeger.Services(r.Context())
	if err != nil {
		log.Printf("health check: Jaeger unavailable: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":          "degraded",
			"service":         "traceflow-api",
			"jaegerReachable": false,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":          "ok",
		"service":         "traceflow-api",
		"jaegerReachable": true,
	})
}

func (a *API) services(w http.ResponseWriter, r *http.Request) {
	names, err := a.jaeger.Services(r.Context())
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	nodes := make([]models.ServiceNode, 0, len(names))
	sort.Strings(names)
	for _, name := range names {
		if strings.EqualFold(name, "jaeger") {
			continue
		}
		nodes = append(nodes, models.ServiceNode{
			ID:     name,
			Name:   name,
			Status: "unknown",
		})
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (a *API) traces(w http.ResponseWriter, r *http.Request) {
	limit := defaultTraceLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > jaeger.MaxSearchDepth() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 1000"})
			return
		}
		limit = parsed
	}

	filter := r.URL.Query().Get("tags")
	if filter != "" && !json.Valid([]byte(filter)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tags must be a Jaeger v3 structured filter encoded as JSON"})
		return
	}
	service := r.URL.Query().Get("service")
	if strings.EqualFold(service, "jaeger") {
		writeJSON(w, http.StatusOK, []models.TraceSummary{})
		return
	}
	found, err := a.jaeger.FindTraces(r.Context(), service, filter, limit)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	summaries := make([]models.TraceSummary, 0, len(found))
	for _, item := range found {
		summaries = append(summaries, jaeger.Summarize(item))
	}
	writeJSON(w, http.StatusOK, summaries)
}

func (a *API) trace(w http.ResponseWriter, r *http.Request) {
	traceID := r.PathValue("traceID")
	if !validTraceID(traceID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trace ID must be 16 or 32 hexadecimal characters"})
		return
	}
	item, err := a.jaeger.Trace(r.Context(), traceID)
	if err != nil {
		if errors.Is(err, jaeger.ErrTraceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "trace not found"})
			return
		}
		writeUpstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) overview(w http.ResponseWriter, r *http.Request) {
	names, err := a.jaeger.Services(r.Context())
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	names = applicationServiceNames(names)
	found, err := a.jaeger.FindTraces(r.Context(), "", "", overviewTraceLimit)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}

	summaries := make([]models.TraceSummary, 0, len(found))
	var durationTotal float64
	errorCount := 0
	for _, item := range found {
		summary := jaeger.Summarize(item)
		summaries = append(summaries, summary)
		durationTotal += summary.DurationMs
		if summary.HasError {
			errorCount++
		}
	}
	sampleCount := len(summaries)
	partial := sampleCount == overviewTraceLimit

	result := models.Overview{
		ServiceCount:   len(names),
		RecentTraces:   summaries,
		SampleCount:    sampleCount,
		MetricsPartial: partial,
	}
	result.ErrorCount = &errorCount
	if !partial {
		total := sampleCount
		result.TotalTraces = &total
	}
	if sampleCount > 0 {
		average := durationTotal / float64(sampleCount)
		rate := float64(errorCount) / float64(sampleCount)
		result.AverageDurationMs = &average
		result.ErrorRate = &rate
	}
	if len(result.RecentTraces) > defaultTraceLimit {
		result.RecentTraces = result.RecentTraces[:defaultTraceLimit]
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) dependencies(w http.ResponseWriter, _ *http.Request) {
	names := []string{"gateway", "auth-service", "order-service", "payment-service", "inventory-service"}
	nodes := make([]models.ServiceNode, 0, len(names))
	for _, name := range names {
		nodes = append(nodes, models.ServiceNode{ID: name, Name: name, Status: "unknown"})
	}
	edges := []models.DependencyEdge{
		{ID: "gateway-auth-service", Source: "gateway", Target: "auth-service"},
		{ID: "auth-order-service", Source: "auth-service", Target: "order-service"},
		{ID: "order-payment-service", Source: "order-service", Target: "payment-service"},
		{ID: "order-inventory-service", Source: "order-service", Target: "inventory-service"},
	}
	writeJSON(w, http.StatusOK, models.Dependencies{
		DataSource: "static",
		Nodes:      nodes,
		Edges:      edges,
	})
}

func (a *API) checkout(w http.ResponseWriter, r *http.Request) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.gatewayURL+"/checkout", nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create Gateway request"})
		return
	}
	resp, err := a.httpClient.Do(req)
	if err != nil {
		log.Printf("demo checkout: Gateway request failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Gateway service unavailable"})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRequestBody))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read Gateway response"})
		return
	}

	var gatewayResponse any
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &gatewayResponse); err != nil {
			gatewayResponse = string(body)
		}
	}
	result := models.CheckoutResult{
		Success:           resp.StatusCode >= 200 && resp.StatusCode < 300,
		GatewayStatusCode: resp.StatusCode,
		TraceID:           traceIDFromContext(r.Context()),
		GatewayResponse:   gatewayResponse,
	}
	if result.Success {
		result.Message = "checkout completed"
	} else {
		result.Error = "checkout failed"
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) getDemoConfig(w http.ResponseWriter, r *http.Request) {
	var config models.DemoConfig
	if err := a.getServiceJSON(r.Context(), a.paymentURL+"/config", &config.Payment); err != nil {
		writeServiceError(w, "Payment", err)
		return
	}
	if err := a.getServiceJSON(r.Context(), a.inventoryURL+"/config", &config.Inventory); err != nil {
		writeServiceError(w, "Inventory", err)
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (a *API) putDemoConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Payment *struct {
			DelayMs *int  `json:"delayMs"`
			Failure *bool `json:"failure"`
		} `json:"payment"`
		Inventory *struct {
			DelayMs *int `json:"delayMs"`
		} `json:"inventory"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxRequestBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid simulator configuration"})
		return
	}
	if err := ensureJSONEOF(decoder); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request must contain one JSON object"})
		return
	}
	if input.Payment == nil || input.Payment.DelayMs == nil || input.Payment.Failure == nil ||
		input.Inventory == nil || input.Inventory.DelayMs == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payment.delayMs, payment.failure, and inventory.delayMs are required"})
		return
	}
	if !oneOf(*input.Payment.DelayMs, 0, 500, 1500, 3000) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payment delay must be 0, 500, 1500, or 3000 ms"})
		return
	}
	if !oneOf(*input.Inventory.DelayMs, 0, 500, 1500) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "inventory delay must be 0, 500, or 1500 ms"})
		return
	}

	previous, err := a.readDemoConfig(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	paymentBody := map[string]any{"delayMs": *input.Payment.DelayMs, "failure": *input.Payment.Failure}
	if err := a.postServiceJSON(r.Context(), a.paymentURL+"/config", paymentBody); err != nil {
		writeServiceError(w, "Payment", err)
		return
	}
	inventoryBody := map[string]any{"delayMs": *input.Inventory.DelayMs}
	if err := a.postServiceJSON(r.Context(), a.inventoryURL+"/config", inventoryBody); err != nil {
		rollbackErr := a.postServiceJSON(r.Context(), a.paymentURL+"/config", map[string]any{
			"delayMs": previous.Payment.DelayMs,
			"failure": previous.Payment.Failure,
		})
		if rollbackErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{
				"error": fmt.Sprintf("Inventory update failed (%v); restoring Payment configuration also failed (%v)", err, rollbackErr),
			})
			return
		}
		writeServiceError(w, "Inventory", err)
		return
	}
	writeJSON(w, http.StatusOK, models.DemoConfig{
		Payment:   models.PaymentConfig{DelayMs: *input.Payment.DelayMs, Failure: *input.Payment.Failure},
		Inventory: models.InventoryConfig{DelayMs: *input.Inventory.DelayMs},
	})
}

func (a *API) readDemoConfig(ctx context.Context) (models.DemoConfig, error) {
	var config models.DemoConfig
	if err := a.getServiceJSON(ctx, a.paymentURL+"/config", &config.Payment); err != nil {
		return config, fmt.Errorf("read current Payment configuration: %w", err)
	}
	if err := a.getServiceJSON(ctx, a.inventoryURL+"/config", &config.Inventory); err != nil {
		return config, fmt.Errorf("read current Inventory configuration: %w", err)
	}
	return config, nil
}

func (a *API) getServiceJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	return a.doServiceJSON(req, target)
}

func (a *API) postServiceJSON(ctx context.Context, endpoint string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return a.doServiceJSON(req, nil)
}

func (a *API) doServiceJSON(req *http.Request, target any) error {
	req.Header.Set("Accept", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("service request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRequestBody))
	if err != nil {
		return fmt.Errorf("read service response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("service returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if target == nil {
		return nil
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("decode service response: %w", err)
	}
	return nil
}

func writeServiceError(w http.ResponseWriter, name string, err error) {
	log.Printf("%s service request failed: %v", name, err)
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("%s service unavailable: %v", name, err)})
}

func writeUpstreamError(w http.ResponseWriter, err error) {
	log.Printf("Jaeger query failed: %v", err)
	status := http.StatusBadGateway
	var upstream *jaeger.UpstreamError
	if errors.As(err, &upstream) && upstream.StatusCode == http.StatusServiceUnavailable {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write JSON response failed: %v", err)
	}
}

func validTraceID(value string) bool {
	if len(value) != 16 && len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func traceIDFromContext(ctx context.Context) string {
	spanContext := trace.SpanFromContext(ctx).SpanContext()
	if !spanContext.IsValid() {
		return ""
	}
	return spanContext.TraceID().String()
}

func oneOf(value int, allowed ...int) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("unexpected trailing data")
	}
	return nil
}

func cors(next http.Handler, allowedOrigins []string) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[strings.TrimSpace(origin)] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := allowed[origin]; ok && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ParseAllowedOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, origin := range parts {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

func applicationServiceNames(names []string) []string {
	filtered := make([]string, 0, len(names))
	for _, name := range names {
		if name != "" && !strings.EqualFold(name, "jaeger") {
			filtered = append(filtered, name)
		}
	}
	return filtered
}

func ValidateServiceURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid service URL %q", raw)
	}
	return nil
}
