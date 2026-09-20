import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api } from "../lib/api";
import type {
  AuditEvent,
  DemoAccount,
  Environment,
  Flag,
  FlagEvaluation,
  FlagEvaluationResponse,
  Refund,
} from "../lib/models";

const refund: Refund = {
  id: "ref_0008",
  payment_id: "pay_1008",
  customer: "Lucas Bennett <lucas.bennett@example.test>",
  amount_cents: 6400,
  currency: "USD",
  reason: "subscription canceled",
  status: "failed",
  created_at: "2025-01-20T09:45:00Z",
  updated_at: "2025-01-21T17:05:00Z",
  owner: "Maya Chen",
  provider_reference: "prv_us_0008",
  timeline: [
    { timestamp: "2025-01-20T09:45:00Z", event: "refund_requested", detail: "Refund requested for subscription canceled." },
    { timestamp: "2025-01-21T17:05:00Z", event: "refund_failed", detail: "The provider timed out; the outcome is unconfirmed and must be reconciled before any retry." },
  ],
};

const summary = {
  total_count: 20,
  total_amount_cents: 122721,
  pending_count: 4,
  failed_count: 4,
  completed_count: 8,
  currency: "USD" as const,
};

function makeFlag(environment: Environment = "staging", overrides: Partial<Flag> = {}): Flag {
  return {
    key: "new_checkout_flow",
    name: "New checkout flow",
    description: "Enables the streamlined multi-step checkout experience.",
    owner: "Commerce Platform",
    risk: "high",
    environment,
    enabled: environment !== "production",
    rollout_percent: environment === "production" ? 0 : 50,
    version: 1,
    updated_at: "2025-01-01T00:00:00Z",
    updated_by: "System seed",
    ...overrides,
  };
}

