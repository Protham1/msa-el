package handlers

import (
	"testing"

	"traceflow/traceflow-api/models"
)

func TestIsCheckoutTraceFiltersDemoControlRequests(t *testing.T) {
	tests := []struct {
		name    string
		summary models.TraceSummary
		want    bool
	}{
		{
			name:    "direct Gateway checkout",
			summary: models.TraceSummary{RootService: "gateway", RootOperation: "POST /checkout"},
			want:    true,
		},
		{
			name:    "API-triggered checkout",
			summary: models.TraceSummary{RootService: "traceflow-api", RootOperation: "POST /api/demo/checkout"},
			want:    true,
		},
		{
			name:    "simulator configuration request",
			summary: models.TraceSummary{RootService: "traceflow-api", RootOperation: "PUT /api/demo/config"},
			want:    false,
		},
		{
			name:    "health request",
			summary: models.TraceSummary{RootService: "gateway", RootOperation: "GET /health"},
			want:    false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isCheckoutTrace(test.summary); got != test.want {
				t.Errorf("isCheckoutTrace() = %t, want %t", got, test.want)
			}
		})
	}
}
