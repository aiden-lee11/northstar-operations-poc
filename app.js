"use strict";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD"
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
});

const refundState = {
  controller: null,
  detailController: null,
  sequence: 0
};

const flagState = {
  environment: "staging",
  flags: [],
  audit: [],
  controller: null,
  sequence: 0,
  selected: null,
  rollbackSource: null,
  changeStale: false,
  rollbackStale: false
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(cents) {
  return currencyFormatter.format(cents / 100);
}

function formatDate(value, withTime = false) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown historical time";
  return (withTime ? dateTimeFormatter : dateFormatter).format(parsed);
}

function titleCase(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function setInlineState(container, message, isError = false, retry = null) {
  container.replaceChildren();
  container.classList.toggle("error-state", isError);
  container.append(element("span", "", message));
  if (retry) {
    const button = element("button", "details-button", "Try again");
    button.type = "button";
    button.addEventListener("click", retry);
    container.append(document.createTextNode(" "));
    container.append(button);
  }
  container.hidden = false;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? {
      "Content-Type": "application/json",
      "X-Demo-Request": "1",
      ...(options.headers || {})
    } : options.headers
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error("The local server returned an unreadable response.");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.error?.message || "The local request failed.");
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

function setView(viewName, updateHash = true) {
  const isFlags = viewName === "flags";
  document.querySelector("#refunds-view").hidden = isFlags;
  document.querySelector("#flags-view").hidden = !isFlags;
  document.querySelectorAll(".nav-item").forEach(button => {
    const active = button.dataset.view === viewName;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (updateHash) history.replaceState(null, "", `#${viewName}`);
  if (isFlags && flagState.flags.length === 0) loadFlags();
  document.querySelector("main").focus({preventScroll: true});
}

function renderRefunds(items) {
  const body = document.querySelector("#refund-table-body");
  body.replaceChildren();
  items.forEach(refund => {
    const row = document.createElement("tr");
    row.append(element("td", "id-cell", refund.id));
    row.append(element("td", "customer-cell", refund.customer));
    row.append(element("td", "amount-cell", formatMoney(refund.amount_cents)));
    row.append(element("td", "", titleCase(refund.reason)));
    const statusCell = document.createElement("td");
    statusCell.append(element("span", `status-badge status-${refund.status}`, titleCase(refund.status)));
    row.append(statusCell);
    row.append(element("td", "", formatDate(refund.created_at)));
    const actionCell = document.createElement("td");
    const details = element("button", "details-button", "Details");
    details.type = "button";
    details.setAttribute("aria-label", `View details for ${refund.id}`);
    details.addEventListener("click", () => openRefundDetail(refund.id));
    actionCell.append(details);
    row.append(actionCell);
    body.append(row);
  });
}

function renderRefundSummary(summary) {
  document.querySelector("#summary-amount").textContent = formatMoney(summary.total_amount_cents);
  document.querySelector("#summary-total").textContent = String(summary.total_count);
  document.querySelector("#summary-pending").textContent = String(summary.pending_count);
  document.querySelector("#summary-failed").textContent = String(summary.failed_count);
}

async function loadRefunds() {
  refundState.controller?.abort();
  refundState.controller = new AbortController();
  const sequence = ++refundState.sequence;
  const query = document.querySelector("#refund-query").value.trim();
  const status = document.querySelector("#refund-status").value;
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status) params.set("status", status);
  const state = document.querySelector("#refund-state");
  const table = document.querySelector("#refund-table-wrap");
  const clear = document.querySelector("#clear-refund-filters");
  setInlineState(state, "Loading synthetic records…");
  table.hidden = true;
  clear.hidden = !query && !status;
  try {
    const data = await apiRequest(`/api/refunds?${params}`, {signal: refundState.controller.signal});
    if (sequence !== refundState.sequence) return;
    renderRefundSummary(data.summary);
    renderRefunds(data.refunds);
    document.querySelector("#refund-count").textContent = `${data.refunds.length} ${data.refunds.length === 1 ? "record" : "records"} shown`;
    if (data.refunds.length === 0) {
      setInlineState(state, "No synthetic records match these filters. Clear or adjust the filters.");
    } else {
      state.hidden = true;
      table.hidden = false;
    }
  } catch (error) {
    if (error.name === "AbortError" || sequence !== refundState.sequence) return;
    document.querySelector("#refund-count").textContent = "Records unavailable";
    setInlineState(state, `Could not load refunds: ${error.message}`, true, loadRefunds);
  }
}

function detailItem(label, value) {
  const item = element("div", "detail-item");
  item.append(element("span", "", label), element("strong", "", value));
  return item;
}

function renderRefundDetail(refund) {
  const content = document.querySelector("#refund-dialog-content");
  const body = element("div", "refund-detail-body");
  const hero = element("div", "detail-hero");
  const heroText = document.createElement("div");
  heroText.append(element("span", "", refund.id), element("strong", "", formatMoney(refund.amount_cents)));
  hero.append(heroText, element("span", `status-badge status-${refund.status}`, titleCase(refund.status)));
  const grid = element("div", "detail-grid");
  grid.append(
    detailItem("Customer", refund.customer),
    detailItem("Payment reference", refund.payment_id),
    detailItem("Provider reference", refund.provider_reference),
    detailItem("Owner", refund.owner),
    detailItem("Reason", titleCase(refund.reason)),
    detailItem("Requested", `Historical · ${formatDate(refund.created_at, true)}`)
  );
  const latest = refund.timeline.at(-1);
  const explanation = element("div", "state-explanation", latest?.detail || "No additional state explanation is available.");
  const timelineTitle = element("span", "timeline-title", "Timestamped timeline");
  const timeline = element("ol", "timeline");
  refund.timeline.forEach(event => {
    const item = document.createElement("li");
    item.append(
      element("strong", "", titleCase(event.event)),
      element("p", "", event.detail),
      element("small", "", `Historical · ${formatDate(event.timestamp, true)}`)
    );
    timeline.append(item);
  });
  body.append(hero, grid, explanation, timelineTitle, timeline);
  content.replaceChildren(body);
}

async function openRefundDetail(refundId) {
  refundState.detailController?.abort();
  refundState.detailController = new AbortController();
  const dialog = document.querySelector("#refund-dialog");
  document.querySelector("#refund-dialog-title").textContent = refundId;
  const content = document.querySelector("#refund-dialog-content");
  setInlineState(content, "Loading refund details…");
  if (!dialog.open) dialog.showModal();
  try {
    const refund = await apiRequest(`/api/refunds/${encodeURIComponent(refundId)}`, {signal: refundState.detailController.signal});
    if (!dialog.open) return;
    renderRefundDetail(refund);
  } catch (error) {
    if (error.name === "AbortError") return;
    setInlineState(content, `Could not load details: ${error.message}`, true, () => openRefundDetail(refundId));
  }
}

function stateSummary(enabled, rollout) {
  return `${enabled ? "Enabled" : "Disabled"} · ${rollout}% rollout`;
}

function matchingAudit(key) {
  return flagState.audit.filter(event => event.key === key);
}

function renderFlags() {
  const query = document.querySelector("#flag-query").value.trim().toLocaleLowerCase();
  const filtered = flagState.flags.filter(flag => {
    const searchable = `${flag.name} ${flag.key} ${flag.owner} ${flag.description}`.toLocaleLowerCase();
    return searchable.includes(query);
  });
  const list = document.querySelector("#flag-list");
  const state = document.querySelector("#flags-state");
  list.replaceChildren();
  document.querySelector("#flag-count").textContent = `${filtered.length} of ${flagState.flags.length} flags`;
  filtered.forEach(flag => {
    const card = element("article", "flag-card");
    const head = element("div", "flag-card-head");
    const titleWrap = document.createElement("div");
    titleWrap.append(element("h2", "", flag.name), element("code", "flag-key", flag.key));
    head.append(titleWrap, element("span", `risk-badge risk-${flag.risk}`, `${titleCase(flag.risk)} risk`));
    const description = element("p", "flag-description", flag.description);
    const meta = element("div", "flag-meta");
    const owner = element("div", "flag-meta-item");
    owner.append(element("span", "", "Owner"), element("strong", "", flag.owner));
    const version = element("div", "flag-meta-item");
    version.append(element("span", "", "Version"), element("strong", "", `v${flag.version}`));
    meta.append(owner, version);
    const stateLine = element("div", "flag-state-line");
    stateLine.append(element("span", `status-badge status-${flag.enabled ? "enabled" : "disabled"}`, flag.enabled ? "Enabled" : "Disabled"));
    const rollout = element("div", "flag-state-detail");
    rollout.append(element("span", "", "Rollout"), element("strong", "", `${flag.rollout_percent}%`));
    stateLine.append(rollout);
    const actions = element("div", "flag-actions");
    const review = element("button", "primary-button", "Review change");
    review.type = "button";
    review.addEventListener("click", () => openChangeDialog(flag));
    const rollback = element("button", "secondary-button", "Rollback");
    rollback.type = "button";
    rollback.disabled = matchingAudit(flag.key).length === 0;
    rollback.title = rollback.disabled ? "No audit history is available for this flag" : "Review restoration of the prior configuration";
    rollback.addEventListener("click", () => openRollbackDialog(flag));
    actions.append(review, rollback);
    card.append(head, description, meta, stateLine, actions);
    list.append(card);
  });
  if (filtered.length === 0) {
    list.hidden = true;
    setInlineState(state, "No synthetic flags match this search.");
  } else {
    state.hidden = true;
    list.hidden = false;
  }
}

function renderAudit() {
  const list = document.querySelector("#audit-list");
  const state = document.querySelector("#audit-state");
  list.replaceChildren();
  document.querySelector("#audit-subtitle").textContent = `${titleCase(flagState.environment)} environment`;
  if (flagState.audit.length === 0) {
    list.hidden = true;
    setInlineState(state, "No audited changes yet in this environment. Seed state is not presented as operator history.");
    return;
  }
  flagState.audit.forEach(event => {
    const row = element("article", "audit-event");
    row.append(element("span", "audit-dot"));
    const body = document.createElement("div");
    const title = element("div", "audit-title");
    title.append(
      element("strong", "", event.actor),
      document.createTextNode(event.action === "rolled_back" ? " rolled back " : " updated "),
      element("code", "", event.key)
    );
    const before = stateSummary(event.before.enabled, event.before.rollout_percent);
    const after = stateSummary(event.after.enabled, event.after.rollout_percent);
    body.append(title, element("p", "audit-change", `${before} → ${after}`), element("p", "", `Reason: ${event.reason}`));
    row.append(body, element("time", "audit-time", formatDate(event.timestamp, true)));
    list.append(row);
  });
  state.hidden = true;
  list.hidden = false;
}

async function loadFlags() {
  flagState.controller?.abort();
  flagState.controller = new AbortController();
  const sequence = ++flagState.sequence;
  const environment = flagState.environment;
  const params = new URLSearchParams({environment});
  const flagsState = document.querySelector("#flags-state");
  const auditState = document.querySelector("#audit-state");
  document.querySelector("#flag-list").hidden = true;
  document.querySelector("#audit-list").hidden = true;
  setInlineState(flagsState, `Loading ${environment} flags…`);
  setInlineState(auditState, "Loading audit history…");
  try {
    const [flagData, auditData] = await Promise.all([
      apiRequest(`/api/flags?${params}`, {signal: flagState.controller.signal}),
      apiRequest(`/api/audit?${params}`, {signal: flagState.controller.signal})
    ]);
    if (sequence !== flagState.sequence || environment !== flagState.environment) return;
    if (flagData.environment !== environment || auditData.environment !== environment) throw new Error("Environment response mismatch.");
    flagState.flags = flagData.flags;
    flagState.audit = auditData.events;
    renderFlags();
    renderAudit();
  } catch (error) {
    if (error.name === "AbortError" || sequence !== flagState.sequence) return;
    flagState.flags = [];
    flagState.audit = [];
    document.querySelector("#flag-count").textContent = "Flags unavailable";
    setInlineState(flagsState, `Could not load flags: ${error.message}`, true, loadFlags);
    setInlineState(auditState, "Audit history is unavailable until the environment reloads.", true);
  }
}

function updateChangePreview() {
  if (!flagState.selected) return;
  const enabled = document.querySelector("#change-enabled").checked;
  const rollout = document.querySelector("#change-rollout").value;
  document.querySelector("#change-after").textContent = stateSummary(enabled, rollout === "" ? "—" : rollout);
}

function setProductionConfirmation(prefix, key, isProduction) {
  const wrap = document.querySelector(`#${prefix}-confirmation-wrap`);
  const input = document.querySelector(`#${prefix}-confirmation`);
  document.querySelector(`#${prefix}-confirmation-key`).textContent = key;
  wrap.hidden = !isProduction;
  input.required = isProduction;
  input.value = "";
  input.setCustomValidity("");
}

function openChangeDialog(flag) {
  flagState.selected = flag;
  flagState.changeStale = false;
  document.querySelector("#change-dialog-title").textContent = `Review ${flag.name}`;
  document.querySelector("#change-context").textContent = `${titleCase(flag.environment)} simulation · Version ${flag.version} · Changes are attributed to Demo operator.`;
  document.querySelector("#change-enabled").checked = flag.enabled;
  document.querySelector("#change-rollout").value = String(flag.rollout_percent);
  document.querySelector("#change-reason").value = "";
  document.querySelector("#change-before").textContent = stateSummary(flag.enabled, flag.rollout_percent);
  document.querySelector("#change-error").textContent = "";
  document.querySelector("#change-submit").disabled = false;
  setProductionConfirmation("change", flag.key, flag.environment === "production");
  updateChangePreview();
  document.querySelector("#change-dialog").showModal();
  document.querySelector("#change-enabled").focus();
}

function openRollbackDialog(flag) {
  const source = matchingAudit(flag.key)[0];
  if (!source) return;
  flagState.selected = flag;
  flagState.rollbackSource = source;
  flagState.rollbackStale = false;
  document.querySelector("#rollback-dialog-title").textContent = `Rollback ${flag.name}`;
  document.querySelector("#rollback-context").textContent = `This creates a new audited change in ${flag.environment}; it does not erase history.`;
  document.querySelector("#rollback-before").textContent = stateSummary(flag.enabled, flag.rollout_percent);
  document.querySelector("#rollback-after").textContent = stateSummary(source.before.enabled, source.before.rollout_percent);
  document.querySelector("#rollback-reason").value = "";
  document.querySelector("#rollback-error").textContent = "";
  document.querySelector("#rollback-submit").disabled = false;
  setProductionConfirmation("rollback", flag.key, flag.environment === "production");
  document.querySelector("#rollback-dialog").showModal();
  document.querySelector("#rollback-reason").focus();
}

function validateConfirmation(prefix, key, environment) {
  const input = document.querySelector(`#${prefix}-confirmation`);
  if (environment === "production" && input.value !== key) {
    input.setCustomValidity(`Type ${key} exactly to confirm.`);
    input.reportValidity();
    return false;
  }
  input.setCustomValidity("");
  return true;
}

async function submitChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const flag = flagState.selected;
  if (!flag || flagState.changeStale || !form.reportValidity()) return;
  if (!validateConfirmation("change", flag.key, flag.environment)) return;
  const submit = document.querySelector("#change-submit");
  const errorNode = document.querySelector("#change-error");
  submit.disabled = true;
  submit.textContent = "Applying…";
  errorNode.textContent = "";
  const payload = {
    environment: flag.environment,
    enabled: document.querySelector("#change-enabled").checked,
    rollout_percent: document.querySelector("#change-rollout").valueAsNumber,
    reason: document.querySelector("#change-reason").value,
    expected_version: flag.version,
    confirmation: document.querySelector("#change-confirmation").value
  };
  try {
    await apiRequest(`/api/flags/${encodeURIComponent(flag.key)}`, {method: "POST", body: JSON.stringify(payload)});
    document.querySelector("#change-dialog").close();
    await loadFlags();
  } catch (error) {
    if (error.status === 409) {
      flagState.changeStale = true;
      errorNode.textContent = "This flag changed after the review opened. Current state was reloaded; close this dialog and review the change again.";
      await loadFlags();
    } else {
      errorNode.textContent = error.message;
    }
  } finally {
    submit.textContent = "Confirm change";
    submit.disabled = flagState.changeStale;
  }
}

async function submitRollback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const flag = flagState.selected;
  if (!flag || flagState.rollbackStale || !form.reportValidity()) return;
  if (!validateConfirmation("rollback", flag.key, flag.environment)) return;
  const submit = document.querySelector("#rollback-submit");
  const errorNode = document.querySelector("#rollback-error");
  submit.disabled = true;
  submit.textContent = "Restoring…";
  errorNode.textContent = "";
  const payload = {
    environment: flag.environment,
    reason: document.querySelector("#rollback-reason").value,
    expected_version: flag.version,
    confirmation: document.querySelector("#rollback-confirmation").value
  };
  try {
    await apiRequest(`/api/flags/${encodeURIComponent(flag.key)}/rollback`, {method: "POST", body: JSON.stringify(payload)});
    document.querySelector("#rollback-dialog").close();
    await loadFlags();
  } catch (error) {
    if (error.status === 409) {
      flagState.rollbackStale = true;
      errorNode.textContent = "This flag changed after the rollback review opened. Current state was reloaded; close this dialog and review rollback again.";
      await loadFlags();
    } else {
      errorNode.textContent = error.message;
    }
  } finally {
    submit.textContent = "Confirm rollback";
    submit.disabled = flagState.rollbackStale;
  }
}

