import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  type ReactFlowInstance,
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
  { id: "traceflow-api", name: "traceflow-api", status: "unknown" },
  { id: "gateway", name: "gateway", status: "unknown" },
  { id: "auth-service", name: "auth-service", status: "unknown" },
  { id: "order-service", name: "order-service", status: "unknown" },
  { id: "payment-service", name: "payment-service", status: "unknown" },
  { id: "inventory-service", name: "inventory-service", status: "unknown" },
];

const STATIC_EDGES: DependencyEdge[] = [
  { id: "traceflow-api-gateway", source: "traceflow-api", target: "gateway" },
  { id: "gateway-auth", source: "gateway", target: "auth-service" },
  { id: "auth-order", source: "auth-service", target: "order-service" },
  { id: "order-payment", source: "order-service", target: "payment-service" },
  { id: "order-inventory", source: "order-service", target: "inventory-service" },
];

const NODE_TYPES = { service: ServiceFlowNode };
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.35, maxZoom: 1.15 };

export default function ServiceMapPage({ refreshKey, onDataStatus }: Props) {
  const compact = useCompactLayout();
  const flowRef = useRef<ReactFlowInstance<Node<ServiceNodeData>, Edge> | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [nodes, setNodes] = useState<Node<ServiceNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<ServiceNode | null>(null);
  const [dataSource, setDataSource] = useState<"static" | "telemetry">("static");
  const [sourceMessage, setSourceMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectService = useCallback((service: ServiceNode) => {
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === service.id })));
    setSelected(service);
    setAnnouncement(`Showing details for ${displayServiceName(service.name)}.`);
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setNodes((current) => current.map((item) => ({ ...item, selected: false })));
    setAnnouncement("Service details closed.");
  }, []);

  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.dependencies();
      const serviceNodes = data.nodes?.length ? data.nodes : STATIC_NODES;
      const dependencyEdges = data.edges?.length ? data.edges : STATIC_EDGES;
      setNodes(toFlowNodes(serviceNodes, compact).map((node) => ({
        ...node,
        selected: node.id === selectedIdRef.current,
      })));
      setEdges(toFlowEdges(dependencyEdges));
      setDataSource(data.dataSource || "static");
      setSourceMessage(data.message || "");
      onDataStatus("live");
    } catch (err) {
      setNodes(toFlowNodes(STATIC_NODES, compact).map((node) => ({
        ...node,
        selected: node.id === selectedIdRef.current,
      })));
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

  useEffect(() => {
    if (!nodes.length) return;
    const frame = window.requestAnimationFrame(() => {
      void flowRef.current?.fitView(FIT_VIEW_OPTIONS);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compact, nodes.length]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void flowRef.current?.fitView(FIT_VIEW_OPTIONS);
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [loading]);

  function handleCanvasKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const nodeElement = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const node = nodeElement ? nodes.find((item) => item.id === nodeElement.dataset.id) : undefined;
    if (!node) return;
    event.preventDefault();
    selectService(serviceFromFlowNode(node));
  }

  if (loading) return <LoadingState label="Loading service topology" variant="map" />;

  return (
    <div className={`map-layout ${selected ? "has-selection" : ""}`}>
      <span className="sr-only" role="status">{announcement}</span>
      <section className="map-canvas" ref={canvasRef} onKeyDown={handleCanvasKeyDown}>
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
        <div className="map-hint">Select a service to inspect</div>
        {nodes.length === 0 ? (
          <EmptyState title="No service topology" message="The API has not returned nodes or edges." />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            minZoom={0.3}
            nodesConnectable={false}
            nodesDraggable={false}
            edgesFocusable={false}
            onInit={(instance) => { flowRef.current = instance; }}
            onNodeClick={(_, node) => selectService(serviceFromFlowNode(node))}
            onPaneClick={clearSelection}
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
        <aside className="node-panel" aria-label="Service details">
          <button className="close-button" onClick={clearSelection} aria-label="Close service details"><X size={15} /></button>
          <h2>{displayServiceName(selected.name)}</h2>
          <div className={`detail-status ${selected.status}`}>
            <i /> {selected.status === "healthy" ? "Healthy" : selected.status === "degraded" ? "Degraded" : "No data"}
          </div>
          <dl>
            <div><dt>Service ID</dt><dd className="mono">{selected.name}</dd></div>
            <div><dt>Average latency</dt><dd>{selected.averageLatencyMs != null ? formatLatency(selected.averageLatencyMs) : "Unavailable"}</dd></div>
            <div><dt>Recent requests</dt><dd>{selected.requestCount != null ? pluralize(selected.requestCount, "request") : "Unavailable"}</dd></div>
          </dl>
          <p>Service-level latency and request counts are not reported by the topology API yet. Edge timings come from recent spans.</p>
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
    ariaRole: "button",
    ariaLabel: `Inspect ${displayServiceName(service.name)} service. Status: ${statusLabel(service.status)}.`,
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

function serviceFromFlowNode(node: Node<ServiceNodeData>): ServiceNode {
  const data = node.data;
  return {
    id: node.id,
    name: data.rawName,
    status: data.status,
    averageLatencyMs: data.averageLatencyMs,
    requestCount: data.requestCount,
  };
}

function statusLabel(status: ServiceNode["status"]) {
  return status === "healthy" ? "Healthy" : status === "degraded" ? "Degraded" : "No data";
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
