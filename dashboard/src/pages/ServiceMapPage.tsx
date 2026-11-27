import { useCallback, useEffect, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Server, X } from "lucide-react";
import { api } from "../api/client";
import type { DependencyEdge, ServiceNode } from "../types/tracing";
import { EmptyState, LoadingState } from "../components/States";
import { displayServiceName, formatLatency, formatMs, pluralize } from "../lib/format";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

type ServiceNodeData = {
  label: string;
  rawName: string;
  status: ServiceNode["status"];
  averageLatencyMs: number | null;
  requestCount: number | null;
  [key: string]: unknown;
};

const STATIC_NODES: ServiceNode[] = [
  { id: "gateway", name: "gateway", status: "unknown" },
  { id: "auth-service", name: "auth-service", status: "unknown" },
  { id: "order-service", name: "order-service", status: "unknown" },
  { id: "payment-service", name: "payment-service", status: "unknown" },
  { id: "inventory-service", name: "inventory-service", status: "unknown" },
];

const STATIC_EDGES: DependencyEdge[] = [
  { id: "gateway-auth", source: "gateway", target: "auth-service" },
  { id: "auth-order", source: "auth-service", target: "order-service" },
  { id: "order-payment", source: "order-service", target: "payment-service" },
  { id: "order-inventory", source: "order-service", target: "inventory-service" },
];

const NODE_TYPES = { service: ServiceFlowNode };

export default function ServiceMapPage({ refreshKey, onDataStatus }: Props) {
  const compact = useCompactLayout();
  const [nodes, setNodes] = useState<Node<ServiceNodeData>[]>([]);
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
      setNodes(toFlowNodes(serviceNodes, compact));
      setEdges(toFlowEdges(dependencyEdges));
      setDataSource(data.dataSource || "static");
      setSourceMessage(data.message || "");
      onDataStatus("live");
    } catch (err) {
      setNodes(toFlowNodes(STATIC_NODES, compact));
      setEdges(toFlowEdges(STATIC_EDGES));
      setDataSource("static");
      setSourceMessage("");
      setError(err instanceof Error ? err.message : "Could not reach the dependency API.");
      onDataStatus("unavailable");
    } finally {
      setLoading(false);
    }
  }, [compact, onDataStatus]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <LoadingState label="Loading service topology" variant="map" />;

  return (
    <div className={`map-layout ${selected ? "has-selection" : ""}`}>
      <section className="map-canvas">
        {error && (
          <div className="map-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => void load()}>Retry</button>
          </div>
        )}
        <div className="map-source">
          <i className={dataSource === "telemetry" ? "live" : "static"} />
          {sourceMessage || (dataSource === "telemetry" ? "Telemetry-derived topology" : "Static demo topology")}
        </div>
        <div className="map-hint">Click a service to inspect</div>
        {nodes.length === 0 ? (
          <EmptyState title="No service topology" message="The API has not returned nodes or edges." />
        ) : (
          <ReactFlow
            key={`${compact ? "compact" : "full"}-${selected ? "inspector-open" : "inspector-closed"}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.15 }}
            minZoom={0.3}
            nodesConnectable={false}
            onNodeClick={(_, node) => {
              const data = node.data;
              setNodes((current) => current.map((item) => ({ ...item, selected: item.id === node.id })));
              setSelected({
                id: node.id,
                name: data.rawName,
                status: data.status,
                averageLatencyMs: data.averageLatencyMs,
                requestCount: data.requestCount,
              });
            }}
            onPaneClick={() => {
              setSelected(null);
              setNodes((current) => current.map((item) => ({ ...item, selected: false })));
            }}
          >
            <Background gap={24} size={1} color="#1b2635" />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
        )}
        <div className="map-legend">
          <span><i className="healthy" />Healthy</span>
          <span><i className="degraded" />Degraded</span>
          <span><i className="unknown" />No data</span>
        </div>
      </section>

      {selected && (
        <aside className="node-panel">
          <button className="close-button" onClick={() => setSelected(null)} aria-label="Close service details"><X size={15} /></button>
          <span className="section-kicker">Service</span>
          <h2>{displayServiceName(selected.name)}</h2>
          <div className={`detail-status ${selected.status}`}>
            <i /> {selected.status === "healthy" ? "Healthy" : selected.status === "degraded" ? "Degraded" : "No data"}
          </div>
          <dl>
            <div><dt>Service ID</dt><dd className="mono">{selected.name}</dd></div>
            <div><dt>Average latency</dt><dd>{selected.averageLatencyMs != null ? formatLatency(selected.averageLatencyMs) : "Unavailable"}</dd></div>
            <div><dt>Recent requests</dt><dd>{selected.requestCount != null ? pluralize(selected.requestCount, "request") : "Unavailable"}</dd></div>
          </dl>
          <p>Latency and request counts appear once this service has emitted spans to Jaeger.</p>
        </aside>
      )}
    </div>
  );
}

function ServiceFlowNode({ data, selected }: NodeProps<Node<ServiceNodeData>>) {
  return (
    <div className={`flow-node ${data.status} ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="flow-handle" />
      <span className={`flow-node-icon ${data.status}`}><Server size={14} /></span>
      <div className="flow-node-copy">
        <strong>{data.label}</strong>
        <small>{data.rawName}</small>
      </div>
      <i className={`flow-node-status ${data.status}`} aria-hidden="true" />
      <Handle type="source" position={Position.Bottom} className="flow-handle" />
    </div>
  );
}

function toFlowNodes(services: ServiceNode[], compact: boolean): Node<ServiceNodeData>[] {
  const positions: Record<string, { x: number; y: number }> = compact ? {
    "traceflow-api": { x: 201, y: 0 },
    gateway: { x: 201, y: 125 },
    "auth-service": { x: 201, y: 250 },
    "order-service": { x: 201, y: 375 },
    "payment-service": { x: 105, y: 510 },
    "inventory-service": { x: 297, y: 510 },
  } : {
    "traceflow-api": { x: 300, y: 0 },
    gateway: { x: 300, y: 130 },
    "auth-service": { x: 300, y: 260 },
    "order-service": { x: 300, y: 390 },
    "payment-service": { x: 130, y: 530 },
    "inventory-service": { x: 470, y: 530 },
  };
  return services.map((service, index) => ({
    id: service.id,
    type: "service",
    initialWidth: 176,
    initialHeight: 58,
    position: positions[service.id] || {
      x: 130 + (index % 3) * 170,
      y: 150 + Math.floor(index / 3) * 130,
    },
    data: {
      label: displayServiceName(service.name),
      rawName: service.name,
      status: service.status,
      averageLatencyMs: service.averageLatencyMs ?? null,
      requestCount: service.requestCount ?? null,
    },
  }));
}

function toFlowEdges(edges: DependencyEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    label: edge.averageLatencyMs != null ? `${formatMs(edge.averageLatencyMs)} ms` : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#5f7899", width: 16, height: 16 },
    style: { stroke: "#3f5878", strokeWidth: 1.5 },
    labelStyle: { fill: "#b7c4d4", fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "#111823", fillOpacity: 1, stroke: "#263241", strokeWidth: 1 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 5,
  }));
}

function useCompactLayout() {
  const query = "(max-width: 760px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return compact;
}