function initialize() {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  let refundTimer;
  document.querySelector("#refund-query").addEventListener("input", () => {
    clearTimeout(refundTimer);
    refundTimer = setTimeout(loadRefunds, 180);
  });
  document.querySelector("#refund-status").addEventListener("change", loadRefunds);
  document.querySelector("#refund-filters").addEventListener("submit", event => {
    event.preventDefault();
    loadRefunds();
  });
  document.querySelector("#clear-refund-filters").addEventListener("click", () => {
    document.querySelector("#refund-query").value = "";
    document.querySelector("#refund-status").value = "";
    loadRefunds();
    document.querySelector("#refund-query").focus();
  });

  document.querySelector("#environment-select").addEventListener("change", event => {
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    flagState.environment = event.target.value;
    flagState.flags = [];
    flagState.audit = [];
    document.querySelector("#production-caution").hidden = flagState.environment !== "production";
    loadFlags();
  });
  document.querySelector("#flag-query").addEventListener("input", renderFlags);

  document.querySelector("#change-enabled").addEventListener("change", updateChangePreview);
  document.querySelector("#change-rollout").addEventListener("input", updateChangePreview);
  document.querySelector("#change-form").addEventListener("submit", submitChange);
  document.querySelector("#rollback-form").addEventListener("submit", submitRollback);
  document.querySelector("#change-confirmation").addEventListener("input", event => event.target.setCustomValidity(""));
  document.querySelector("#rollback-confirmation").addEventListener("input", event => event.target.setCustomValidity(""));

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
  });
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });

  const requestedView = location.hash === "#flags" ? "flags" : "refunds";
  setView(requestedView, false);
  loadRefunds();
}

document.addEventListener("DOMContentLoaded", initialize);
