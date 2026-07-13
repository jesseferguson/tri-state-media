export const apiTokenStorageKey = "tsm_api_token_v1";

function canUseStorage() {
  return typeof window !== "undefined" && window.localStorage;
}

export function getApiToken() {
  if (!canUseStorage()) return "";
  return window.localStorage.getItem(apiTokenStorageKey) || "";
}

export function setApiToken(token) {
  if (!canUseStorage()) return;
  if (token) {
    window.localStorage.setItem(apiTokenStorageKey, token);
  } else {
    window.localStorage.removeItem(apiTokenStorageKey);
  }
}

export function clearApiToken() {
  setApiToken("");
}
