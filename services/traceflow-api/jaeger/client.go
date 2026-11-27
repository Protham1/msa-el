package jaeger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"traceflow/traceflow-api/models"
)

const (
	defaultLookback = 24 * time.Hour
	maxSearchDepth  = 1000
)

func MaxSearchDepth() int {
	return maxSearchDepth
}

var ErrTraceNotFound = errors.New("trace not found")

type UpstreamError struct {
	StatusCode int
	Message    string
}

func (e *UpstreamError) Error() string {
	return e.Message
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) (*Client, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid JAEGER_QUERY_URL %q", baseURL)
	}

	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Timeout: 6 * time.Second,
		},
	}, nil
}

func (c *Client) Services(ctx context.Context) ([]string, error) {
	var response struct {
		Services []string `json:"services"`
	}
	if err := c.getJSON(ctx, "/api/v3/services", nil, &response); err != nil {
		return nil, err
	}
	return response.Services, nil
}

func (c *Client) FindTraces(ctx context.Context, service, filter string, limit int) ([]models.TraceDetail, error) {
	if limit < 1 || limit > maxSearchDepth {
		return nil, fmt.Errorf("limit must be between 1 and %d", maxSearchDepth)
	}

	if service != "" {
		return c.findTracesForService(ctx, service, filter, limit)
	}

	services, err := c.Services(ctx)
	if err != nil {
		return nil, err
	}
	type result struct {
		traces []models.TraceDetail
		err    error
	}
	results := make(chan result, len(services))
	var workers sync.WaitGroup
	for _, name := range services {
		if name == "" || strings.EqualFold(name, "jaeger") {
			continue
		}
		workers.Add(1)
		go func(serviceName string) {
			defer workers.Done()
			found, err := c.findTracesForService(ctx, serviceName, filter, limit)
			results <- result{traces: found, err: err}
		}(name)
	}
	go func() {
		workers.Wait()
		close(results)
	}()

	byID := make(map[string]models.TraceDetail)
	for result := range results {
		if result.err != nil {
			return nil, result.err
		}
		for _, trace := range result.traces {
			byID[trace.TraceID] = trace
		}
	}
	traces := make([]models.TraceDetail, 0, len(byID))
	for _, trace := range byID {
		traces = append(traces, trace)
	}
	sort.Slice(traces, func(i, j int) bool {
		return traceStartedAfter(traces[i].StartTime, traces[j].StartTime)
	})
	if len(traces) > limit {
		traces = traces[:limit]
	}
	return traces, nil
}

func (c *Client) findTracesForService(ctx context.Context, service, filter string, limit int) ([]models.TraceDetail, error) {
	now := time.Now().UTC()
	query := url.Values{}
	query.Set("query.startTimeMin", now.Add(-defaultLookback).Format(time.RFC3339Nano))
	query.Set("query.startTimeMax", now.Format(time.RFC3339Nano))
	query.Set("query.searchDepth", strconv.Itoa(limit))
	query.Set("query.serviceName", service)
	if filter != "" {
		query.Set("query.filter", filter)
	}

	var response traceEnvelope
	if err := c.getJSON(ctx, "/api/v3/traces", query, &response); err != nil {
		return nil, err
	}
	return mapTraceData(response.Result)
}

func (c *Client) Trace(ctx context.Context, traceID string) (models.TraceDetail, error) {
	var response traceEnvelope
	if err := c.getJSON(ctx, "/api/v3/traces/"+url.PathEscape(traceID), nil, &response); err != nil {
		var upstream *UpstreamError
		if errors.As(err, &upstream) && upstream.StatusCode == http.StatusNotFound {
			return models.TraceDetail{}, ErrTraceNotFound
		}
		return models.TraceDetail{}, err
	}
	traces, err := mapTraceData(response.Result)
	if err != nil {
		return models.TraceDetail{}, err
	}
	for _, trace := range traces {
		if strings.EqualFold(trace.TraceID, traceID) {
			return trace, nil
		}
	}
	return models.TraceDetail{}, ErrTraceNotFound
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, target any) error {
	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create Jaeger request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return &UpstreamError{StatusCode: http.StatusBadGateway, Message: fmt.Sprintf("Jaeger query request failed: %v", err)}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return fmt.Errorf("read Jaeger response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return &UpstreamError{StatusCode: resp.StatusCode, Message: fmt.Sprintf("Jaeger returned %d: %s", resp.StatusCode, message)}
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("decode Jaeger response: %w", err)
	}
	return nil
}
