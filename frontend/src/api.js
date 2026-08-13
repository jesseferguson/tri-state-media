import { getApiToken } from "./lib/authToken";

const API_BASE = import.meta.env.VITE_TOOLING_API_BASE ?? "/api";
export const AUTH_SESSION_ENDED_EVENT = "tsm-auth-session-ended";
export const AUTH_ACCOUNT_INACTIVE_MESSAGE = "Your account is currently marked inactive. Please contact an administrator if you need access.";
export const AUTH_SESSION_ENDED_MESSAGE = "Your secure session ended. Please sign in again to continue.";

let sessionEndedDispatched = false;

function cleanBase(url) {
  return url.replace(/\/$/, "");
}

function endpointUrl(endpoint, id = null) {
  const base = cleanBase(API_BASE);
  const cleanEndpoint = String(endpoint).replace(/^\//, "").replace(/\/$/, "");
  return `${base}/${cleanEndpoint}/${id ? `${id}/` : ""}`;
}

function absoluteUrl(url) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(url, origin);
}

function isProtectedFileApiPath(pathname) {
  return [
    /^\/api\/job-tickets\/[^/]+\/images\/[^/]+\/preview\/?$/,
    /^\/api\/recipes\/[^/]+\/layout-file-preview\/?$/,
    /^\/api\/(?:flex-dies|rotary-dies)\/[^/]+\/dieline-image-preview\/?$/,
  ].some((pattern) => pattern.test(pathname));
}

export function isApiUrl(url) {
  if (!url) return false;
  try {
    const target = absoluteUrl(url);
    const apiBase = absoluteUrl(cleanBase(API_BASE));
    const basePath = apiBase.pathname.replace(/\/$/, "");
    const matchesConfiguredApi = target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
    return (target.origin === apiBase.origin && matchesConfiguredApi) || isProtectedFileApiPath(target.pathname);
  } catch {
    return false;
  }
}

async function responseErrorInfo(response) {
  let message = `${response.status} ${response.statusText}`;
  let detail = "";
  try {
    const payload = await response.clone().json();
    detail = typeof payload === "string" ? payload : String(payload.detail || payload.error || "");
    message = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  } catch {
    try {
      detail = await response.clone().text();
      message = detail;
    } catch {
      message = `${response.status} ${response.statusText}`;
    }
  }
  return { message, detail };
}

function sessionEndedMessage(errorInfo) {
  const text = `${errorInfo?.detail || ""} ${errorInfo?.message || ""}`.toLowerCase();
  if (text.includes("inactive") || text.includes("no longer active")) {
    return AUTH_ACCOUNT_INACTIVE_MESSAGE;
  }
  return AUTH_SESSION_ENDED_MESSAGE;
}

function isSessionEndingAuthError(response, errorInfo) {
  if (response.status !== 401) return false;
  const text = `${errorInfo?.detail || ""} ${errorInfo?.message || ""}`.toLowerCase();
  if (!text.trim()) return true;
  return [
    "authentication credentials were not provided",
    "not authenticated",
    "invalid sign-in token",
    "sign-in expired",
    "sign-in changed",
    "no longer active",
    "inactive",
  ].some((phrase) => text.includes(phrase));
}

function notifySessionEnded(response, errorInfo) {
  if (sessionEndedDispatched || typeof window === "undefined") return;
  sessionEndedDispatched = true;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_ENDED_EVENT, {
    detail: {
      status: response.status,
      message: sessionEndedMessage(errorInfo),
    },
  }));
}

