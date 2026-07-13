import { getApiToken } from "./lib/authToken";

const API_BASE = import.meta.env.VITE_TOOLING_API_BASE ?? "/api";

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

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    } catch {
      try {
        message = await response.text();
      } catch {
        message = `${response.status} ${response.statusText}`;
      }
    }
    throw new Error(message || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
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
