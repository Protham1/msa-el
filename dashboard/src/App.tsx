import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Activity, GitFork, ListTree, RefreshCw } from "lucide-react";
import OverviewPage from "./pages/OverviewPage";
import TracesPage from "./pages/TracesPage";
import TraceDetailPage from "./pages/TraceDetailPage";
import ServiceMapPage from "./pages/ServiceMapPage";
import NotFoundPage from "./pages/NotFoundPage";

type DataStatus = "connecting" | "live" | "unavailable";

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "System overview",
    subtitle: "Service health, recent traces and demo controls.",
  },
  "/services": {
    title: "Service map",
    subtitle: "How requests flow through the TraceFlow services.",
  },
  "/traces": {
    title: "Trace explorer",
    subtitle: "Search and inspect recent distributed traces.",
  },
};

const TRACE_DETAIL_META = { title: "Trace detail", subtitle: "Span timing, attributes and the measured bottleneck." };
const NOT_FOUND_META = { title: "Page not found", subtitle: "No page at this address." };

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [dataStatus, setDataStatus] = useState<DataStatus>("connecting");
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const isTraceDetail = /^\/traces\/[^/]+$/.test(path);
  const pageMeta = isTraceDetail ? TRACE_DETAIL_META : PAGE_META[path];
  const meta = pageMeta || NOT_FOUND_META;
  const notFound = !pageMeta;

  useEffect(() => {
    document.title = `${meta.title} · TraceFlow`;
  }, [meta.title]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="TraceFlow overview">
          <span className="brand-mark"><Activity size={20} /></span>
          <span className="brand-text">
            <strong>TraceFlow</strong>
            <small>Observability</small>
          </span>
        </NavLink>

        <span className="nav-label">Workspace</span>
        <nav className="nav" aria-label="Main navigation">
          <NavLink to="/" end title="Overview"><Activity size={17} /> <span>Overview</span></NavLink>
          <NavLink to="/services" title="Service map"><GitFork size={17} /> <span>Service map</span></NavLink>
          <NavLink to="/traces" title="Traces"><ListTree size={17} /> <span>Traces</span></NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="environment">
            <span className="pulse" />
            <div>
              <small>Environment</small>
              <strong>Local demo</strong>
            </div>
          </div>
        </div>
      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
          {!notFound && (
            <div className="topbar-actions">
              <span
                className={`source-badge ${dataStatus}`}
                role="status"
                aria-live="polite"
                aria-label={
                  dataStatus === "live"
                    ? "Jaeger connected"
                    : dataStatus === "unavailable"
                      ? "TraceFlow API unavailable"
                      : "Connecting to the TraceFlow API"
                }
                title={
                  dataStatus === "live"
                    ? "The TraceFlow API is reachable"
                    : dataStatus === "unavailable"
                      ? "The TraceFlow API is not reachable"
                      : "Connecting to the TraceFlow API"
                }
              >
                <i className="source-dot" />
                <span className="source-text">
                  {dataStatus === "live" ? "Jaeger connected" : dataStatus === "connecting" ? "Connecting" : "API unavailable"}
                </span>
              </span>
              <button
                className="icon-button"
                title="Refresh data"
                aria-label="Refresh data"
                onClick={() => setRefreshKey((key) => key + 1)}
              >
                <RefreshCw size={17} />
              </button>
            </div>
          )}
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<OverviewPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/services" element={<ServiceMapPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/traces" element={<TracesPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/traces/:traceId" element={<TraceDetailPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
