import type { CheckoutResult, DemoConfig, DependencyEdge, Overview, ServiceNode, TraceDetail, TraceSummary } from "../types/tracing";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8090";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  services: () => request<ServiceNode[]>("/api/services"),
  traces: (params: URLSearchParams) => request<TraceSummary[]>(`/api/traces${params.toString() ? `?${params}` : ""}`),
  trace: (traceId: string) => request<TraceDetail>(`/api/traces/${encodeURIComponent(traceId)}`),
  dependencies: () => request<{
    dataSource: "static" | "telemetry";
    message?: string;
    nodes: ServiceNode[];
    edges: DependencyEdge[];
  }>("/api/dependencies"),
  checkout: () => request<CheckoutResult>("/api/demo/checkout", { method: "POST" }),
  getConfig: () => request<DemoConfig>("/api/demo/config"),
  updateConfig: (config: DemoConfig) => request<DemoConfig>("/api/demo/config", {
    method: "PUT",
    body: JSON.stringify(config),
  }),
};
