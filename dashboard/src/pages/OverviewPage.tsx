import { useCallback, useEffect, useState } from "react";
import { Activity, Clock3, Play, RotateCcw, Server, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { CheckoutResult, DemoConfig, Overview, ServiceNode, TraceSummary } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

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
    setConfig(next);
    setSaving(true);
    try {
      setConfig(await api.updateConfig(next));
    } catch (err) {
      setCheckout({ error: err instanceof Error ? err.message : "Could not update simulator settings" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading system overview" />;
  if (error) return <ErrorState message={error} retry={load} />;

  const traces = overview?.recentTraces || [];
  const cards = [
    { label: "Total traces", value: valueOrUnavailable(overview?.totalTraces), icon: Activity },
    { label: "Average duration", value: overview?.averageDurationMs != null ? `${formatMs(overview.averageDurationMs)} ms` : "Unavailable", icon: Clock3 },
    { label: "Error count", value: valueOrUnavailable(overview?.errorCount), icon: TriangleAlert },
    { label: "Services observed", value: valueOrUnavailable(overview?.serviceCount), icon: Server },
  ];

  return (
    <div className="overview">
      <section className="metric-grid">
        {cards.map(({ label, value, icon: Icon }) => (
          <div className="metric-card" key={label}>
            <div className="metric-icon"><Icon size={18} /></div>
            <div><span>{label}</span><strong>{value}</strong></div>
          </div>
        ))}
      </section>

      <div className="overview-grid">
        <div className="panel service-panel">
          <div className="panel-header">
            <div><span className="section-kicker">SYSTEM</span><h2>Service health</h2></div>
            <Link to="/services" className="text-link">Open map</Link>
          </div>
          {services.length === 0 ? (
            <EmptyState title="No services observed" message="Jaeger has not reported any service names yet." />
          ) : (
            <div className="service-list">
              {services.map((service) => (
                <div className="service-card" key={service.id || service.name}>
                  <span className={`status-dot ${service.status}`} />
                  <div><strong>{service.name}</strong><small>{service.status}</small></div>
                  <b>{service.averageLatencyMs != null ? `${formatMs(service.averageLatencyMs)} ms` : "Latency unavailable"}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel action-panel">
          <div className="panel-header">
            <div><span className="section-kicker">DEMO</span><h2>Run checkout</h2></div>
          </div>
          <p>Trigger Gateway → Auth → Order → Payment + Inventory.</p>
          <button className="primary-button" onClick={runCheckout} disabled={running}>
            <Play size={16} fill="currentColor" /> {running ? "Running checkout..." : "Run checkout"}
          </button>
          {checkout && (
            <div className={`checkout-result ${checkout.error ? "error" : ""}`}>
              <strong>{checkout.error ? "Checkout failed" : "Checkout completed"}</strong>
              {checkout.traceId && <Link to={`/traces/${checkout.traceId}`}>Open resulting trace</Link>}
              {checkout.message && <span>{checkout.message}</span>}
              {checkout.error && <span>{checkout.error}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="overview-grid lower">
        <div className="panel traces-panel">
          <div className="panel-header">
            <div><span className="section-kicker">ACTIVITY</span><h2>Recent traces</h2></div>
            <Link to="/traces" className="text-link">View all</Link>
          </div>
          {traces.length === 0 ? (
            <EmptyState title="No recent traces" />
          ) : (
            <TraceTable traces={traces.slice(0, 8)} />
          )}
        </div>

        <div className="panel controls-panel">
          <div className="panel-header">
            <div><span className="section-kicker">CONTROLS</span><h2>Simulation</h2></div>
            <button className="icon-button small" title="Reset simulation" disabled={saving} onClick={() => saveConfig({
              payment: { delayMs: 0, failure: false }, inventory: { delayMs: 0 },
            })}><RotateCcw size={15} /></button>
          </div>
          <ControlSelect label="Payment delay" value={config.payment.delayMs} options={[0, 500, 1500, 3000]} suffix="ms"
            disabled={saving} onChange={(value) => saveConfig({ ...config, payment: { ...config.payment, delayMs: value } })} />
          <ControlSelect label="Inventory delay" value={config.inventory.delayMs} options={[0, 500, 1500]} suffix="ms"
            disabled={saving} onChange={(value) => saveConfig({ ...config, inventory: { delayMs: value } })} />
          <label className="toggle-row">
            <span><strong>Payment failure</strong><small>Return simulated HTTP 500</small></span>
            <input type="checkbox" checked={config.payment.failure} disabled={saving}
              onChange={(event) => saveConfig({ ...config, payment: { ...config.payment, failure: event.target.checked } })} />
          </label>
          <small className="controlled-note">Controlled demo fault — not an infrastructure failure.</small>
        </div>
      </div>
    </div>
  );
}

function TraceTable({ traces }: { traces: TraceSummary[] }) {
  return (
    <div className="trace-table compact">
      <div className="trace-row header"><span>Trace</span><span>Operation</span><span>Duration</span><span>Status</span></div>
      {traces.map((trace) => (
        <Link className="trace-row" to={`/traces/${trace.traceId}`} key={trace.traceId}>
          <span className="trace-id">{trace.traceId.slice(0, 12)}</span>
          <span><strong>{trace.rootOperation}</strong><small>{trace.rootService}</small></span>
          <span>{formatMs(trace.durationMs)} ms</span>
          <span><i className={`status-pill ${trace.hasError ? "error" : "ok"}`}>{trace.hasError ? "Error" : "OK"}</i></span>
        </Link>
      ))}
    </div>
  );
}

function ControlSelect({ label, value, options, suffix, disabled, onChange }: {
  label: string; value: number; options: number[]; suffix: string; disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control-select">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => <option value={option} key={option}>{option} {suffix}</option>)}
      </select>
    </label>
  );
}

function valueOrUnavailable(value: number | null | undefined) {
  return value == null ? "Unavailable" : String(value);
}

function formatMs(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
