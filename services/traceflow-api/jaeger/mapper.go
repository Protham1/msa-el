package jaeger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"traceflow/traceflow-api/models"
)

type traceEnvelope struct {
	Result traceData `json:"result"`
}

type traceData struct {
	ResourceSpans []resourceSpans `json:"resourceSpans"`
}

type resourceSpans struct {
	Resource struct {
		Attributes []keyValue `json:"attributes"`
	} `json:"resource"`
	ScopeSpans []scopeSpans `json:"scopeSpans"`
}

type scopeSpans struct {
	Scope struct {
		Name string `json:"name"`
	} `json:"scope"`
	Spans []otlpSpan `json:"spans"`
}

type keyValue struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

type otlpSpan struct {
	TraceID           string      `json:"traceId"`
	SpanID            string      `json:"spanId"`
	ParentSpanID      string      `json:"parentSpanId"`
	Name              string      `json:"name"`
	StartTimeUnixNano string      `json:"startTimeUnixNano"`
	EndTimeUnixNano   string      `json:"endTimeUnixNano"`
	Attributes        []keyValue  `json:"attributes"`
	Events            []otlpEvent `json:"events"`
	Status            struct {
		Code    int32  `json:"code"`
		Message string `json:"message"`
	} `json:"status"`
}

type otlpEvent struct {
	Name         string     `json:"name"`
	TimeUnixNano string     `json:"timeUnixNano"`
	Attributes   []keyValue `json:"attributes"`
}

type mappedSpan struct {
	span      models.Span
	startNano int64
	endNano   int64
	hasError  bool
}

func mapTraceData(data traceData) ([]models.TraceDetail, error) {
	groups := make(map[string][]mappedSpan)
	for _, resource := range data.ResourceSpans {
		resourceService := attributeString(resource.Resource.Attributes, "service.name")
		for _, scope := range resource.ScopeSpans {
			service := resourceService
			if service == "" {
				service = scope.Scope.Name
			}
			for _, rawSpan := range scope.Spans {
				span, err := mapSpan(rawSpan, service)
				if err != nil {
					return nil, err
				}
				groups[rawSpan.TraceID] = append(groups[rawSpan.TraceID], span)
			}
		}
	}

	traces := make([]models.TraceDetail, 0, len(groups))
	for traceID, spans := range groups {
		trace, err := makeTrace(traceID, spans)
		if err != nil {
			return nil, err
		}
		traces = append(traces, trace)
	}
	sort.Slice(traces, func(i, j int) bool {
		return traceStartedAfter(traces[i].StartTime, traces[j].StartTime)
	})
	return traces, nil
}

func traceStartedAfter(left, right string) bool {
	leftTime, leftErr := time.Parse(time.RFC3339Nano, left)
	rightTime, rightErr := time.Parse(time.RFC3339Nano, right)
	if leftErr == nil && rightErr == nil {
		return leftTime.After(rightTime)
	}
	return left > right
}

func Summarize(trace models.TraceDetail) models.TraceSummary {
	spanIDs := make(map[string]struct{}, len(trace.Spans))
	for _, span := range trace.Spans {
		spanIDs[span.SpanID] = struct{}{}
	}
	var roots []models.Span
	serviceSet := make(map[string]struct{})
	hasError := false
	for _, span := range trace.Spans {
		if span.ParentSpanID == "" {
			roots = append(roots, span)
		} else if _, exists := spanIDs[span.ParentSpanID]; !exists {
			roots = append(roots, span)
		}
		serviceSet[span.ServiceName] = struct{}{}
		hasError = hasError || span.Status == models.SpanStatusError
	}
	if len(roots) == 0 && len(trace.Spans) > 0 {
		roots = append(roots, trace.Spans[0])
	}
	sort.Slice(roots, func(i, j int) bool {
		left, _ := strconv.ParseInt(roots[i].StartTimeUnixNano, 10, 64)
		right, _ := strconv.ParseInt(roots[j].StartTimeUnixNano, 10, 64)
		return left < right
	})

	serviceNames := make([]string, 0, len(serviceSet))
	for name := range serviceSet {
		serviceNames = append(serviceNames, name)
	}
	sort.Strings(serviceNames)

	rootOperation, rootService := "", ""
	if len(roots) > 0 {
		rootOperation, rootService = roots[0].OperationName, roots[0].ServiceName
	}
	return models.TraceSummary{
		TraceID:       trace.TraceID,
		RootOperation: rootOperation,
		RootService:   rootService,
		StartTime:     trace.StartTime,
		DurationMs:    trace.DurationMs,
		SpanCount:     len(trace.Spans),
		ServiceNames:  serviceNames,
		HasError:      hasError,
	}
}

