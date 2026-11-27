import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { TraceSummary } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

export default function TracesPage({ refreshKey, onDataStatus }: Props) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [service, setService] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (service) params.set("service", service);
      const [traceData, serviceData] = await Promise.all([api.traces(params), api.services()]);
      setTraces(traceData);
      setServices(serviceData.map((item) => item.name));
      onDataStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the TraceFlow API.");
      onDataStatus("unavailable");
    } finally {
      setLoading(false);
    }
  }, [onDataStatus, service]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const filtered = traces.filter((trace) => {
    const matchesSearch = !search || trace.traceId.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      status === "all" ||
      (status === "error" && trace.hasError) ||
      (status === "ok" && !trace.hasError);
    return matchesSearch && matchesStatus;
  });

  if (loading) return <LoadingState label="Loading traces" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <div className="panel full-panel">
      <div className="trace-toolbar">
        <label className="search-box">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search trace ID" />
        </label>
        <select value={service} onChange={(event) => setService(event.target.value)}>
          <option value="">All services</option>
          {services.map((name) => <option value={name} key={name}>{name}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
        <span className="result-count">{filtered.length} traces</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matching traces" message="Adjust the filters or run another checkout." />
      ) : (
        <div className="trace-table">
          <div className="trace-row header"><span>Trace ID</span><span>Root operation</span><span>Services</span><span>Duration</span><span>Started</span><span>Status</span></div>
          {filtered.map((trace) => (
            <Link className="trace-row" to={`/traces/${trace.traceId}`} key={trace.traceId}>
              <span className="trace-id">{trace.traceId}</span>
              <span><strong>{trace.rootOperation}</strong><small>{trace.rootService}</small></span>
              <span>{trace.spanCount} spans · {trace.serviceNames.length} services</span>
              <span className="mono">{formatMs(trace.durationMs)} ms</span>
              <span>{formatStart(trace.startTime)}</span>
              <span><i className={`status-pill ${trace.hasError ? "error" : "ok"}`}>{trace.hasError ? "Error" : "OK"}</i></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatMs(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatStart(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
