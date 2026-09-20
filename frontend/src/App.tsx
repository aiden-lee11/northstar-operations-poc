import { useEffect, useRef, useState } from "react";
import { FlagsView } from "./features/flags/FlagsView";
import { CustomerPreviewView } from "./features/preview/CustomerPreviewView";
import { RefundsView } from "./features/refunds/RefundsView";

type View = "refunds" | "flags" | "preview";

function viewFromHash(): View {
  if (window.location.hash === "#flags") return "flags";
  if (window.location.hash === "#preview") return "preview";
  return "refunds";
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [flagsVisited, setFlagsVisited] = useState(viewFromHash() === "flags");
  const [previewVisited, setPreviewVisited] = useState(viewFromHash() === "preview");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onHashChange = () => {
      const nextView = viewFromHash();
      setView(nextView);
      if (nextView === "flags") setFlagsVisited(true);
      if (nextView === "preview") setPreviewVisited(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (nextView: View) => {
    window.history.replaceState(null, "", `#${nextView}`);
    setView(nextView);
    if (nextView === "flags") setFlagsVisited(true);
    if (nextView === "preview") setPreviewVisited(true);
    mainRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 2.5 19.2 12l9.3 4-9.3 4L16 29.5 12.8 20l-9.3-4 9.3-4L16 2.5Z" fill="currentColor" /></svg></span>
          <span><strong>Northstar</strong><small>Operations</small></span>
        </div>
        <nav className="nav-list">
          <button className={`nav-item${view === "refunds" ? " active" : ""}`} type="button" aria-current={view === "refunds" ? "page" : undefined} onClick={() => navigate("refunds")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16M7 4v3.5m10-3.5v3.5M5 7.5h14v12H5zM8 12h3m-3 3h6" /></svg>
            Refunds
          </button>
          <button className={`nav-item${view === "flags" ? " active" : ""}`} type="button" aria-current={view === "flags" ? "page" : undefined} onClick={() => navigate("flags")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M6 5h11l-2 4 2 4H6M9 17h9" /></svg>
            Feature flags
          </button>
          <button className={`nav-item${view === "preview" ? " active" : ""}`} type="button" aria-current={view === "preview" ? "page" : undefined} onClick={() => navigate("preview")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12l2 7H6L4 6Zm0 0-.8-2H2m6 15a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm7 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z" /></svg>
            Customer preview
          </button>
        </nav>
        <div className="sidebar-disclosure">
          <span className="demo-dot" aria-hidden="true" />
          <strong>Local demo</strong>
          <p>State resets on restart. No authentication or real integrations.</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">Northstar <span>/ Operations</span></div>
          <div className="demo-pill"><span aria-hidden="true" />Local demo / synthetic data</div>
        </header>
        <main ref={mainRef} tabIndex={-1}>
          <div hidden={view !== "refunds"}><RefundsView /></div>
          {flagsVisited ? <div hidden={view !== "flags"}><FlagsView /></div> : null}
          {previewVisited ? <div hidden={view !== "preview"}><CustomerPreviewView active={view === "preview"} /></div> : null}
        </main>
        <footer><span>Northstar local POC</span><span>All displayed data is synthetic · State resets on restart</span></footer>
      </div>
    </div>
  );
}
