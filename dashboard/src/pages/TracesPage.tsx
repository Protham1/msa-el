import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "../api/client";
import type { TraceSummary } from "../types/tracing";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import TraceTable from "../components/TraceTable";
import { displayServiceName } from "../lib/format";

interface Props {
  refreshKey: number;
  onDataStatus: (status: "live" | "unavailable") => void;
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Error" },
];

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

  const counts = {
    all: traces.length,
    ok: traces.filter((trace) => !trace.hasError).length,
    error: traces.filter((trace) => trace.hasError).length,
  };

  if (loading) return <LoadingState label="Loading traces" variant="table" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <div className="panel full-panel">
      <div className="trace-toolbar">
        <label className="search-box">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by trace ID"
            aria-label="Search by trace ID"
          />
          {search && (
            <button type="button" className="clear-button" aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </label>

        <select
          value={service}
          onChange={(event) => setService(event.target.value)}
          aria-label="Filter by service"
        >
          <option value="">All services</option>
          {services.map((name) => <option value={name} key={name}>{displayServiceName(name)}</option>)}
        </select>

        <div className="segmented" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.value}
              className={status === filter.value ? "active" : ""}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
              <span>{counts[filter.value as keyof typeof counts]}</span>
            </button>
          ))}
        </div>

        <span className="result-count">
          {filtered.length} {filtered.length === 1 ? "trace" : "traces"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matching traces" message="Adjust the filters or run another checkout from the overview." />
      ) : (
        <TraceTable traces={filtered} showStarted />
      )}
    </div>
  );
}
