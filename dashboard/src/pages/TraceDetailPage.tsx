import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, TriangleAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { DemoConfig, Span, TraceDetail } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { computeBottleneck } from "../lib/bottleneck";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

export default function TraceDetailPage({ refreshKey, onDataStatus }: Props) {
  const { traceId = "" } = useParams();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [selected, setSelected] = useState<Span | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, configData] = await Promise.all([
        api.trace(traceId),
        api.getConfig().catch(() => null),
      ]);
      setTrace(data);
      setConfig(configData);
      setSelected(data.spans[0] || null);
      onDataStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this trace.");
      onDataStatus("unavailable");
    } finally {
      setLoading(false);
    }
  }, [onDataStatus, traceId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <LoadingState label="Loading trace detail" />;
  if (error) return <ErrorState message={error} retry={load} />;
  if (!trace) return <EmptyState title="Trace unavailable" />;

  const spans = [...trace.spans].sort((a, b) => startNano(a) - startNano(b));
  const services = new Set(spans.map((span) => span.serviceName));
  const errorSpan = spans.find((span) => span.status === "error");
  const bottleneck = computeBottleneck(spans, trace.durationMs);
  const configuredDelay = bottleneck ? configuredDelayFor(bottleneck.span.serviceName, config) : null;

  async function copyTraceId() {
    await navigator.clipboard.writeText(traceId);
  }

  return (
    <div className="detail-page">
      <div className="breadcrumb">
        <Link to="/traces">Traces</Link><span>/</span><span className="mono">{traceId}</span>
        <button className="copy-button" onClick={copyTraceId} title="Copy trace ID"><Copy size={14} /></button>
      </div>

      <section className="detail-metrics">
        <DetailMetric label="Duration" value={`${formatMs(trace.durationMs)} ms`} />
        <DetailMetric label="Spans" value={String(spans.length)} />
        <DetailMetric label="Services" value={String(services.size)} />
        <DetailMetric label="Status" value={errorSpan ? "Error" : "OK"} error={Boolean(errorSpan)} />
      </section>

      {bottleneck ? (
        <section className="bottleneck-banner">
          <div className="bottleneck-icon"><TriangleAlert size={17} /></div>
          <div>
            <span>Measured bottleneck · longest self-time</span>
            <strong>{bottleneck.span.serviceName} · {bottleneck.span.operationName}</strong>
            <small>Span duration minus time covered by direct child spans.</small>
            {configuredDelay && (
              <small>Current simulator {configuredDelay.label.toLowerCase()} delay: {configuredDelay.value} ms</small>
            )}
            {errorSpan && <small>Trace contains errors; this measures latency, not the cause.</small>}
          </div>
          <div className="bottleneck-duration">
            <strong>{formatMs(bottleneck.selfTimeMs)} ms</strong>
            <span>{trace.durationMs > 0 ? `${Math.round(bottleneck.percentOfTrace)}% of trace` : "Trace duration unavailable"}</span>
          </div>
        </section>
      ) : (
        <section className="bottleneck-banner unavailable">
          <span>Not enough span data to identify a bottleneck.</span>
        </section>
      )}

      <div className="detail-grid">
        <section className="panel waterfall-panel">
          <div className="panel-header"><div><span className="section-kicker">TIMELINE</span><h2>Span waterfall</h2></div></div>
          {spans.length === 0 ? <EmptyState title="No spans" /> : (
            <div className="waterfall">
              {spans.map((span) => {
                const minStart = spans.length ? Math.min(...spans.map(startNano)) : 0;
                const maxStart = spans.length ? Math.max(...spans.map(startNano)) : 1;
                const base = Number.isFinite(maxStart - minStart) ? maxStart - minStart : 1;
                const offset = base > 0 ? ((startNano(span) - minStart) / base) * 88 : 0;
                const width = trace.durationMs > 0 ? Math.max(1.5, (span.durationMs / trace.durationMs) * 88) : 2;
                return (
                  <button className={`waterfall-row ${selected?.spanId === span.spanId ? "selected" : ""}`} key={span.spanId}
                    onClick={() => setSelected(span)}>
                    <div className="waterfall-label">
                      <strong>{span.operationName}</strong>
                      <small>{span.serviceName}</small>
                    </div>
                    <div className="waterfall-track">
                      <i className={`waterfall-bar ${span.status}`} style={{ left: `${offset}%`, width: `${width}%` }} />
                    </div>
                    <b>{formatMs(span.durationMs)} ms</b>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel span-panel">
          <div className="panel-header"><div><span className="section-kicker">INSPECTOR</span><h2>Span details</h2></div></div>
          {selected ? (
            <div className="span-details">
              <div className="detail-name">
                <i className={`status-dot ${selected.status === "error" ? "degraded" : "healthy"}`} />
                <div><strong>{selected.operationName}</strong><small>{selected.serviceName}</small></div>
              </div>
              <dl>
                <div><dt>Span ID</dt><dd className="mono">{selected.spanId}</dd></div>
                <div><dt>Parent span</dt><dd className="mono">{selected.parentSpanId || "Root span"}</dd></div>
                <div><dt>Status</dt><dd>{selected.status}</dd></div>
                <div><dt>Duration</dt><dd>{formatMs(selected.durationMs)} ms</dd></div>
              </dl>
              {Object.keys(selected.attributes).length > 0 && (
                <div className="attribute-list">
                  <strong>Attributes</strong>
                  {Object.entries(selected.attributes).map(([key, value]) => (
                    <div key={key}><span>{key}</span><code>{String(value)}</code></div>
                  ))}
                </div>
              )}
              {selected.events.length > 0 && (
                <div className="attribute-list">
                  <strong>Events</strong>
                  {selected.events.map((event, index) => <code key={index}>{JSON.stringify(event)}</code>)}
                </div>
              )}
            </div>
          ) : <EmptyState title="Select a span" />}
        </section>
      </div>

      <section className="panel tree-panel">
        <div className="panel-header"><div><span className="section-kicker">HIERARCHY</span><h2>Span tree</h2></div></div>
        <SpanTree spans={spans} selectedId={selected?.spanId} onSelect={setSelected} />
      </section>
    </div>
  );
}

function SpanTree({ spans, selectedId, onSelect }: { spans: Span[]; selectedId?: string; onSelect: (span: Span) => void }) {
  const children = useMemo(() => {
    const map = new Map<string, Span[]>();
    for (const span of spans) {
      const key = span.parentSpanId || "__root";
      map.set(key, [...(map.get(key) || []), span]);
    }
    return map;
  }, [spans]);

  function render(span: Span, depth: number): JSX.Element {
    const nested = children.get(span.spanId) || [];
    return (
      <div key={span.spanId}>
        <button className={`tree-row ${selectedId === span.spanId ? "selected" : ""}`} style={{ paddingLeft: `${12 + depth * 18}px` }}
          onClick={() => onSelect(span)}>
          {nested.length ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <i className={`status-dot ${span.status === "error" ? "degraded" : "healthy"}`} />
          <strong>{span.operationName}</strong>
          <small>{span.serviceName}</small>
          <b>{formatMs(span.durationMs)} ms</b>
        </button>
        {nested.map((child) => render(child, depth + 1))}
      </div>
    );
  }

  const roots = children.get("__root") || spans.filter((span) => !span.parentSpanId);
  return roots.length ? <div className="span-tree">{roots.map((root) => render(root, 0))}</div> : <EmptyState title="No hierarchy available" />;
}

function DetailMetric({ label, value, error }: { label: string; value: string; error?: boolean }) {
  return <div className={`detail-metric ${error ? "error" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function startNano(span: Span) {
  const value = Number(span.startTimeUnixNano);
  return Number.isFinite(value) ? value : 0;
}

function configuredDelayFor(serviceName: string, config: DemoConfig | null) {
  if (!config) return null;
  if (serviceName === "payment-service" && config.payment.delayMs > 0) {
    return { label: "Payment", value: config.payment.delayMs };
  }
  if (serviceName === "inventory-service" && config.inventory.delayMs > 0) {
    return { label: "Inventory", value: config.inventory.delayMs };
  }
  return null;
}

function formatMs(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
