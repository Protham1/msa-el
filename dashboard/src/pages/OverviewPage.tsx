import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Network,
  Play,
  RotateCcw,
  Server,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { CheckoutResult, DemoConfig, Overview, ServiceNode } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import TraceTable from "../components/TraceTable";
import { displayServiceName, formatCount, formatLatency, formatMs, pluralize } from "../lib/format";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

export default function OverviewPage({ refreshKey, onDataStatus }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<ServiceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState<DemoConfig>({
    payment: { delayMs: 0, failure: false },
    inventory: { delayMs: 0 },
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [configError, setConfigError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewData, serviceData] = await Promise.all([api.overview(), api.services()]);
      setOverview(overviewData);
      setServices(serviceData);
      onDataStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the TraceFlow API.");
      onDataStatus("unavailable");
    } finally {
      setLoading(false);
    }
  }, [onDataStatus]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => undefined);
  }, [refreshKey]);

  async function runCheckout() {
    setRunning(true);
    setCheckout(null);
    try {
      const result = await api.checkout();
      setCheckout(result);
      await load();
    } catch (err) {
      setCheckout({ error: err instanceof Error ? err.message : "Checkout request failed" });
    } finally {
      setRunning(false);
    }
  }

  async function saveConfig(next: DemoConfig) {
    const previous = config;
    setConfig(next);
    setSaving(true);
    setSavedAt("");
    setConfigError("");
    try {
      setConfig(await api.updateConfig(next));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (err) {
      setConfig(previous);
      setConfigError(err instanceof Error ? err.message : "Could not update simulator settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading system overview" variant="overview" />;
  if (error) return <ErrorState message={error} retry={load} />;

  const traces = overview?.recentTraces || [];
  const errorCount = overview?.errorCount;
  const errorRate = overview?.errorRate;
  const cards = [
    {
      label: "Total traces",
      value: overview?.totalTraces != null ? formatCount(overview.totalTraces) : "—",
      meta: overview?.totalTraces != null ? "Retained in Jaeger" : "Partial trace sample",
      icon: Activity,
      tone: "accent",
    },
    {
      label: "Average latency",
      value: overview?.averageDurationMs != null ? `${formatMs(overview.averageDurationMs)} ms` : "—",
      meta: "End-to-end across traces",
      icon: Clock3,
      tone: "violet",
    },
    {
      label: "Errors",
      value: errorCount != null ? formatCount(errorCount) : "—",
      meta: errorRate != null ? `${formatMs(errorRate * 100)}% error rate` : "No error data yet",
      icon: TriangleAlert,
      tone: errorCount ? "red" : "green",
    },
    {
      label: "Services",
      value: overview?.serviceCount != null ? formatCount(overview.serviceCount) : "—",
      meta: "Reporting telemetry",
      icon: Network,
      tone: "amber",
    },
  ];

  return (
    <div className="page-stack">
      <section className="metric-grid" aria-label="Key metrics">
        {cards.map(({ label, value, meta, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${tone}`}><Icon size={18} /></div>
            <div className="metric-body">
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{meta}</small>
            </div>
          </article>
        ))}
      </section>

      <div className="overview-grid">
        <section className="panel service-panel">
          <div className="panel-header">
            <div>
              <h2>Service health</h2>
              <p>Latest status reported by the topology API.</p>
            </div>
            <Link to="/services" className="text-link">
              Open map <ArrowUpRight size={13} />
            </Link>
          </div>
          {services.length === 0 ? (
            <EmptyState title="No services observed" message="Jaeger has not reported any service names yet." />
          ) : (
            <div className="service-list">
              {services.map((service) => {
                const tone = service.status === "healthy" ? "ok" : service.status === "degraded" ? "error" : "neutral";
                const idle = service.status === "unknown" && service.averageLatencyMs == null && service.requestCount == null;
                return (
                  <div className={`service-row ${idle ? "is-idle" : ""}`} key={service.id || service.name}>
                    <span className={`service-avatar ${service.status}`}><Server size={15} /></span>
                    <div className="service-identity">
                      <strong>{displayServiceName(service.name)}</strong>
                      <small>{service.name}</small>
                    </div>
                    {idle ? (
                      <span className="service-idle"><i className="status-dot neutral" />Awaiting traffic</span>
                    ) : (
                      <>
                        <div className="service-latency">
                          <strong>{service.averageLatencyMs != null ? formatLatency(service.averageLatencyMs) : "—"}</strong>
                          <small>
                            {service.requestCount != null
                              ? pluralize(service.requestCount, "request")
                              : "Awaiting traffic"}
                          </small>
                        </div>
                        <i className={`status-pill ${tone}`}>
                          {service.status === "healthy" ? "Healthy" : service.status === "degraded" ? "Degraded" : "No data"}
                        </i>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel action-panel">
          <div className="panel-header">
            <div>
              <h2>Run checkout</h2>
              <p>Generate a complete distributed trace.</p>
            </div>
          </div>
          <div className="checkout-body">
            <div>
              <div className="checkout-route" aria-label="Checkout request path">
                <span>Gateway</span><ArrowRight size={12} />
                <span>Auth</span><ArrowRight size={12} />
                <span>Order</span><ArrowRight size={12} />
                <span>Payment</span><span className="route-plus">+</span><span>Inventory</span>
              </div>
              <p className="panel-copy">
                Runs one checkout through the gateway, then fans out to payment and inventory.
                The resulting trace appears here within a couple of seconds.
              </p>
            </div>
            <div className="checkout-action">
              <button className="primary-button" onClick={runCheckout} disabled={running}>
                <Play size={15} fill="currentColor" />
                {running ? "Running checkout…" : "Run checkout"}
              </button>
              {checkout && (
                <div className={`checkout-result ${checkout.error ? "error" : "success"}`} role="status">
                  <div className="checkout-result-title">
                    {checkout.error ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
                    <strong>{checkout.error ? "Checkout failed" : "Checkout completed"}</strong>
                  </div>
                  {checkout.traceId && (
                    <Link to={`/traces/${checkout.traceId}`}>
                      Open resulting trace <ArrowUpRight size={12} />
                    </Link>
                  )}
                  {checkout.message && <span>{checkout.message}</span>}
                  {checkout.error && <span>{checkout.error}</span>}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="overview-grid lower">
        <section className="panel traces-panel">
          <div className="panel-header">
            <div>
              <h2>Recent traces</h2>
              <p>The newest requests seen in Jaeger.</p>
            </div>
            <Link to="/traces" className="text-link">
              View all <ArrowUpRight size={13} />
            </Link>
          </div>
          {traces.length === 0 ? (
            <EmptyState title="No recent traces" />
          ) : (
            <TraceTable traces={traces.slice(0, 8)} />
          )}
        </section>

        <section className="panel controls-panel">
          <div className="panel-header">
            <div>
              <h2>Simulation</h2>
              <p>Inject latency or failure into the demo.</p>
            </div>
            <button
              className="icon-button small"
              title="Reset simulation"
              aria-label="Reset simulation"
              disabled={saving}
              onClick={() => void saveConfig({
                payment: { delayMs: 0, failure: false },
                inventory: { delayMs: 0 },
              })}
            >
              <RotateCcw size={14} />
            </button>
          </div>

          <div className="controls-body">
            <ControlSelect
              label="Payment delay"
              hint="Added to the payment span"
              value={config.payment.delayMs}
              options={[0, 500, 1500, 3000]}
              disabled={saving}
              onChange={(value) => void saveConfig({ ...config, payment: { ...config.payment, delayMs: value } })}
            />
            <ControlSelect
              label="Inventory delay"
              hint="Added to the inventory span"
              value={config.inventory.delayMs}
              options={[0, 500, 1500]}
              disabled={saving}
              onChange={(value) => void saveConfig({ ...config, inventory: { ...config.inventory, delayMs: value } })}
            />
            <label className="switch-row">
              <span>
                <strong>Payment failure</strong>
                <small>Return a simulated HTTP 500</small>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={config.payment.failure}
                  disabled={saving}
                  onChange={(event) => void saveConfig({
                    ...config,
                    payment: { ...config.payment, failure: event.target.checked },
                  })}
                />
                <span className="switch-track" aria-hidden="true" />
              </span>
            </label>
            {configError && (
              <div className="controls-error" role="alert">
                <TriangleAlert size={13} />
                <span><strong>Settings not saved.</strong> {configError}. The previous values are still active.</span>
              </div>
            )}
            <div className="controls-footnote" role="status">
              <span className={`status-dot ${configError ? "degraded" : "neutral"}`} />
              <span>
                {saving
                  ? "Saving changes…"
                  : configError
                    ? "Showing the last saved values."
                    : savedAt
                      ? `Saved at ${savedAt}`
                      : "Changes apply to new requests instantly."}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ControlSelect({ label, hint, value, options, disabled, onChange }: {
  label: string;
  hint: string;
  value: number;
  options: number[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control-row">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => <option value={option} key={option}>{option} ms</option>)}
      </select>
    </label>
  );
}
