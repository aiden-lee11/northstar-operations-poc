import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { errorMessage, stateSummary, titleCase } from "../../lib/format";
import type { DemoAccount, Environment, FlagEvaluation, FlagEvaluationResponse } from "../../lib/models";
import { InlineState } from "../../components/SharedDialog";

const FLAG_KEY = "new_checkout_flow";

const CART = [
  { sku: "NS-4410", name: "Field notebook, 2-pack", quantity: 1, price: "$18.00" },
  { sku: "NS-2201", name: "Insulated travel mug", quantity: 2, price: "$46.00" },
  { sku: "NS-9075", name: "Cable organizer set", quantity: 1, price: "$12.50" },
];
const CART_TOTAL = "$76.50";

function reasonText(evaluation: FlagEvaluation, label: string): string {
  const range = `buckets 0–${(evaluation.threshold - 1).toLocaleString()}`;
  switch (evaluation.reason) {
    case "flag_disabled":
      return `${label} sees the old checkout because ${FLAG_KEY} is disabled in ${evaluation.environment}; the bucket is not consulted.`;
    case "rollout_zero":
      return `${label} sees the old checkout because the ${evaluation.environment} rollout is 0%, so no bucket is included.`;
    case "bucket_within_rollout":
      return `${label} sees the new checkout because bucket ${evaluation.bucket.toLocaleString()} falls inside the ${evaluation.rollout_percent}% rollout (${range}).`;
    default:
      return `${label} sees the old checkout because bucket ${evaluation.bucket.toLocaleString()} falls outside the ${evaluation.rollout_percent}% rollout (${range}).`;
  }
}

