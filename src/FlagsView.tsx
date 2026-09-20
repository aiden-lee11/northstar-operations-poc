import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "./api";
import { errorMessage, formatDate, stateSummary, titleCase } from "./format";
import type { AuditEvent, Environment, Flag } from "./models";
import { InlineState, SharedDialog } from "./SharedDialog";

export function FlagsView() {
  const [environment, setEnvironment] = useState<Environment>("staging");
  const [flags, setFlags] = useState<Flag[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [changeFlag, setChangeFlag] = useState<Flag | null>(null);
  const [rollbackReview, setRollbackReview] = useState<{ flag: Flag; source: AuditEvent } | null>(null);
  const [mutationPending, setMutationPending] = useState(false);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const requestedEnvironment = environment;
    setLoading(true);
    setError("");
    setFlags([]);
    setAudit([]);
    Promise.all([
      api.listFlags(requestedEnvironment, controller.signal),
      api.listAudit(requestedEnvironment, controller.signal),
    ])
      .then(([flagData, auditData]) => {
        if (controller.signal.aborted) return;
        if (flagData.environment !== requestedEnvironment || auditData.environment !== requestedEnvironment) {
          throw new Error("Environment response mismatch.");
        }
        setFlags(flagData.flags);
        setAudit(auditData.events);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(errorMessage(requestError));
        setLoading(false);
      });
    return () => controller.abort();
  }, [environment, reloadToken]);

  const filteredFlags = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return flags.filter((flag) => `${flag.name} ${flag.key} ${flag.owner} ${flag.description}`.toLocaleLowerCase().includes(normalized));
  }, [flags, query]);

  const matchingAudit = useCallback((key: string) => audit.filter((event) => event.key === key), [audit]);

  const switchEnvironment = (nextEnvironment: Environment) => {
    setChangeFlag(null);
    setRollbackReview(null);
    setQuery("");
    setEnvironment(nextEnvironment);
  };

  return (
    <section className="view" aria-labelledby="flags-title">
      <div className="page-heading flags-heading">
        <div>
          <div className="eyebrow">Release operations</div>
          <h1 id="flags-title">Feature flags</h1>
          <p>Review and simulate controlled configuration changes. Every change requires a reason and creates an in-memory audit event.</p>
        </div>
        <label className="environment-control">
          <span>Environment</span>
          <select value={environment} disabled={mutationPending} onChange={(event) => switchEnvironment(event.target.value as Environment)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </label>
      </div>

      {environment === "production" ? (
        <div className="caution-banner" role="note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5m0 3v.1" /></svg>
          <div><strong>Production simulation selected</strong><p>This remains synthetic and local. Exact flag-key confirmation is required to model a deliberate production workflow.</p></div>
        </div>
      ) : null}

      <div className="flags-layout">
        <div>
          <div className="flag-toolbar">
            <label className="search-field">
              <span className="sr-only">Search feature flags</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
              <input type="search" placeholder="Search flags, keys or owners" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <span aria-live="polite">{loading ? "Loading flags…" : error ? "Flags unavailable" : `${filteredFlags.length} of ${flags.length} flags`}</span>
          </div>
          {loading ? <InlineState message={`Loading ${environment} flags…`} /> : null}
          {!loading && error ? <InlineState message={`Could not load flags: ${error}`} error onRetry={reload} /> : null}
          {!loading && !error && filteredFlags.length === 0 ? <InlineState message="No synthetic flags match this search." /> : null}
          {!loading && !error && filteredFlags.length > 0 ? (
            <div className="flag-list">
              {filteredFlags.map((flag) => {
                const rollbackSource = matchingAudit(flag.key)[0] ?? null;
                const canRollback = rollbackSource !== null;
                return (
                  <article className="flag-card" key={flag.key}>
                    <div className="flag-card-head"><div><h2>{flag.name}</h2><code className="flag-key">{flag.key}</code></div><span className={`risk-badge risk-${flag.risk}`}>{titleCase(flag.risk)} risk</span></div>
                    <p className="flag-description">{flag.description}</p>
                    <div className="flag-meta"><div className="flag-meta-item"><span>Owner</span><strong>{flag.owner}</strong></div><div className="flag-meta-item"><span>Version</span><strong>v{flag.version}</strong></div></div>
                    <div className="flag-state-line"><span className={`status-badge status-${flag.enabled ? "enabled" : "disabled"}`}>{flag.enabled ? "Enabled" : "Disabled"}</span><div className="flag-state-detail"><span>Rollout</span><strong>{flag.rollout_percent}%</strong></div></div>
                    <div className="flag-actions">
                      <button className="primary-button" type="button" disabled={mutationPending} onClick={() => setChangeFlag(flag)}>Review change</button>
                      <button className="secondary-button" type="button" disabled={!canRollback || mutationPending} title={canRollback ? "Review restoration of the prior configuration" : "No audit history is available for this flag"} onClick={() => rollbackSource && setRollbackReview({ flag, source: rollbackSource })}>Rollback</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
        <aside className="principles-panel">
          <h2>Change principles</h2>
          <div className="principle"><span>01</span><div><strong>Changes have a reason</strong><p>Short context is captured with each audited change.</p></div></div>
          <div className="principle"><span>02</span><div><strong>Versions prevent surprises</strong><p>Stale updates stop instead of replacing newer state.</p></div></div>
          <div className="principle"><span>03</span><div><strong>Rollback is a new change</strong><p>Restoring prior configuration creates another audit entry.</p></div></div>
        </aside>
      </div>

      <section className="panel audit-panel" aria-labelledby="audit-title">
        <div className="panel-header"><div><h2 id="audit-title">Recent audit history</h2><p>{titleCase(environment)} environment</p></div><span className="actor-note">Actor: Demo operator</span></div>
        {loading ? <InlineState message="Loading audit history…" /> : null}
        {!loading && error ? <InlineState message="Audit history is unavailable until the environment reloads." error /> : null}
        {!loading && !error && audit.length === 0 ? <InlineState message="No audited changes yet in this environment. Seed state is not presented as operator history." /> : null}
        {!loading && !error && audit.length > 0 ? (
          <div className="audit-list">
            {audit.map((event) => <AuditRow event={event} key={event.id} />)}
          </div>
        ) : null}
      </section>

      <ChangeDialog
        flag={changeFlag}
        onClose={() => setChangeFlag(null)}
        onPendingChange={setMutationPending}
        onChanged={reload}
      />
      <RollbackDialog
        flag={rollbackReview?.flag ?? null}
        source={rollbackReview?.source ?? null}
        onClose={() => setRollbackReview(null)}
        onPendingChange={setMutationPending}
        onChanged={reload}
      />
    </section>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  return (
    <article className="audit-event">
      <span className="audit-dot" aria-hidden="true" />
      <div>
        <div className="audit-title"><strong>{event.actor}</strong><span>{event.action === "rolled_back" ? "rolled back" : "updated"}</span><code>{event.key}</code></div>
        <p className="audit-change">{stateSummary(event.before.enabled, event.before.rollout_percent)} → {stateSummary(event.after.enabled, event.after.rollout_percent)}</p>
        <p>Reason: {event.reason}</p>
      </div>
      <time className="audit-time" dateTime={event.timestamp}>{formatDate(event.timestamp, true)}</time>
    </article>
  );
}

interface DialogCallbacks {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onChanged: () => void;
}

function ChangeDialog({ flag, onClose, onPendingChange, onChanged }: DialogCallbacks & { flag: Flag | null }) {
  const [enabled, setEnabled] = useState(false);
  const [rollout, setRollout] = useState(0);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [formError, setFormError] = useState("");
  const enabledRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!flag) return;
    setEnabled(flag.enabled);
    setRollout(flag.rollout_percent);
    setReason("");
    setConfirmation("");
    setPending(false);
    setStale(false);
    setFormError("");
  }, [flag]);

  const noOp = flag ? enabled === flag.enabled && rollout === flag.rollout_percent : true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flag || pending || stale) return;
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 8 || normalizedReason.length > 500) {
      setFormError("Reason must contain 8 to 500 characters after trimming.");
      return;
    }
    if (flag.environment === "production" && confirmation !== flag.key) {
      setFormError(`Type ${flag.key} exactly to confirm.`);
      return;
    }
    if (noOp) {
      setFormError("Change enabled or rollout percentage before confirming.");
      return;
    }
    setPending(true);
    onPendingChange(true);
    setFormError("");
    try {
      await api.updateFlag(flag.key, {
        environment: flag.environment,
        enabled,
        rollout_percent: rollout,
        reason,
        expected_version: flag.version,
        confirmation,
      });
      onClose();
      onChanged();
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setStale(true);
        setFormError("This flag changed after the review opened. Current state was reloaded; close this dialog and review the change again.");
        onChanged();
      } else {
        setFormError(errorMessage(requestError));
      }
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  };

  return (
    <SharedDialog open={flag !== null} onClose={pending ? () => undefined : onClose} className="change-modal" labelledBy="change-dialog-title" initialFocusRef={enabledRef}>
      <form onSubmit={submit}>
        <div className="modal-head"><div><span className="eyebrow">Review configuration</span><h2 id="change-dialog-title">Review {flag?.name ?? "change"}</h2></div><button className="icon-button" type="button" disabled={pending} onClick={onClose} aria-label="Close change review">×</button></div>
        {flag ? <p className="modal-intro">{titleCase(flag.environment)} simulation · Version {flag.version} · Changes are attributed to Demo operator.</p> : null}
        <fieldset className="form-fieldset" disabled={pending}>
          <div className="form-grid">
            <label className="toggle-field"><span><strong>Enabled</strong><small>Flag evaluation state</small></span><input ref={enabledRef} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><i aria-hidden="true" /></label>
            <label><span>Rollout percentage</span><div className="input-suffix"><input type="number" min="0" max="100" step="1" required value={Number.isNaN(rollout) ? "" : rollout} onChange={(event) => setRollout(event.target.valueAsNumber)} /><span>%</span></div></label>
            <label className="full-field"><span>Reason <small>Required, 8–500 characters</small></span><textarea minLength={8} maxLength={500} rows={3} required placeholder="Explain why this change is appropriate" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            {flag?.environment === "production" ? <label className="full-field confirmation-field"><span>Type <code>{flag.key}</code> to confirm</span><input type="text" autoComplete="off" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label> : null}
          </div>
          {flag ? <div className="preview-box" aria-labelledby="change-preview-title"><strong id="change-preview-title">Before and after</strong><div className="comparison"><div><span>Before</span><b>{stateSummary(flag.enabled, flag.rollout_percent)}</b></div><span aria-hidden="true">→</span><div><span>After</span><b>{stateSummary(enabled, Number.isNaN(rollout) ? "—" : rollout)}</b></div></div></div> : null}
        </fieldset>
        <p className="form-error" role="alert">{formError}</p>
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={pending || stale || noOp}>{pending ? "Applying…" : "Confirm change"}</button></div>
      </form>
    </SharedDialog>
  );
}

function RollbackDialog({ flag, source, onClose, onPendingChange, onChanged }: DialogCallbacks & { flag: Flag | null; source: AuditEvent | null }) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [formError, setFormError] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!flag) return;
    setReason("");
    setConfirmation("");
    setPending(false);
    setStale(false);
    setFormError("");
  }, [flag]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flag || !source || pending || stale) return;
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 8 || normalizedReason.length > 500) {
      setFormError("Reason must contain 8 to 500 characters after trimming.");
      return;
    }
    if (flag.environment === "production" && confirmation !== flag.key) {
      setFormError(`Type ${flag.key} exactly to confirm.`);
      return;
    }
    setPending(true);
    onPendingChange(true);
    setFormError("");
    try {
      await api.rollbackFlag(flag.key, {
        environment: flag.environment,
        reason,
        expected_version: flag.version,
        confirmation,
      });
      onClose();
      onChanged();
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setStale(true);
        setFormError("This flag changed after the rollback review opened. Current state was reloaded; close this dialog and review rollback again.");
        onChanged();
      } else {
        setFormError(errorMessage(requestError));
      }
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  };

  return (
    <SharedDialog open={flag !== null && source !== null} onClose={pending ? () => undefined : onClose} className="change-modal" labelledBy="rollback-dialog-title" initialFocusRef={reasonRef}>
      <form onSubmit={submit}>
        <div className="modal-head"><div><span className="eyebrow">Audited restoration</span><h2 id="rollback-dialog-title">Rollback {flag?.name ?? "flag"}</h2></div><button className="icon-button" type="button" disabled={pending} onClick={onClose} aria-label="Close rollback review">×</button></div>
        {flag ? <p className="modal-intro">This creates a new audited change in {flag.environment}; it does not erase history.</p> : null}
        {flag && source ? <div className="preview-box"><strong>Configuration preview</strong><div className="comparison"><div><span>Current</span><b>{stateSummary(flag.enabled, flag.rollout_percent)}</b></div><span aria-hidden="true">→</span><div><span>Restore</span><b>{stateSummary(source.before.enabled, source.before.rollout_percent)}</b></div></div></div> : null}
        <fieldset className="form-fieldset" disabled={pending}>
          <div className="form-grid compact-form">
            <label className="full-field"><span>Reason <small>Required, 8–500 characters</small></span><textarea ref={reasonRef} minLength={8} maxLength={500} rows={3} required placeholder="Explain why the prior configuration should be restored" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            {flag?.environment === "production" ? <label className="full-field confirmation-field"><span>Type <code>{flag.key}</code> to confirm</span><input type="text" autoComplete="off" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label> : null}
          </div>
        </fieldset>
        <p className="form-error" role="alert">{formError}</p>
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="danger-button" type="submit" disabled={pending || stale}>{pending ? "Restoring…" : "Confirm rollback"}</button></div>
      </form>
    </SharedDialog>
  );
}
