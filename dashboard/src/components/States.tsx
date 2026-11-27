import type { ReactNode } from "react";
import { AlertCircle, DatabaseZap, RotateCw } from "lucide-react";

type SkeletonVariant = "overview" | "table" | "detail" | "map";

export function LoadingState({ label = "Loading telemetry", variant = "overview" }: {
  label?: string;
  variant?: SkeletonVariant;
}) {
  return (
    <div className={`skeleton-page skeleton-${variant}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === "overview" && (
        <>
          <div className="skeleton-metrics">
            {Array.from({ length: 4 }, (_, index) => <div className="skeleton-card" key={index} />)}
          </div>
          <div className="skeleton-columns">
            <div className="skeleton-panel"><div className="skeleton-heading" />{Array.from({ length: 6 }, (_, index) => <div className="skeleton-row" key={index} />)}</div>
            <div className="skeleton-panel skeleton-panel-short"><div className="skeleton-heading" /><div className="skeleton-block" /></div>
          </div>
        </>
      )}
      {variant === "table" && (
        <div className="skeleton-panel skeleton-table">
          <div className="skeleton-toolbar"><div className="skeleton-input" /><div className="skeleton-input skeleton-input-small" /></div>
          {Array.from({ length: 8 }, (_, index) => <div className="skeleton-row" key={index} />)}
        </div>
      )}
      {variant === "detail" && (
        <>
          <div className="skeleton-breadcrumb" />
          <div className="skeleton-metrics">
            {Array.from({ length: 4 }, (_, index) => <div className="skeleton-card" key={index} />)}
          </div>
          <div className="skeleton-columns">
            <div className="skeleton-panel">{Array.from({ length: 7 }, (_, index) => <div className="skeleton-row" key={index} />)}</div>
            <div className="skeleton-panel"><div className="skeleton-heading" />{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index} />)}</div>
          </div>
        </>
      )}
      {variant === "map" && (
        <div className="skeleton-panel skeleton-map">
          <div className="skeleton-node" />
          <div className="skeleton-node skeleton-node-mid" />
          <div className="skeleton-node skeleton-node-bottom" />
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title = "No trace data", message = "Run a checkout or wait for traces to arrive in Jaeger.", icon, action }: {
  title?: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">{icon ?? <DatabaseZap size={20} />}</div>
      <strong>{title}</strong>
      <span>{message}</span>
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry, title = "TraceFlow API unavailable", action }: {
  message: string;
  retry?: () => void;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon"><AlertCircle size={20} /></div>
      <strong>{title}</strong>
      <span>{message}</span>
      {retry && (
        <button className="secondary-button" onClick={retry}>
          <RotateCw size={14} /> Retry
        </button>
      )}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}