export function CustomerPreviewView({ active }: { active: boolean }) {
  const [environment, setEnvironment] = useState<Environment>("staging");
  const [accountId, setAccountId] = useState("");
  const [data, setData] = useState<FlagEvaluationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const requestedEnvironment = environment;
    setLoading(true);
    setError("");
    api
      .listEvaluations(FLAG_KEY, requestedEnvironment, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (payload.environment !== requestedEnvironment) throw new Error("Environment response mismatch.");
        setData(payload);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || (requestError instanceof DOMException && requestError.name === "AbortError")) return;
        setData(null);
        setError(errorMessage(requestError));
        setLoading(false);
      });
    return () => controller.abort();
  }, [active, environment, reloadToken]);

  const accounts: DemoAccount[] = data?.accounts ?? [];
  const evaluations = useMemo(() => new Map((data?.evaluations ?? []).map((item) => [item.account_id, item])), [data]);
  const selectedId = accounts.some((account) => account.id === accountId) ? accountId : accounts[0]?.id ?? "";
  const selectedAccount = accounts.find((account) => account.id === selectedId) ?? null;
  const selected = selectedId ? evaluations.get(selectedId) ?? null : null;
  const includedCount = (data?.evaluations ?? []).filter((item) => item.decision).length;

  return (
    <section className="view" aria-labelledby="preview-title">
      <div className="page-heading flags-heading">
        <div>
          <div className="eyebrow">Flag consumer</div>
          <h1 id="preview-title">Customer preview</h1>
          <p>
            A synthetic storefront that renders whichever checkout the backend evaluator selects for the chosen demo account.
            Every decision here comes from the same in-memory flag configuration the admin panel changes.
          </p>
        </div>
        <label className="environment-control">
          <span>Environment</span>
          <select
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as Environment)}
          >
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </label>
      </div>

      <div className="preview-toolbar">
        <span aria-live="polite">
          {loading
            ? "Evaluating demo accounts…"
            : error
              ? "Evaluation unavailable"
              : data
                ? `${includedCount} of ${data.evaluations.length} demo accounts receive the new checkout · ${stateSummary(data.flag.enabled, data.flag.rollout_percent)} · v${data.flag.version}`
                : ""}
        </span>
        <button className="secondary-button" type="button" onClick={reload}>Refresh decisions</button>
      </div>

      {loading && !data ? <InlineState message={`Evaluating ${FLAG_KEY} in ${environment}…`} /> : null}
      {error ? <InlineState message={`Could not evaluate the flag: ${error}`} error onRetry={reload} /> : null}

      {data && selected && selectedAccount ? (
        <div className="preview-layout">
          <div className="panel account-panel">
            <div className="panel-header">
              <div><h2>Demo accounts</h2><p>Synthetic identities, no real customers</p></div>
            </div>
            <ul className="account-list">
              {accounts.map((account) => {
                const evaluation = evaluations.get(account.id);
                const isSelected = account.id === selectedId;
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      className={`account-item${isSelected ? " active" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => setAccountId(account.id)}
                    >
                      <span className="account-name"><strong>{account.label}</strong><small>{account.segment}</small></span>
                      <span className="account-decision">
                        <span className={`status-badge status-${evaluation?.decision ? "enabled" : "disabled"}`}>
                          {evaluation?.decision ? "New" : "Old"}
                        </span>
                        <small>Bucket {evaluation?.bucket.toLocaleString() ?? "—"}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="sample-note">
              This sample of {accounts.length} accounts is far too small for its share to match the configured percentage; the counts above are computed, not projected.
            </p>
          </div>

          <div className="preview-main">
            <div className="panel decision-panel">
              <div className="panel-header">
                <div><h2>Why {selectedAccount.label} sees this</h2><p>Read-only evaluation · no audit event is created</p></div>
                <span className={`status-badge status-${selected.decision ? "enabled" : "disabled"}`}>{selected.decision ? "New checkout" : "Old checkout"}</span>
              </div>
              <p className="decision-reason">{reasonText(selected, selectedAccount.label)}</p>
              <div className="detail-grid">
                <div className="detail-item"><span>Account bucket</span><strong>{selected.bucket.toLocaleString()} of {selected.bucket_count.toLocaleString()}</strong></div>
                <div className="detail-item"><span>Rollout</span><strong>{selected.rollout_percent}%</strong></div>
                <div className="detail-item"><span>Flag state</span><strong>{selected.enabled ? "Enabled" : "Disabled"}</strong></div>
                <div className="detail-item"><span>Configuration version</span><strong>v{selected.version}</strong></div>
                <div className="detail-item"><span>Environment</span><strong>{titleCase(selected.environment)}</strong></div>
                <div className="detail-item"><span>Account ID</span><strong>{selected.account_id}</strong></div>
              </div>
              <p className="sample-note">
                The bucket is a SHA-256 assignment over flag key, environment, and account ID, so it stays the same across
                refreshes, configuration changes, and server restarts.
              </p>
            </div>

            {selected.decision ? <NewCheckout account={selectedAccount} /> : <OldCheckout account={selectedAccount} />}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CheckoutDisclosure() {
  return (
    <p className="checkout-disclosure">
      Illustration only. No payment details are collected, no provider is called, and no money moves.
    </p>
  );
}

function OldCheckout({ account }: { account: DemoAccount }) {
  return (
    <section className="panel checkout checkout-old" aria-label="Old checkout experience">
      <div className="panel-header"><div><h2>Checkout</h2><p>Current experience · single page</p></div><span className="env-badge">Old layout</span></div>
      <table className="checkout-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th></tr></thead>
        <tbody>
          {CART.map((line) => (
            <tr key={line.sku}><td>{line.name}<small> · {line.sku}</small></td><td>{line.quantity}</td><td>{line.price}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="checkout-total"><span>Order total</span><strong>{CART_TOTAL}</strong></div>
      <p className="checkout-note">Shipping to {account.label}’s synthetic address on file.</p>
      <button className="primary-button" type="button" disabled>Place order (disabled in demo)</button>
      <CheckoutDisclosure />
    </section>
  );
}

function NewCheckout({ account }: { account: DemoAccount }) {
  return (
    <section className="panel checkout checkout-new" aria-label="New checkout experience">
      <div className="panel-header"><div><h2>Express checkout</h2><p>Streamlined experience · three steps</p></div><span className="env-badge">New layout</span></div>
      <ol className="checkout-steps">
        <li className="done"><strong>Cart</strong><small>{CART.length} items · {CART_TOTAL}</small></li>
        <li className="done"><strong>Delivery</strong><small>Saved synthetic address for {account.label}</small></li>
        <li className="current"><strong>Review</strong><small>One-tap confirmation</small></li>
      </ol>
      <div className="checkout-summary-cards">
        {CART.map((line) => (
          <div className="checkout-line" key={line.sku}><strong>{line.name}</strong><span>{line.quantity} × {line.price}</span></div>
        ))}
      </div>
      <div className="checkout-total"><span>Order total</span><strong>{CART_TOTAL}</strong></div>
      <button className="primary-button" type="button" disabled>Confirm in one tap (disabled in demo)</button>
      <CheckoutDisclosure />
    </section>
  );
}
