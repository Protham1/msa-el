import { Link } from "react-router-dom";
import type { TraceSummary } from "../types/tracing";
import { displayServiceName, formatMs, pluralize, relativeTime, shortTraceId } from "../lib/format";

interface Props {
  traces: TraceSummary[];
  showStarted?: boolean;
}

export default function TraceTable({ traces, showStarted = false }: Props) {
  const maxDuration = Math.max(1, ...traces.map((trace) => trace.durationMs));

  return (
    <div className={`trace-table ${showStarted ? "has-time" : ""}`}>
      <div className="trace-row header">
        <span>Trace</span>
        <span>Root operation</span>
        <span>Duration</span>
        {showStarted && <span>Started</span>}
        <span>Status</span>
      </div>
      {traces.map((trace) => (
        <Link className="trace-row" to={`/traces/${trace.traceId}`} key={trace.traceId}>
          <span className="trace-id" title={trace.traceId}>{shortTraceId(trace.traceId)}</span>
          <span className="cell-main">
            <strong>{trace.rootOperation}</strong>
            <small>
              {displayServiceName(trace.rootService)} · {pluralize(trace.spanCount, "span")} · {pluralize(trace.serviceNames.length, "service")}
            </small>
          </span>
          <span className="cell-duration">
            <span>{formatMs(trace.durationMs)} ms</span>
            <span className="duration-track" aria-hidden="true">
              <i style={{ width: `${Math.max(3, (trace.durationMs / maxDuration) * 100)}%` }} />
            </span>
          </span>
          {showStarted && <span className="cell-started">{relativeTime(trace.startTime)}</span>}
          <span>
            <i className={`status-pill ${trace.hasError ? "error" : "ok"}`}>
              {trace.hasError ? "Error" : "OK"}
            </i>
          </span>
        </Link>
      ))}
    </div>
  );
}
