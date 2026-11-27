import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Layers,
  LoaderCircle,
  Network,
  TriangleAlert,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { DemoConfig, Span, TraceDetail } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { computeBottleneck } from "../lib/bottleneck";
import {
  absoluteTime,
  displayServiceName,
  formatCount,
  formatLatency,
  formatMs,
  pluralize,
  serviceColors,
  shortTraceId,
} from "../lib/format";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

type InspectorTab = "overview" | "attributes" | "events";

// Spans arrive from each service in separate OTLP batches, so a trace that just
// finished can still be growing. Re-fetch it quietly a few times right after it starts.
const RECENT_TRACE_WINDOW_MS = 30_000;
const REFRESH_DELAYS_MS = [1500, 3000, 5000];
// A just-finished trace can be missing from Jaeger for a moment while the first
// batches are still being exported, so retry "not found" briefly before failing.
const NOT_FOUND_RETRY_DELAYS_MS = [400, 700, 1000, 1500];
const TIME_TICKS = [0, 0.25, 0.5, 0.75, 1];

export default function TraceDetailPage({ refreshKey, onDataStatus }: Props) {
  const { traceId = "" } = useParams();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [selected, setSelected] = useState<Span | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const refreshTimers = useRef<number[]>([]);
  const scheduledRefreshFor = useRef("");
  const loadGeneration = useRef(0);
  const copyTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const [data, configData] = await Promise.all([
        fetchTraceWhenIndexed(traceId),
        api.getConfig().catch(() => null),
      ]);
      if (generation !== loadGeneration.current) return;
      setTrace(data);
      setConfig(configData);
      setSelected(data.spans[0] || null);
      onDataStatus("live");
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setError(err instanceof Error ? err.message : "Could not load this trace.");
      onDataStatus("unavailable");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [onDataStatus, traceId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Quiet refetch: no loading state, keeps the current span selected when it survives.
  const refreshSilently = useCallback(async () => {
    const generation = loadGeneration.current;
    try {
      const data = await api.trace(traceId);
      if (generation !== loadGeneration.current) return;
      setTrace(data);
      setSelected((previous) => {
        if (!previous) return data.spans[0] || null;
        return data.spans.find((span) => span.spanId === previous.spanId) || data.spans[0] || null;
      });
      onDataStatus("live");
    } catch {
      // Keep the last good view; the next scheduled attempt may still succeed.
    }
  }, [onDataStatus, traceId]);

  // Drop pending refetches when the trace changes or the page unmounts.
  useEffect(() => () => {
    refreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    refreshTimers.current = [];
    scheduledRefreshFor.current = "";
  }, [traceId]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (!trace || trace.traceId !== traceId || !isRecentTrace(trace.startTime)) return;
    // One round of refetches per trace, even if a later batch shifts startTime.
    if (scheduledRefreshFor.current === traceId) return;
    scheduledRefreshFor.current = traceId;

    refreshTimers.current = REFRESH_DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => {
        void refreshSilently().finally(() => {
          if (index === REFRESH_DELAYS_MS.length - 1) {
            refreshTimers.current = [];
            setCollecting(false);
          }
        });
      }, delay),
    );
    setCollecting(true);
  }, [refreshSilently, trace, traceId]);

  if (loading) return <LoadingState label="Loading trace detail" variant="detail" />;
  if (error) return <ErrorState message={error} retry={load} />;
  if (!trace) return <EmptyState title="Trace unavailable" />;

  const spans = [...trace.spans].sort((a, b) => startNano(a) - startNano(b));
  const services = new Set(spans.map((span) => span.serviceName));
  const errorSpan = spans.find((span) => span.status === "error");
  const bottleneck = computeBottleneck(spans, trace.durationMs);
  const configuredDelay = bottleneck ? configuredDelayFor(bottleneck.span.serviceName, config) : null;
  const colors = serviceColors(services);
  const traceStart = spans.length ? Math.min(...spans.map(startNano)) : 0;
  const traceDuration = trace.durationMs > 0 ? trace.durationMs : 1;

  async function copyTraceId() {
    let success = false;
    try {
      await navigator.clipboard.writeText(traceId);
      success = true;
    } catch {
      // Some browsers deny the async clipboard; fall back to a temporary selection.
      const textarea = document.createElement("textarea");
      textarea.value = traceId;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        success = document.execCommand("copy");
      } catch {
        success = false;
      }
      document.body.removeChild(textarea);
    }

    if (!success) return;
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="detail-page">
      <div className="trace-heading">
        <div className="breadcrumb">
          <Link to="/traces"><ArrowLeft size={14} /> Traces</Link>
          <span className="crumb-divider">/</span>
          <span className="mono trace-id-full" title={traceId}>{traceId}</span>
          <button className="copy-button" onClick={copyTraceId} title={copied ? "Copied" : "Copy trace ID"} aria-label="Copy trace ID">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {collecting && (
            <span className="collecting-badge" title="Spans are still being exported by the services" aria-live="polite">
              <LoaderCircle className="spin" size={11} /> Collecting spans…
            </span>
          )}
        </div>
        <span className="trace-started">Started {absoluteTime(trace.startTime)}</span>
      </div>

      <section className="detail-metrics" aria-label="Trace metrics">
        <DetailMetric label="Duration" value={`${formatMs(trace.durationMs)} ms`} icon={<Clock3 size={14} />} />
        <DetailMetric label="Spans" value={formatCount(spans.length)} icon={<Layers size={14} />} />
        <DetailMetric label="Services" value={formatCount(services.size)} icon={<Network size={14} />} />
        <DetailMetric
          label="Status"
          value={errorSpan ? "Error" : "OK"}
          icon={errorSpan ? <CircleAlert size={14} /> : <Check size={14} />}
          error={Boolean(errorSpan)}
        />
      </section>

      {bottleneck ? (
        <section className="bottleneck-banner">
          <div className="bottleneck-icon"><TriangleAlert size={17} /></div>
          <div className="bottleneck-copy">
            <span className="bottleneck-label">Measured bottleneck · longest self-time</span>
            <strong>{displayServiceName(bottleneck.span.serviceName)} · <span className="mono">{bottleneck.span.operationName}</span></strong>
            <p>Span duration minus time covered by direct child spans.</p>
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
          <div className="panel-header">
            <div>
              <h2>Span waterfall</h2>
              <p>{pluralize(spans.length, "span")} ordered by start time.</p>
            </div>
            <div className="waterfall-legend" aria-label="Service colors">
              {[...colors].map(([name, color]) => (
                <span key={name}><i style={{ background: color }} />{displayServiceName(name)}</span>
              ))}
            </div>
          </div>
          {spans.length === 0 ? <EmptyState title="No spans" /> : (
            <div className="waterfall">
              <div className="waterfall-axis" aria-hidden="true">
                <span />
                <div className="waterfall-axis-track">
                  {TIME_TICKS.map((tick, index) => (
                    <span
                      key={tick}
                      className={`axis-tick ${index === 0 ? "first" : ""} ${index === TIME_TICKS.length - 1 ? "last" : ""}`}
                      style={{ left: `${tick * 100}%` }}
                    >
                      {formatMs(traceDuration * tick)}{index === TIME_TICKS.length - 1 ? " ms" : ""}
                    </span>
                  ))}
                </div>
                <span />
              </div>
              {spans.map((span) => {
                const offset = Math.min(100, Math.max(0, ((startNano(span) - traceStart) / 1_000_000 / traceDuration) * 100));
                const width = Math.min(100 - offset, Math.max(0.6, (span.durationMs / traceDuration) * 100));
                const color = colors.get(span.serviceName) || "var(--accent)";
                return (
                  <button
                    className={`waterfall-row ${selected?.spanId === span.spanId ? "selected" : ""}`}
                    key={span.spanId}
                    onClick={() => setSelected(span)}
                    aria-pressed={selected?.spanId === span.spanId}
                    aria-label={`${span.operationName} on ${span.serviceName}, ${formatMs(span.durationMs)} milliseconds`}
                  >
                    <div className="waterfall-label">
                      <i className="service-dot" style={{ background: color }} />
                      <div>
                        <strong>{span.operationName}</strong>
                        <small>{displayServiceName(span.serviceName)} · {shortTraceId(span.spanId, 8)}</small>
                      </div>
                    </div>
                    <div className="waterfall-track">
                      <i
                        className={`waterfall-bar ${span.status}`}
                        style={{ left: `${offset}%`, width: `${width}%`, "--bar-color": color } as CSSProperties}
                      />
                    </div>
                    <b>{formatMs(span.durationMs)}<span> ms</span></b>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel span-panel">
          <div className="panel-header"><div><h2>Span details</h2><p>Selected span attributes and events.</p></div></div>
          {selected ? (
            <div className="span-details">
              <div className="detail-name">
                <i className={`status-dot ${selected.status === "error" ? "degraded" : selected.status === "ok" ? "healthy" : "neutral"}`} />
                <div>
                  <strong>{selected.operationName}</strong>
                  <small>{displayServiceName(selected.serviceName)} · {selected.serviceName}</small>
                </div>
              </div>

              <div className="inspector-tabs" role="tablist" aria-label="Span details sections">
                <InspectorTabButton tab="overview" current={inspectorTab} onSelect={setInspectorTab}>Overview</InspectorTabButton>
                <InspectorTabButton tab="attributes" current={inspectorTab} onSelect={setInspectorTab} count={Object.keys(selected.attributes).length}>Attributes</InspectorTabButton>
                <InspectorTabButton tab="events" current={inspectorTab} onSelect={setInspectorTab} count={selected.events.length}>Events</InspectorTabButton>
              </div>

              {inspectorTab === "overview" && (
                <dl className="inspector-list">
                  <div><dt>Span ID</dt><dd className="mono">{selected.spanId}</dd></div>
                  <div><dt>Parent span</dt><dd className="mono">{selected.parentSpanId || "Root span"}</dd></div>
                  <div><dt>Status</dt><dd>{selected.status === "unset" ? "Unset" : selected.status === "error" ? "Error" : "OK"}</dd></div>
                  <div><dt>Duration</dt><dd>{formatLatency(selected.durationMs)}</dd></div>
                </dl>
              )}

              {inspectorTab === "attributes" && (
                Object.keys(selected.attributes).length > 0 ? (
                  <div className="attribute-list">
                    {Object.entries(selected.attributes).map(([key, value]) => (
                      <div key={key}><span>{key}</span><code>{formatAttributeValue(value)}</code></div>
                    ))}
                  </div>
                ) : <p className="inspector-empty">This span has no attributes.</p>
              )}

              {inspectorTab === "events" && (
                selected.events.length > 0 ? (
                  <div className="event-list">
                    {selected.events.map((event, index) => (
                      <div className="event-card" key={index}>
                        <strong>{eventName(event)}</strong>
                        <pre>{JSON.stringify(event, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                ) : <p className="inspector-empty">This span has no events.</p>
              )}
            </div>
          ) : <EmptyState title="Select a span" />}
        </section>
      </div>

      <section className="panel tree-panel">
        <div className="panel-header"><div><h2>Span tree</h2><p>Call hierarchy; use the chevrons to collapse branches.</p></div></div>
        <SpanTree spans={spans} colors={colors} selectedId={selected?.spanId} onSelect={setSelected} />
      </section>
    </div>
  );
}

function InspectorTabButton({ tab, current, onSelect, count, children }: {
  tab: InspectorTab;
  current: InspectorTab;
  onSelect: (tab: InspectorTab) => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={current === tab}
      className={current === tab ? "active" : ""}
      onClick={() => onSelect(tab)}
    >
      {children}{count != null && <span className="tab-count">{count}</span>}
    </button>
  );
}

function SpanTree({ spans, colors, selectedId, onSelect }: {
  spans: Span[];
  colors: Map<string, string>;
  selectedId?: string;
  onSelect: (span: Span) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const children = useMemo(() => {
    const map = new Map<string, Span[]>();
    for (const span of spans) {
      const key = span.parentSpanId || "__root";
      map.set(key, [...(map.get(key) || []), span]);
    }
    return map;
  }, [spans]);

  function toggle(spanId: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  function render(span: Span, depth: number): JSX.Element {
    const nested = children.get(span.spanId) || [];
    const isCollapsed = collapsed.has(span.spanId);
    return (
      <div className="tree-node" key={span.spanId}>
        <div className={`tree-row ${selectedId === span.spanId ? "selected" : ""}`} style={{ paddingLeft: `${10 + depth * 18}px` }}>
          <button
            className="tree-toggle"
            onClick={() => toggle(span.spanId)}
            disabled={nested.length === 0}
            aria-label={nested.length ? `${isCollapsed ? "Expand" : "Collapse"} ${span.operationName}` : undefined}
          >
            {nested.length ? (isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />) : <span className="tree-spacer" />}
          </button>
          <button className="tree-main" onClick={() => onSelect(span)}>
            <i className="service-dot" style={{ background: colors.get(span.serviceName) || "var(--accent)" }} />
            <strong>{span.operationName}</strong>
            <small>{displayServiceName(span.serviceName)}</small>
            <b>{formatMs(span.durationMs)} ms</b>
          </button>
        </div>
        {!isCollapsed && nested.map((child) => render(child, depth + 1))}
      </div>
    );
  }

  const roots = children.get("__root") || spans.filter((span) => !span.parentSpanId);
  return roots.length ? <div className="span-tree">{roots.map((root) => render(root, 0))}</div> : <EmptyState title="No hierarchy available" />;
}

function DetailMetric({ label, value, icon, error }: { label: string; value: string; icon: ReactNode; error?: boolean }) {
  return (
    <div className={`detail-metric ${error ? "error" : ""}`}>
      <span className="detail-metric-label">{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function startNano(span: Span) {
  const value = Number(span.startTimeUnixNano);
  return Number.isFinite(value) ? value : 0;
}

function isRecentTrace(startTime: string) {
  // RFC3339Nano may carry 9 fractional digits; keep the 3 that Date.parse expects.
  const startedAt = Date.parse(startTime.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(startedAt) && Date.now() - startedAt <= RECENT_TRACE_WINDOW_MS;
}

async function fetchTraceWhenIndexed(traceId: string): Promise<TraceDetail> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.trace(traceId);
    } catch (err) {
      const notIndexedYet = err instanceof ApiError && err.status === 404;
      if (!notIndexedYet || attempt >= NOT_FOUND_RETRY_DELAYS_MS.length) throw err;
      await delay(NOT_FOUND_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function formatAttributeValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function eventName(event: unknown) {
  if (event && typeof event === "object" && "name" in event) {
    const name = (event as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "Event";
}
