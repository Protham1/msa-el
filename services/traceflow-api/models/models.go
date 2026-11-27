package models

type SpanStatus string

const (
	SpanStatusOK    SpanStatus = "ok"
	SpanStatusError SpanStatus = "error"
	SpanStatusUnset SpanStatus = "unset"
)

type TraceSummary struct {
	TraceID       string   `json:"traceId"`
	RootOperation string   `json:"rootOperation"`
	RootService   string   `json:"rootService"`
	StartTime     string   `json:"startTime"`
	DurationMs    float64  `json:"durationMs"`
	SpanCount     int      `json:"spanCount"`
	ServiceNames  []string `json:"serviceNames"`
	HasError      bool     `json:"hasError"`
}

type Span struct {
	SpanID            string         `json:"spanId"`
	ParentSpanID      string         `json:"parentSpanId,omitempty"`
	ServiceName       string         `json:"serviceName"`
	OperationName     string         `json:"operationName"`
	StartTimeUnixNano string         `json:"startTimeUnixNano"`
	DurationMs        float64        `json:"durationMs"`
	Status            SpanStatus     `json:"status"`
	Attributes        map[string]any `json:"attributes"`
	Events            []SpanEvent    `json:"events"`
}

type SpanEvent struct {
	Name         string         `json:"name"`
	TimeUnixNano string         `json:"timeUnixNano"`
	Attributes   map[string]any `json:"attributes"`
}

type TraceDetail struct {
	TraceID    string  `json:"traceId"`
	DurationMs float64 `json:"durationMs"`
	StartTime  string  `json:"startTime"`
	Spans      []Span  `json:"spans"`
}

type ServiceNode struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Status           string   `json:"status"`
	AverageLatencyMs *float64 `json:"averageLatencyMs"`
	RequestCount     *int     `json:"requestCount"`
}

type DependencyEdge struct {
	ID               string   `json:"id"`
	Source           string   `json:"source"`
	Target           string   `json:"target"`
	CallCount        *int     `json:"callCount"`
	AverageLatencyMs *float64 `json:"averageLatencyMs"`
}

type Dependencies struct {
	DataSource string           `json:"dataSource"`
	Nodes      []ServiceNode    `json:"nodes"`
	Edges      []DependencyEdge `json:"edges"`
}

type Overview struct {
	TotalTraces       *int           `json:"totalTraces"`
	AverageDurationMs *float64       `json:"averageDurationMs"`
	ErrorCount        *int           `json:"errorCount"`
	ErrorRate         *float64       `json:"errorRate"`
	ServiceCount      int            `json:"serviceCount"`
	RecentTraces      []TraceSummary `json:"recentTraces"`
	SampleCount       int            `json:"sampleCount"`
	MetricsPartial    bool           `json:"metricsPartial"`
}

type DemoConfig struct {
	Payment   PaymentConfig   `json:"payment"`
	Inventory InventoryConfig `json:"inventory"`
}

type PaymentConfig struct {
	DelayMs int  `json:"delayMs"`
	Failure bool `json:"failure"`
}

type InventoryConfig struct {
	DelayMs int `json:"delayMs"`
}

type CheckoutResult struct {
	Success           bool   `json:"success"`
	GatewayStatusCode int    `json:"gatewayStatusCode"`
	Message           string `json:"message,omitempty"`
	TraceID           string `json:"traceId,omitempty"`
	GatewayResponse   any    `json:"gatewayResponse,omitempty"`
	Error             string `json:"error,omitempty"`
}
