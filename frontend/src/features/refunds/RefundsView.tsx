import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { errorMessage, formatDate, formatMoney, titleCase } from "../../lib/format";
import type { Refund, RefundStatus, RefundSummary } from "../../lib/models";
import { InlineState, SharedDialog } from "../../components/SharedDialog";

const emptySummary: RefundSummary = {
  total_count: 0,
  total_amount_cents: 0,
  pending_count: 0,
  failed_count: 0,
  completed_count: 0,
  currency: "USD",
};

export function RefundsView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RefundStatus | "">("");
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Refund | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const closeDetailRef = useRef<HTMLButtonElement>(null);

  const retry = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api
        .listRefunds(query.trim(), status, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setRefunds(data.refunds);
          setSummary(data.summary);
          setLoading(false);
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted || requestError instanceof DOMException && requestError.name === "AbortError") return;
          setRefunds([]);
          setError(errorMessage(requestError));
          setLoading(false);
        });
    }, query ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, reloadToken]);

  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    api
      .getRefund(detailId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetail(data);
        setDetailLoading(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || requestError instanceof DOMException && requestError.name === "AbortError") return;
        setDetailError(errorMessage(requestError));
        setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailId, detailReloadToken]);

  const activeSummary = summary ?? emptySummary;
  const hasFilters = Boolean(query || status);

  return (
    <section className="view" aria-labelledby="refunds-title">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Payment operations</div>
          <div className="title-line">
            <h1 id="refunds-title">Refunds</h1>
            <span className="read-only-badge">Read-only</span>
          </div>
          <p>Review historical synthetic refund records and provider state. No funds can be moved from this console.</p>
        </div>
        <div className="history-note">Historical demo records</div>
      </div>

      <div className="summary-grid" aria-label="Full synthetic dataset summary">
        <article className="summary-card accent-card">
          <span>Total requested amount</span>
          <strong>{summary ? formatMoney(activeSummary.total_amount_cents) : "—"}</strong>
          <small>Across all synthetic records</small>
        </article>
        <article className="summary-card">
          <span>Total records</span>
          <strong>{summary ? activeSummary.total_count : "—"}</strong>
          <small>Entire demo dataset</small>
        </article>
        <article className="summary-card">
          <span>Pending</span>
          <strong>{summary ? activeSummary.pending_count : "—"}</strong>
          <small>Awaiting another step</small>
        </article>
        <article className="summary-card">
          <span>Failed</span>
          <strong>{summary ? activeSummary.failed_count : "—"}</strong>
          <small>Requires review</small>
        </article>
      </div>

      <div className="content-grid refunds-grid">
        <section className="panel records-panel" aria-labelledby="refund-list-title">
          <div className="panel-header records-header">
            <div>
              <h2 id="refund-list-title">Refund records</h2>
              <p aria-live="polite">
                {loading ? "Loading records…" : error ? "Records unavailable" : `${refunds.length} ${refunds.length === 1 ? "record" : "records"} shown`}
              </p>
            </div>
            {hasFilters ? (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <form className="filter-bar" role="search" onSubmit={(event) => event.preventDefault()}>
            <label className="search-field">
              <span className="sr-only">Search refunds</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
              <input
                name="query"
                type="search"
                placeholder="Search ID, customer, payment or reason"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="select-field">
              <span className="sr-only">Filter by refund status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as RefundStatus | "")}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </form>
          {loading ? <InlineState message="Loading synthetic records…" /> : null}
          {!loading && error ? <InlineState message={`Could not load refunds: ${error}`} error onRetry={retry} /> : null}
          {!loading && !error && refunds.length === 0 ? (
            <InlineState message="No synthetic records match these filters. Clear or adjust the filters." />
          ) : null}
          {!loading && !error && refunds.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Refund ID</th><th scope="col">Customer</th><th scope="col">Amount</th><th scope="col">Reason</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <td className="id-cell">{refund.id}</td>
                      <td className="customer-cell">{refund.customer}</td>
                      <td className="amount-cell">{formatMoney(refund.amount_cents)}</td>
                      <td>{titleCase(refund.reason)}</td>
                      <td><span className={`status-badge status-${refund.status}`}>{titleCase(refund.status)}</span></td>
                      <td>{formatDate(refund.created_at)}</td>
                      <td><button className="details-button" type="button" aria-label={`View details for ${refund.id}`} onClick={() => setDetailId(refund.id)}>Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <aside className="help-panel">
          <div className="help-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.5 3.1 7.8 7.5 9.5 4.4-1.7 7.5-5 7.5-9.5V6L12 3Z" /><path d="M9.5 12 11 13.5l3.5-4" /></svg></div>
          <h2>Read-only by design</h2>
          <p>This view supports investigation without exposing an action that could execute or retry a refund.</p>
          <div className="help-rule" />
          <strong>Provider uncertainty</strong>
          <p>A timeout does not confirm whether funds moved. Reconcile provider state before any retry outside this demo.</p>
        </aside>
      </div>

      <SharedDialog open={detailId !== null} onClose={() => setDetailId(null)} labelledBy="refund-dialog-title" initialFocusRef={closeDetailRef}>
        <div className="modal-head">
          <div><span className="eyebrow">Historical record</span><h2 id="refund-dialog-title">{detailId ?? "Refund details"}</h2></div>
          <button ref={closeDetailRef} className="icon-button" type="button" onClick={() => setDetailId(null)} aria-label="Close refund details">×</button>
        </div>
        {detailLoading ? <InlineState message="Loading refund details…" /> : null}
        {!detailLoading && detailError ? <InlineState message={`Could not load details: ${detailError}`} error onRetry={() => setDetailReloadToken((value) => value + 1)} /> : null}
        {!detailLoading && detail ? <RefundDetail refund={detail} /> : null}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDetailId(null)}>Close</button></div>
      </SharedDialog>
    </section>
  );
}

function RefundDetail({ refund }: { refund: Refund }) {
  const latest = refund.timeline.at(-1);
  const details = [
    ["Customer", refund.customer],
    ["Payment reference", refund.payment_id],
    ["Provider reference", refund.provider_reference],
    ["Owner", refund.owner],
    ["Reason", titleCase(refund.reason)],
    ["Requested", `Historical · ${formatDate(refund.created_at, true)}`],
  ];
  return (
    <div className="refund-detail-body">
      <div className="detail-hero"><div><span>{refund.id}</span><strong>{formatMoney(refund.amount_cents)}</strong></div><span className={`status-badge status-${refund.status}`}>{titleCase(refund.status)}</span></div>
      <div className="detail-grid">
        {details.map(([label, value]) => <div className="detail-item" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="state-explanation">{latest?.detail ?? "No additional state explanation is available."}</div>
      <span className="timeline-title">Timestamped timeline</span>
      <ol className="timeline">
        {refund.timeline.map((event) => <li key={`${event.timestamp}-${event.event}`}><strong>{titleCase(event.event)}</strong><p>{event.detail}</p><small>Historical · {formatDate(event.timestamp, true)}</small></li>)}
      </ol>
    </div>
  );
}
