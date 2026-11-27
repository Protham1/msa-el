import { useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Activity, GitFork, ListTree, RefreshCw, Radio } from "lucide-react";
import OverviewPage from "./pages/OverviewPage";
import TracesPage from "./pages/TracesPage";
import TraceDetailPage from "./pages/TraceDetailPage";
import ServiceMapPage from "./pages/ServiceMapPage";

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [dataStatus, setDataStatus] = useState<"live" | "unavailable">("unavailable");
  const location = useLocation();

  const pageTitle =
    location.pathname === "/services"
      ? "Service Map"
      : location.pathname.startsWith("/traces")
        ? "Trace Explorer"
        : "System Overview";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} /></div>
          <div>
            <strong>TraceFlow</strong>
            <span>Observability</span>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end><Activity size={18} /> Overview</NavLink>
          <NavLink to="/services"><GitFork size={18} /> Service Map</NavLink>
          <NavLink to="/traces"><ListTree size={18} /> Traces</NavLink>
        </nav>

        <div className="environment">
          <span className="pulse" />
          <div><small>ENVIRONMENT</small><strong>LOCAL DEMO</strong></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">TRACEFLOW / OBSERVABILITY</span>
            <h1>{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            <div className={`source-badge ${dataStatus}`}>
              <Radio size={14} />
              {dataStatus === "live" ? "Live Jaeger data" : "Waiting for API"}
            </div>
            <button className="icon-button" title="Refresh data" onClick={() => setRefreshKey((key) => key + 1)}>
              <RefreshCw size={17} />
            </button>
          </div>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<OverviewPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/services" element={<ServiceMapPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/traces" element={<TracesPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
            <Route path="/traces/:traceId" element={<TraceDetailPage refreshKey={refreshKey} onDataStatus={setDataStatus} />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
