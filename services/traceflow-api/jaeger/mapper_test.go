package jaeger

import (
	"encoding/json"
	"testing"

	"traceflow/traceflow-api/models"
)

func TestMapTraceDataGroupsResourcesAndDerivesRootAndErrors(t *testing.T) {
	payload := `{
	  "result": {
	    "resourceSpans": [
	      {
	        "resource": {"attributes":[{"key":"service.name","value":{"stringValue":"payment-service"}}]},
	        "scopeSpans": [{"spans":[{
	          "traceId":"0123456789abcdef0123456789abcdef",
	          "spanId":"2222222222222222",
	          "parentSpanId":"1111111111111111",
	          "name":"payment.charge",
	          "startTimeUnixNano":"2000000",
	          "endTimeUnixNano":"6000000",
	          "status":{"code":2,"message":"payment failed"},
	          "attributes":[{"key":"http.response.status_code","value":{"intValue":"500"}}],
	          "events":[{"name":"exception","timeUnixNano":"3000000","attributes":[
	            {"key":"exception.message","value":{"stringValue":"declined"}}
	          ]}]
	        }]}]
	      },
	      {
	        "resource": {"attributes":[{"key":"service.name","value":{"stringValue":"gateway"}}]},
	        "scopeSpans": [{"spans":[{
	          "traceId":"0123456789abcdef0123456789abcdef",
	          "spanId":"1111111111111111",
	          "name":"POST /checkout",
	          "startTimeUnixNano":"1000000",
	          "endTimeUnixNano":"6000000",
	          "status":{"code":1}
	        }]}]
	      }
	    ]
	  }
	}`

	var response traceEnvelope
	if err := json.Unmarshal([]byte(payload), &response); err != nil {
		t.Fatal(err)
	}
	traces, err := mapTraceData(response.Result)
	if err != nil {
		t.Fatal(err)
	}
	if len(traces) != 1 {
		t.Fatalf("got %d traces, want 1", len(traces))
	}

	trace := traces[0]
	if trace.DurationMs != 5 {
		t.Errorf("duration = %v ms, want 5", trace.DurationMs)
	}
	if len(trace.Spans) != 2 {
		t.Fatalf("got %d spans, want 2", len(trace.Spans))
	}
	summary := Summarize(trace)
	if summary.RootOperation != "POST /checkout" || summary.RootService != "gateway" {
		t.Errorf("root = %s/%s, want POST /checkout/gateway", summary.RootOperation, summary.RootService)
	}
	if !summary.HasError {
		t.Error("summary did not identify the failed Payment span")
	}
	if summary.SpanCount != 2 || len(summary.ServiceNames) != 2 {
		t.Errorf("summary counts = %d spans, %d services", summary.SpanCount, len(summary.ServiceNames))
	}

	var payment models.Span
	for _, span := range trace.Spans {
		if span.ServiceName == "payment-service" {
			payment = span
		}
	}
	if payment.Status != models.SpanStatusError {
		t.Errorf("Payment status = %q, want error", payment.Status)
	}
	if payment.Attributes["http.response.status_code"] != json.Number("500") {
		t.Errorf("Payment HTTP status attribute = %#v", payment.Attributes["http.response.status_code"])
	}
	if len(payment.Events) != 1 || payment.Events[0].Name != "exception" {
		t.Errorf("Payment events = %#v", payment.Events)
	}
}

func TestMapTraceDataUsesAttributesForErrorStatus(t *testing.T) {
	payload := `{
	  "resourceSpans":[{
	    "resource":{"attributes":[{"key":"service.name","value":{"stringValue":"gateway"}}]},
	    "scopeSpans":[{"spans":[{
	      "traceId":"0123456789abcdef",
	      "spanId":"1111111111111111",
	      "name":"request",
	      "startTimeUnixNano":"100",
	      "endTimeUnixNano":"200",
	      "attributes":[{"key":"http.response.status_code","value":{"intValue":"503"}}]
	    }]}]
	  }]
	}`
	var data traceData
	if err := json.Unmarshal([]byte(payload), &data); err != nil {
		t.Fatal(err)
	}
	traces, err := mapTraceData(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := Summarize(traces[0]).HasError; !got {
		t.Error("trace with HTTP 503 was not marked as an error")
	}
}
