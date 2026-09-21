import type {
  AuditListResponse,
  Environment,
  Flag,
  FlagEvaluationResponse,
  FlagListResponse,
  FlagRollbackPayload,
  FlagUpdatePayload,
  Refund,
  RefundListResponse,
  RefundStatus,
} from "./models";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options.body
      ? {
          "Content-Type": "application/json",
          "X-Demo-Request": "1",
          ...options.headers,
        }
      : options.headers,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    if ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError") throw error;
    throw new ApiError("The local server returned an unreadable response.", response.status);
  }
  if (!response.ok) {
    const envelope = payload as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.message ?? "The local request failed.",
      response.status,
      envelope.error?.code,
    );
  }
  return payload as T;
}

export const api = {
  listRefunds(query: string, status: RefundStatus | "", signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status) params.set("status", status);
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<RefundListResponse>(`/api/refunds${suffix}`, { signal });
  },

  getRefund(id: string, signal?: AbortSignal) {
    return request<Refund>(`/api/refunds/${encodeURIComponent(id)}`, { signal });
  },

  listFlags(environment: Environment, signal?: AbortSignal) {
    const params = new URLSearchParams({ environment });
    return request<FlagListResponse>(`/api/flags?${params.toString()}`, { signal });
  },

  listEvaluations(key: string, environment: Environment, signal?: AbortSignal) {
    const params = new URLSearchParams({ environment });
    return request<FlagEvaluationResponse>(
      `/api/flags/${encodeURIComponent(key)}/evaluations?${params.toString()}`,
      { signal },
    );
  },

  listAudit(environment: Environment, signal?: AbortSignal) {
    const params = new URLSearchParams({ environment });
    return request<AuditListResponse>(`/api/audit?${params.toString()}`, { signal });
  },

  updateFlag(key: string, payload: FlagUpdatePayload) {
    return request<Flag>(`/api/flags/${encodeURIComponent(key)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  rollbackFlag(key: string, payload: FlagRollbackPayload) {
    return request<Flag>(`/api/flags/${encodeURIComponent(key)}/rollback`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
