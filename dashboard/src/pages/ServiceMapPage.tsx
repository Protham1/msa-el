import { useCallback, useEffect, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { X } from "lucide-react";
import { api } from "../api/client";
import type { DependencyEdge, ServiceNode } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

const STATIC_NODES: ServiceNode[] = [
  { id: "gateway", name: "Gateway", status: "unknown" },
  { id: "auth-service", name: "Auth", status: "unknown" },
  { id: "order-service", name: "Order", status: "unknown" },
  { id: "payment-service", name: "Payment", status: "unknown" },
  { id: "inventory-service", name: "Inventory", status: "unknown" },
];

const STATIC_EDGES: DependencyEdge[] = [
  { id: "gateway-auth", source: "gateway", target: "auth-service" },
  { id: "auth-order", source: "auth-service", target: "order-service" },
  { id: "order-payment", source: "order-service", target: "payment-service" },
  { id: "order-inventory", source: "order-service", target: "inventory-service" },
];

export default function ServiceMapPage({ refreshKey, onDataStatus }: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<ServiceNode | null>(null);
  const [dataSource, setDataSource] = useState<"static" | "telemetry">("static");
  const [sourceMessage, setSourceMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.dependencies();
      const serviceNodes = data.nodes?.length ? data.nodes : STATIC_NODES;
      const dependencyEdges = data.edges?.length ? data.edges : STATIC_EDGES;
      setNodes(toFlowNodes(serviceNodes));
      setEdges(toFlowEdges(dependencyEdges));
      setDataSource(data.dataSource || "static");
      setSourceMessage(data.message || "");
      onDataStatus("live");
    } catch (err) {
      setNodes(toFlowNodes(STATIC_NODES));
      setEdges(toFlowEdges(STATIC_EDGES));
      setDataSource("static");
      setSourceMessage("");
      setError(err instanceof Error ? err.message : "Could not reach the dependency API.");
      onDataStatus("unavailable");
    } finally {
      setLoading(false);
    }
  }, [onDataStatus]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <LoadingState label="Loading service topology" />;

  return (
    <div className={`map-layout ${selected ? "has-selection" : ""}`}>
      <section className="map-canvas">
        {error && (
          <div className="map-alert">
            <span>{error}</span>
            <button onClick={load}>Retry</button>
          </div>
        )}
        <div className="map-source">
          <i className={dataSource === "telemetry" ? "live" : "static"} />
          {sourceMessage || (dataSource === "telemetry" ? "Telemetry-derived topology" : "Static demo topology")}
        </div>
        {nodes.length === 0 ? (
          <EmptyState title="No service topology" message="The API has not returned nodes or edges." />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2, minZoom: 0.75, maxZoom: 1.25 }}
            onNodeClick={(_, node) => setSelected({
              id: String(node.id),
              name: String(node.data.label),
              status: node.data.status as ServiceNode["status"],
              averageLatencyMs: node.data.averageLatencyMs as number | null | undefined,
              requestCount: node.data.requestCount as number | null | undefined,
            })}
          >
            <Background gap={18} size={1} color="#1b2a3e" />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        )}
        <div className="map-legend">
          <span><i className="healthy" />Healthy</span>
          <span><i className="degraded" />Degraded</span>
          <span><i className="unknown" />Unknown</span>
        </div>
      </section>

      {selected && (
        <aside className="node-panel">
          <button className="close-button" onClick={() => setSelected(null)}><X size={16} /></button>
          <span className="section-kicker">SERVICE DETAILS</span>
          <h2>{selected.name}</h2>
          <div className={`detail-status ${selected.status}`}>
            <i /> {selected.status}
          </div>
          <dl>
            <div><dt>Average latency</dt><dd>{selected.averageLatencyMs != null ? `${formatMs(selected.averageLatencyMs)} ms` : "Unavailable"}</dd></div>
            <div><dt>Recent requests</dt><dd>{selected.requestCount != null ? selected.requestCount : "Unavailable"}</dd></div>
          </dl>
          <p>Recent related traces are available from the Trace Explorer once trace data is loaded.</p>
        </aside>
      )}
    </div>
  );
}

function toFlowNodes(services: ServiceNode[]): Node[] {
  const positions: Record<string, { x: number; y: number }> = {
    "traceflow-api": { x: 300, y: -110 },
    gateway: { x: 300, y: 20 },
    "auth-service": { x: 300, y: 150 },
    "order-service": { x: 300, y: 280 },
    "payment-service": { x: 130, y: 420 },
    "inventory-service": { x: 470, y: 420 },
  };
  return services.map((service, index) => ({
    id: service.id,
    position: positions[service.id] || {
      x: 130 + (index % 3) * 170,
      y: 150 + Math.floor(index / 3) * 130,
    },
    data: {
      label: displayServiceName(service.name),
      status: service.status,
      averageLatencyMs: service.averageLatencyMs,
      requestCount: service.requestCount,
    },
    className: `service-flow-node ${service.status}`,
  }));
}

function displayServiceName(name: string) {
  const knownNames: Record<string, string> = {
    "traceflow-api": "TraceFlow API",
    gateway: "Gateway",
    "auth-service": "Auth",
    "order-service": "Order",
    "payment-service": "Payment",
    "inventory-service": "Inventory",
  };
  return knownNames[name] || name.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toFlowEdges(edges: DependencyEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.averageLatencyMs != null ? `${formatMs(edge.averageLatencyMs)} ms` : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#7a96b8" },
    style: { stroke: "#516886", strokeWidth: 1.5 },
  }));
}

function formatMs(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
