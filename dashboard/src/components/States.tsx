import { AlertCircle, DatabaseZap, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading telemetry" }: { label?: string }) {
  return (
    <div className="state state-loading">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title = "No trace data", message = "Run a checkout or wait for traces to arrive in Jaeger." }: { title?: string; message?: string }) {
  return (
    <div className="state">
      <DatabaseZap size={23} />
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state state-error">
      <AlertCircle size={22} />
      <strong>TraceFlow API unavailable</strong>
      <span>{message}</span>
      {retry && <button className="secondary-button" onClick={retry}>Retry</button>}
    </div>
  );
}
