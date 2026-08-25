function companyUserHeaders(user) {
  return {
    "X-Company-User-Id": String(user?.id || ""),
    "X-Company-Username": String(user?.username || ""),
  };
}

function messageUserId(user) {
  return String(user?.id || user?.username || "").trim();
}

function messageUserLabel(user) {
  return user?.name || user?.username || "User";
}

function apiErrorMessage(error) {
  const message = String(error?.message || "");
  try {
    const payload = JSON.parse(message);
    return payload.detail || Object.values(payload).flat().filter(Boolean).join(" ") || message;
  } catch {
    return message;
  }
}

export { apiErrorMessage, companyUserHeaders, messageUserId, messageUserLabel };