func mapSpan(raw otlpSpan, service string) (mappedSpan, error) {
	if raw.TraceID == "" || raw.SpanID == "" {
		return mappedSpan{}, fmt.Errorf("Jaeger returned a span without a trace or span ID")
	}
	start, err := strconv.ParseInt(raw.StartTimeUnixNano, 10, 64)
	if err != nil {
		return mappedSpan{}, fmt.Errorf("invalid startTimeUnixNano on span %s: %w", raw.SpanID, err)
	}
	end, err := strconv.ParseInt(raw.EndTimeUnixNano, 10, 64)
	if err != nil || end < start {
		return mappedSpan{}, fmt.Errorf("invalid endTimeUnixNano on span %s", raw.SpanID)
	}

	attributes, err := mapAttributes(raw.Attributes)
	if err != nil {
		return mappedSpan{}, fmt.Errorf("map attributes on span %s: %w", raw.SpanID, err)
	}
	events := make([]models.SpanEvent, 0, len(raw.Events))
	for _, event := range raw.Events {
		eventAttributes, err := mapAttributes(event.Attributes)
		if err != nil {
			return mappedSpan{}, fmt.Errorf("map event attributes on span %s: %w", raw.SpanID, err)
		}
		events = append(events, models.SpanEvent{
			Name:         event.Name,
			TimeUnixNano: event.TimeUnixNano,
			Attributes:   eventAttributes,
		})
	}

	status := models.SpanStatusUnset
	if raw.Status.Code == 1 {
		status = models.SpanStatusOK
	} else if raw.Status.Code == 2 {
		status = models.SpanStatusError
	}
	if attributesIndicateError(attributes) {
		status = models.SpanStatusError
	}

	return mappedSpan{
		span: models.Span{
			SpanID:            raw.SpanID,
			ParentSpanID:      raw.ParentSpanID,
			ServiceName:       service,
			OperationName:     raw.Name,
			StartTimeUnixNano: raw.StartTimeUnixNano,
			DurationMs:        float64(end-start) / float64(time.Millisecond),
			Status:            status,
			Attributes:        attributes,
			Events:            events,
		},
		startNano: start,
		endNano:   end,
		hasError:  status == models.SpanStatusError,
	}, nil
}

func makeTrace(traceID string, spans []mappedSpan) (models.TraceDetail, error) {
	if traceID == "" || len(spans) == 0 {
		return models.TraceDetail{}, fmt.Errorf("Jaeger returned an empty trace")
	}
	start, end := spans[0].startNano, spans[0].endNano
	for _, span := range spans {
		if span.startNano < start {
			start = span.startNano
		}
		if span.endNano > end {
			end = span.endNano
		}
	}

	mappedSpans := make([]models.Span, 0, len(spans))
	for _, span := range spans {
		mappedSpans = append(mappedSpans, span.span)
	}
	sort.Slice(mappedSpans, func(i, j int) bool {
		left, _ := strconv.ParseInt(mappedSpans[i].StartTimeUnixNano, 10, 64)
		right, _ := strconv.ParseInt(mappedSpans[j].StartTimeUnixNano, 10, 64)
		return left < right
	})

	return models.TraceDetail{
		TraceID:    traceID,
		DurationMs: float64(end-start) / float64(time.Millisecond),
		StartTime:  time.Unix(0, start).UTC().Format(time.RFC3339Nano),
		Spans:      mappedSpans,
	}, nil
}

func mapAttributes(attributes []keyValue) (map[string]any, error) {
	result := make(map[string]any, len(attributes))
	for _, attribute := range attributes {
		value, err := decodeAnyValue(attribute.Value)
		if err != nil {
			return nil, fmt.Errorf("decode %q: %w", attribute.Key, err)
		}
		result[attribute.Key] = value
	}
	return result, nil
}

func decodeAnyValue(raw json.RawMessage) (any, error) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	for _, key := range []string{"stringValue", "boolValue", "intValue", "doubleValue", "bytesValue"} {
		value, exists := values[key]
		if !exists {
			continue
		}
		if key == "intValue" {
			var encoded string
			if err := json.Unmarshal(value, &encoded); err == nil {
				return json.Number(encoded), nil
			}
		}
		var decoded any
		decoder := json.NewDecoder(bytes.NewReader(value))
		decoder.UseNumber()
		if err := decoder.Decode(&decoded); err != nil {
			return nil, err
		}
		return decoded, nil
	}
	if array, exists := values["arrayValue"]; exists {
		var container struct {
			Values []json.RawMessage `json:"values"`
		}
		if err := json.Unmarshal(array, &container); err != nil {
			return nil, err
		}
		result := make([]any, 0, len(container.Values))
		for _, item := range container.Values {
			decoded, err := decodeAnyValue(item)
			if err != nil {
				return nil, err
			}
			result = append(result, decoded)
		}
		return result, nil
	}
	if list, exists := values["kvlistValue"]; exists {
		var container struct {
			Values []keyValue `json:"values"`
		}
		if err := json.Unmarshal(list, &container); err != nil {
			return nil, err
		}
		return mapAttributes(container.Values)
	}
	return nil, nil
}

func attributeString(attributes []keyValue, name string) string {
	for _, attribute := range attributes {
		if attribute.Key != name {
			continue
		}
		value, err := decodeAnyValue(attribute.Value)
		if err != nil {
			return ""
		}
		text, _ := value.(string)
		return text
	}
	return ""
}

func attributesIndicateError(attributes map[string]any) bool {
	if value, ok := attributes["error"].(bool); ok && value {
		return true
	}
	status, ok := attributes["http.response.status_code"]
	if !ok {
		return false
	}
	switch value := status.(type) {
	case json.Number:
		code, err := value.Int64()
		return err == nil && code >= 500
	case float64:
		return value >= 500 && !math.IsNaN(value)
	case string:
		code, err := strconv.Atoi(value)
		return err == nil && code >= 500
	}
	return false
}