async function request(url, options = {}) {
  const bodyIsFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const { headers: optionHeaders = {}, skipAuth = false, ...requestOptions } = options;
  const token = skipAuth ? "" : getApiToken();
  let response;
  try {
    response = await fetch(url, {
      ...requestOptions,
      headers: {
        ...(bodyIsFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...optionHeaders,
      },
    });
  } catch (error) {
    const target = typeof url === "string" ? url : url?.toString?.();
    throw new Error(`Could not reach the API at ${target || "the requested endpoint"}. Make sure the backend server is running, then refresh and try again. (${error.message || "Network request failed"})`);
  }

  if (response.ok) {
    sessionEndedDispatched = false;
  }

  if (!response.ok) {
    const errorInfo = await responseErrorInfo(response);
    if (!skipAuth && isSessionEndingAuthError(response, errorInfo)) {
      notifySessionEnded(response, errorInfo);
    }
    throw new Error(errorInfo.message || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function fetchFile(url, options = {}) {
  const { headers: optionHeaders = {}, skipAuth = false, ...requestOptions } = options;
  const token = skipAuth ? "" : getApiToken();
  let response;
  try {
    response = await fetch(url, {
      ...requestOptions,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...optionHeaders,
      },
    });
  } catch (error) {
    const target = typeof url === "string" ? url : url?.toString?.();
    throw new Error(`Could not reach the file at ${target || "the requested endpoint"}. Refresh and try again. (${error.message || "Network request failed"})`);
  }

  if (response.ok) {
    sessionEndedDispatched = false;
  }

  if (!response.ok) {
    const errorInfo = await responseErrorInfo(response);
    if (!skipAuth && isSessionEndingAuthError(response, errorInfo)) {
      notifySessionEnded(response, errorInfo);
    }
    throw new Error(errorInfo.message || `${response.status} ${response.statusText}`.trim() || "File request failed");
  }

  return response;
}

export function apiEndpoint(endpoint, id = null) {
  return endpointUrl(endpoint, id);
}

export async function requestApi(endpoint, options = {}) {
  return request(endpointUrl(endpoint), options);
}

export async function fetchApiRoot() {
  return request(`${cleanBase(API_BASE)}/`);
}

export async function fetchCollection(endpoint, { search = "", ordering = "", pageSize = 250, filters = {}, fetchAll = false } = {}) {
  const url = absoluteUrl(endpointUrl(endpoint));
  if (search) url.searchParams.set("search", search);
  if (ordering) url.searchParams.set("ordering", ordering);
  if (pageSize) url.searchParams.set("page_size", pageSize);
  Object.entries(filters ?? {}).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });

  const payload = await request(url.toString());
  if (Array.isArray(payload)) {
    return {
      count: payload.length,
      results: payload,
      raw: payload,
    };
  }

  const results = [...(payload.results ?? [])];
  const count = payload.count ?? results.length;
  let page = Number(url.searchParams.get("page") ?? 1);

  while (fetchAll && results.length < count) {
    page += 1;
    url.searchParams.set("page", page);
    const nextPayload = await request(url.toString());
    const nextResults = nextPayload.results ?? [];
    if (!nextResults.length) break;
    results.push(...nextResults);
  }

  return {
    count,
    results,
    raw: payload,
  };
}

export async function createRecord(endpoint, payload) {
  return request(endpointUrl(endpoint), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateRecord(endpoint, id, payload) {
  return request(endpointUrl(endpoint, id), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function postRecordAction(endpoint, id, action, payload, options = {}) {
  const cleanAction = String(action).replace(/^\//, "").replace(/\/$/, "");
  return request(`${endpointUrl(endpoint, id)}${cleanAction}/`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: options.headers,
  });
}

export async function uploadRecordAction(endpoint, id, action, formData) {
  const cleanAction = String(action).replace(/^\//, "").replace(/\/$/, "");
  return request(`${endpointUrl(endpoint, id)}${cleanAction}/`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteRecordAction(endpoint, id, action) {
  const cleanAction = String(action).replace(/^\//, "").replace(/\/$/, "");
  return request(`${endpointUrl(endpoint, id)}${cleanAction}/`, { method: "DELETE" });
}

export async function deleteRecord(endpoint, id) {
  return request(endpointUrl(endpoint, id), { method: "DELETE" });
}