function makeAudit(environment: Environment = "staging"): AuditEvent {
  const before = makeFlag(environment, { enabled: true, rollout_percent: 50, version: 1 });
  const after = makeFlag(environment, { enabled: false, rollout_percent: 25, version: 2, updated_by: "Demo operator" });
  return {
    id: "audit-1",
    key: "new_checkout_flow",
    environment,
    actor: "Demo operator",
    reason: "Deliberate synthetic change",
    timestamp: "2025-01-02T00:00:00Z",
    action: "updated",
    before,
    after,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function deferredJsonResponse(payload: Promise<unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => payload,
  } as Response;
}

function requestPath(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function installFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(requestPath(input), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function refundList(items: Refund[]) {
  return jsonResponse({ refunds: items, summary });
}

function flagHandler({
  environment = "staging",
  flags = [makeFlag(environment)],
  audit = [],
}: {
  environment?: Environment;
  flags?: Flag[];
  audit?: AuditEvent[];
} = {}) {
  return (path: string) => {
    if (path.startsWith("/api/refunds")) return refundList([refund]);
    if (path.startsWith("/api/flags?")) return jsonResponse({ flags, environment });
    if (path.startsWith("/api/audit?")) return jsonResponse({ events: audit, environment });
    throw new Error(`Unexpected request: ${path}`);
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "#refunds");
});

describe("api cancellation", () => {
  it("preserves AbortError from a deferred response body", async () => {
    const body = deferred<unknown>();
    installFetch(() => deferredJsonResponse(body.promise));
    const controller = new AbortController();
    const result = api.listFlags("staging", controller.signal).catch((error: unknown) => error);
    const abortError = new DOMException("The operation was aborted.", "AbortError");

    controller.abort();
    body.reject(abortError);

    expect(await result).toBe(abortError);
  });
});

describe("refund operations", () => {
  it("searches and filters refunds and opens historical detail", async () => {
    const fetchMock = installFetch((path) => {
      if (path === "/api/refunds/ref_0008") return jsonResponse(refund);
      if (path.includes("status=failed")) return refundList([refund]);
      if (path.includes("query=Lucas")) return refundList([refund]);
      return refundList([refund]);
    });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("ref_0008")).toBeInTheDocument();
    expect(screen.getByText("$1,227.21")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search refunds" }), "Lucas");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("query=Lucas"), expect.any(Object)));
    await user.clear(screen.getByRole("searchbox", { name: "Search refunds" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by refund status" }), "failed");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("status=failed"), expect.any(Object)));

    await user.click(screen.getByRole("button", { name: "View details for ref_0008" }));
    const dialog = await screen.findByRole("dialog", { name: "ref_0008" });
    expect(within(dialog).getByText("pay_1008")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/outcome is unconfirmed/)).toHaveLength(2);
    expect(within(dialog).getAllByText(/Historical ·/).length).toBeGreaterThan(1);
  });

  it("shows empty results and clears filters", async () => {
    installFetch((path) => path.includes("query=missing") ? refundList([]) : refundList([refund]));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ref_0008");
    await user.type(screen.getByRole("searchbox", { name: "Search refunds" }), "missing");
    expect(await screen.findByText(/No synthetic records match/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("ref_0008")).toBeInTheDocument();
  });

  it("shows a useful refund error and retries", async () => {
    let failed = false;
    installFetch(() => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error("server unavailable"));
      }
      return refundList([refund]);
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Could not load refunds: server unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("ref_0008")).toBeInTheDocument();
  });

  it("does not let a deferred old filter response replace newer results", async () => {
    const oldBody = deferred<unknown>();
    const oldRefund = { ...refund, id: "ref_old", customer: "Old filter result" };
    const newRefund = { ...refund, id: "ref_new", customer: "New filter result" };
    const fetchMock = installFetch((path) => {
      if (path.includes("query=old")) return deferredJsonResponse(oldBody.promise);
      if (path.includes("query=new")) return refundList([newRefund]);
      return refundList([refund]);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ref_0008");

    const search = screen.getByRole("searchbox", { name: "Search refunds" });
    await user.type(search, "old");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("query=old"), expect.any(Object)));
    await user.clear(search);
    await user.type(search, "new");
    expect(await screen.findByText("ref_new")).toBeInTheDocument();

    await act(async () => {
      oldBody.resolve({ refunds: [oldRefund], summary });
      await oldBody.promise;
    });

    expect(screen.getByText("ref_new")).toBeInTheDocument();
    expect(screen.queryByText("ref_old")).not.toBeInTheDocument();
  });

  it("does not let deferred old details replace the newly selected refund", async () => {
    const oldBody = deferred<unknown>();
    const oldRefund = { ...refund, id: "ref_old", payment_id: "pay_old", customer: "Old detail customer" };
    const newRefund = { ...refund, id: "ref_new", payment_id: "pay_new", customer: "New detail customer" };
    installFetch((path) => {
      if (path === "/api/refunds/ref_old") return deferredJsonResponse(oldBody.promise);
      if (path === "/api/refunds/ref_new") return jsonResponse(newRefund);
      return refundList([oldRefund, newRefund]);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ref_old");

    await user.click(screen.getByRole("button", { name: "View details for ref_old" }));
    await screen.findByRole("dialog", { name: "ref_old" });
    await user.click(screen.getByRole("button", { name: "Close refund details" }));
    await user.click(screen.getByRole("button", { name: "View details for ref_new" }));
    const dialog = await screen.findByRole("dialog", { name: "ref_new" });
    expect(within(dialog).getByText("pay_new")).toBeInTheDocument();

    await act(async () => {
      oldBody.resolve(oldRefund);
      await oldBody.promise;
    });

    expect(within(dialog).getByText("pay_new")).toBeInTheDocument();
    expect(within(dialog).queryByText("pay_old")).not.toBeInTheDocument();
  });
});

describe("feature flag operations", () => {
  it("isolates environment requests and displays the selected response", async () => {
    const fetchMock = installFetch((path) => {
      const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [makeFlag(environment)], environment });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [], environment });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    expect(await screen.findByText("New checkout flow")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    expect(await screen.findByText("Production simulation selected")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/flags?environment=production", expect.any(Object)));
    expect(screen.getByText("Production environment")).toBeInTheDocument();
  });

  it("does not let a deferred old environment body replace the selected environment", async () => {
    const stagingBody = deferred<unknown>();
    const fetchMock = installFetch((path) => {
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
      if (path.startsWith("/api/flags?") && environment === "staging") return deferredJsonResponse(stagingBody.promise);
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [makeFlag(environment, { name: "Production current flag" })], environment });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [], environment });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/flags?environment=staging", expect.any(Object)));
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    expect(await screen.findByText("Production current flag")).toBeInTheDocument();

    await act(async () => {
      stagingBody.resolve({ flags: [makeFlag("staging", { name: "Obsolete staging flag" })], environment: "staging" });
      await stagingBody.promise;
    });

    expect(screen.getByText("Production current flag")).toBeInTheDocument();
    expect(screen.queryByText("Obsolete staging flag")).not.toBeInTheDocument();
  });

  it("does not show an error from a superseded environment request", async () => {
    const stagingResponse = deferred<Response>();
    const fetchMock = installFetch((path) => {
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
      if (path.startsWith("/api/flags?") && environment === "staging") return stagingResponse.promise;
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [makeFlag(environment, { name: "Production current flag" })], environment });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [], environment });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/flags?environment=staging", expect.any(Object)));
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    expect(await screen.findByText("Production current flag")).toBeInTheDocument();

    await act(async () => {
      stagingResponse.reject(new Error("obsolete staging failure"));
      await Promise.resolve();
    });

    expect(screen.getByText("Production current flag")).toBeInTheDocument();
    expect(screen.queryByText(/Could not load flags/)).not.toBeInTheDocument();
  });

  it("reviews a real change and sends the exact typed payload", async () => {
    const posts: Array<{ path: string; payload: unknown }> = [];
    let changed = false;
    const fetchMock = installFetch((path, init) => {
      if (init?.method === "POST") {
        posts.push({ path, payload: JSON.parse(String(init.body)) });
        changed = true;
        return jsonResponse(makeFlag("staging", { enabled: false, rollout_percent: 25, version: 2 }));
      }
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [changed ? makeFlag("staging", { enabled: false, rollout_percent: 25, version: 2 }) : makeFlag()], environment: "staging" });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: changed ? [makeAudit()] : [], environment: "staging" });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await user.click(await screen.findByRole("button", { name: "Review change" }));
    const dialog = screen.getByRole("dialog", { name: "Review New checkout flow" });
    expect(within(dialog).getByRole("button", { name: "Confirm change" })).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Enabled/ }));
    await user.clear(within(dialog).getByRole("spinbutton", { name: /Rollout percentage/ }));
    await user.type(within(dialog).getByRole("spinbutton", { name: /Rollout percentage/ }), "25");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Exercise a deliberate demo change");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/api/flags/new_checkout_flow",
      payload: {
        environment: "staging",
        enabled: false,
        rollout_percent: 25,
        reason: "Exercise a deliberate demo change",
        expected_version: 1,
        confirmation: "",
      },
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => requestPath(path).startsWith("/api/audit?")).length).toBe(2));
  });

  it("requires exact typed-key confirmation for production", async () => {
    const posts: RequestInit[] = [];
    installFetch((path, init) => {
      if (init?.method === "POST") {
        posts.push(init);
        return jsonResponse(makeFlag("production", { enabled: true, rollout_percent: 10, version: 2 }));
      }
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [makeFlag(environment)], environment });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [], environment });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await screen.findByText("New checkout flow");
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    await screen.findByText("Production simulation selected");
    await user.click(await screen.findByRole("button", { name: "Review change" }));
    const dialog = screen.getByRole("dialog", { name: "Review New checkout flow" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Enabled/ }));
    await user.clear(within(dialog).getByRole("spinbutton", { name: /Rollout percentage/ }));
    await user.type(within(dialog).getByRole("spinbutton", { name: /Rollout percentage/ }), "10");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Enable a synthetic production cohort");
    const confirmation = within(dialog).getByRole("textbox", { name: /Type new_checkout_flow/ });
    await user.type(confirmation, "wrong_key");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    expect(await within(dialog).findByText(/Type new_checkout_flow exactly/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await user.clear(confirmation);
    await user.type(confirmation, "new_checkout_flow");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse(String(posts[0].body))).toMatchObject({ environment: "production", confirmation: "new_checkout_flow" });
  });

  it("rolls back from audit history and refreshes flags and audit", async () => {
    const event = makeAudit();
    let rolledBack = false;
    const fetchMock = installFetch((path, init) => {
      if (init?.method === "POST") {
        rolledBack = true;
        expect(path).toBe("/api/flags/new_checkout_flow/rollback");
        expect(JSON.parse(String(init.body))).toEqual({
          environment: "staging",
          reason: "Restore the earlier staged configuration",
          expected_version: 2,
          confirmation: "",
        });
        return jsonResponse(makeFlag("staging", { version: 3 }));
      }
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [makeFlag("staging", { enabled: false, rollout_percent: 25, version: 2 })], environment: "staging" });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [event], environment: "staging" });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await user.click(await screen.findByRole("button", { name: "Rollback" }));
    const dialog = screen.getByRole("dialog", { name: "Rollback New checkout flow" });
    expect(within(dialog).getByText("Enabled · 50% rollout")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Restore the earlier staged configuration");
    await user.click(within(dialog).getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() => expect(rolledBack).toBe(true));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => requestPath(path).startsWith("/api/audit?")).length).toBe(2));
  });

  it("keeps a rollback conflict review frozen until refreshed data is reopened", async () => {
    const initialEvent = makeAudit();
    const initialFlag = makeFlag("staging", { enabled: false, rollout_percent: 25, version: 2 });
    const refreshedFlag = makeFlag("staging", { enabled: true, rollout_percent: 10, version: 3 });
    const refreshedEvent: AuditEvent = {
      ...initialEvent,
      id: "audit-2",
      before: makeFlag("staging", { enabled: false, rollout_percent: 5, version: 2 }),
      after: refreshedFlag,
    };
    const refreshedFlags = deferred<unknown>();
    const refreshedAudit = deferred<unknown>();
    const posts: unknown[] = [];
    let flagLoads = 0;
    let auditLoads = 0;
    installFetch((path, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        if (posts.length === 1) {
          return jsonResponse({ error: { code: "conflict", message: "expected version 2 but found 3" } }, 409);
        }
        return jsonResponse(makeFlag("staging", { version: 4 }));
      }
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags?")) {
        flagLoads += 1;
        return flagLoads === 1
          ? jsonResponse({ flags: [initialFlag], environment: "staging" })
          : deferredJsonResponse(refreshedFlags.promise);
      }
      if (path.startsWith("/api/audit?")) {
        auditLoads += 1;
        return auditLoads === 1
          ? jsonResponse({ events: [initialEvent], environment: "staging" })
          : deferredJsonResponse(refreshedAudit.promise);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await user.click(await screen.findByRole("button", { name: "Rollback" }));
    const dialog = screen.getByRole("dialog", { name: "Rollback New checkout flow" });
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Restore after a stale rollback review");
    await user.click(within(dialog).getByRole("button", { name: "Confirm rollback" }));

    expect(await within(dialog).findByText(/changed after the rollback review opened/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm rollback" })).toBeDisabled();
    expect(posts[0]).toMatchObject({ environment: "staging", expected_version: 2 });
    expect(within(dialog).getByText("Disabled · 25% rollout")).toBeInTheDocument();
    expect(within(dialog).getByText("Enabled · 50% rollout")).toBeInTheDocument();

    await act(async () => {
      refreshedFlags.resolve({ flags: [refreshedFlag], environment: "staging" });
      refreshedAudit.resolve({ events: [refreshedEvent], environment: "staging" });
      await Promise.all([refreshedFlags.promise, refreshedAudit.promise]);
    });

    expect(screen.getByRole("dialog", { name: "Rollback New checkout flow" })).toBeInTheDocument();
    expect(within(dialog).getByText("Disabled · 25% rollout")).toBeInTheDocument();
    expect(within(dialog).getByText("Enabled · 50% rollout")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Rollback" }));
    const reopened = screen.getByRole("dialog", { name: "Rollback New checkout flow" });
    expect(within(reopened).getByText("Enabled · 10% rollout")).toBeInTheDocument();
    expect(within(reopened).getByText("Disabled · 5% rollout")).toBeInTheDocument();
    await user.type(within(reopened).getByRole("textbox", { name: /Reason/ }), "Restore the newly reviewed prior state");
    await user.click(within(reopened).getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ environment: "staging", expected_version: 3 });
  });

  it("keeps stale-version conflicts visible and requires a fresh review", async () => {
    let postCount = 0;
    installFetch((path, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ error: { code: "conflict", message: "expected version 1 but found 2" } }, 409);
      }
      return flagHandler()(path);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await user.click(await screen.findByRole("button", { name: "Review change" }));
    const dialog = screen.getByRole("dialog", { name: "Review New checkout flow" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Enabled/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Exercise a stale version conflict");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    expect(await within(dialog).findByText(/changed after the review opened/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm change" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    expect(postCount).toBe(1);
  });
});

const previewAccounts: DemoAccount[] = [
  { id: "acct_demo_aurora", label: "Aurora Test Account", segment: "Synthetic · Retail" },
  { id: "acct_demo_basalt", label: "Basalt Test Account", segment: "Synthetic · Retail" },
];

function makeEvaluation(
  accountId: string,
  bucket: number,
  flag: Flag,
): FlagEvaluation {
  const threshold = flag.rollout_percent * 100;
  const decision = flag.enabled && bucket < threshold;
  return {
    key: flag.key,
    environment: flag.environment,
    account_id: accountId,
    decision,
    reason: !flag.enabled
      ? "flag_disabled"
      : flag.rollout_percent === 0
        ? "rollout_zero"
        : decision
          ? "bucket_within_rollout"
          : "bucket_outside_rollout",
    bucket,
    bucket_count: 10000,
    threshold,
    enabled: flag.enabled,
    rollout_percent: flag.rollout_percent,
    version: flag.version,
  };
}

function evaluationResponse(flag: Flag, buckets: [number, number] = [1200, 8800]): FlagEvaluationResponse {
  return {
    key: flag.key,
    environment: flag.environment,
    flag,
    accounts: previewAccounts,
    evaluations: previewAccounts.map((account, index) => makeEvaluation(account.id, buckets[index], flag)),
  };
}

describe("customer preview", () => {
  it("renders the backend decision, explanation, and matching checkout per account", async () => {
    const flag = makeFlag("staging", { enabled: true, rollout_percent: 25, version: 4 });
    installFetch((path) => {
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags/new_checkout_flow/evaluations")) return jsonResponse(evaluationResponse(flag));
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Customer preview" }));

    expect(await screen.findByRole("region", { name: "New checkout experience" })).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 demo accounts receive the new checkout/)).toBeInTheDocument();
    expect(screen.getByText(/bucket 1,200 falls inside the 25% rollout/)).toBeInTheDocument();
    expect(screen.getByText("1,200 of 10,000")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Customer preview" })).getByText("v4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Basalt Test Account/ }));
    expect(await screen.findByRole("region", { name: "Old checkout experience" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "New checkout experience" })).not.toBeInTheDocument();
    expect(screen.getByText(/bucket 8,800 falls outside the 25% rollout/)).toBeInTheDocument();
  });

  it("re-evaluates when the environment changes and when decisions are refreshed", async () => {
    const staging = makeFlag("staging", { enabled: true, rollout_percent: 25, version: 2 });
    const production = makeFlag("production", { enabled: false, rollout_percent: 0, version: 1 });
    let stagingVersion = staging;
    const fetchMock = installFetch((path) => {
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags/new_checkout_flow/evaluations")) {
        const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
        return jsonResponse(evaluationResponse(environment === "production" ? production : stagingVersion));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Customer preview" }));
    await screen.findByRole("region", { name: "New checkout experience" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/flags/new_checkout_flow/evaluations?environment=production", expect.any(Object)),
    );
    expect(await screen.findByRole("region", { name: "Old checkout experience" })).toBeInTheDocument();
    expect(screen.getByText(/new_checkout_flow is disabled in production/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "staging");
    await screen.findByRole("region", { name: "New checkout experience" });
    stagingVersion = makeFlag("staging", { enabled: true, rollout_percent: 100, version: 3 });
    await user.click(screen.getByRole("button", { name: "Refresh decisions" }));
    expect(await screen.findByText(/2 of 2 demo accounts receive the new checkout/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Customer preview" })).getByText("v3")).toBeInTheDocument();
  });

  it("shows the current configuration after an admin change when the preview is reopened", async () => {
    let flag = makeFlag("staging", { enabled: false, rollout_percent: 25, version: 1 });
    installFetch((path, init) => {
      if (init?.method === "POST") {
        flag = makeFlag("staging", { enabled: true, rollout_percent: 25, version: 2 });
        return jsonResponse(flag);
      }
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags/new_checkout_flow/evaluations")) return jsonResponse(evaluationResponse(flag));
      if (path.startsWith("/api/flags?")) return jsonResponse({ flags: [flag], environment: "staging" });
      if (path.startsWith("/api/audit?")) return jsonResponse({ events: [], environment: "staging" });
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Customer preview" }));
    expect(await screen.findByRole("region", { name: "Old checkout experience" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Feature flags" }));
    await user.click(await screen.findByRole("button", { name: "Review change" }));
    const dialog = screen.getByRole("dialog", { name: "Review New checkout flow" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Enabled/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Enable the synthetic cohort");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));

    await user.click(screen.getByRole("button", { name: "Customer preview" }));
    expect(await screen.findByRole("region", { name: "New checkout experience" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Customer preview" })).getByText("v2")).toBeInTheDocument();
  });

  it("does not let a deferred evaluation replace a newer selection", async () => {
    const stagingBody = deferred<unknown>();
    const staging = makeFlag("staging", { enabled: true, rollout_percent: 25, version: 2 });
    const production = makeFlag("production", { enabled: true, rollout_percent: 100, version: 5 });
    const fetchMock = installFetch((path) => {
      if (path.startsWith("/api/refunds")) return refundList([refund]);
      if (path.startsWith("/api/flags/new_checkout_flow/evaluations")) {
        const environment = new URL(path, "http://local.test").searchParams.get("environment") as Environment;
        if (environment === "staging") return deferredJsonResponse(stagingBody.promise);
        return jsonResponse(evaluationResponse(production));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Customer preview" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/flags/new_checkout_flow/evaluations?environment=staging", expect.any(Object)),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), "production");
    expect(await screen.findByText("v5")).toBeInTheDocument();

    await act(async () => {
      stagingBody.resolve(evaluationResponse(staging));
      await stagingBody.promise;
    });

    const preview = screen.getByRole("region", { name: "Customer preview" });
    expect(within(preview).getByText("v5")).toBeInTheDocument();
    expect(within(preview).getByText(/2 of 2 demo accounts receive the new checkout/)).toBeInTheDocument();
    expect(within(preview).queryByText("v2")).not.toBeInTheDocument();
  });
});
