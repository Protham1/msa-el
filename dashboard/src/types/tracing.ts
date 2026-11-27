export type SpanStatus = "ok" | "error" | "unset";

export interface TraceSummary {
  traceId: string;
  rootOperation: string;
  rootService: string;
  startTime: string;
  durationMs: number;
  spanCount: number;
  serviceNames: string[];
  hasError: boolean;
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  startTimeUnixNano: string;
  durationMs: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: unknown[];
}

export interface TraceDetail {
  traceId: string;
  durationMs: number;
  startTime: string;
  spans: Span[];
}

export interface ServiceNode {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "unknown";
  averageLatencyMs?: number | null;
  requestCount?: number | null;
}

export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  callCount?: number | null;
  averageLatencyMs?: number | null;
}

export interface Overview {
  totalTraces?: number | null;
  averageDurationMs?: number | null;
  errorCount?: number | null;
  errorRate?: number | null;
  serviceCount?: number | null;
  recentTraces: TraceSummary[];
}

export interface DemoConfig {
  payment: { delayMs: number; failure: boolean };
  inventory: { delayMs: number };
}

export interface CheckoutResult {
  status?: string;
  success?: boolean;
  message?: string;
  traceId?: string | null;
  gatewayResponse?: unknown;
  error?: string;
  [key: string]: unknown;
}
