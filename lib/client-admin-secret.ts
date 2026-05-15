const ADMIN_SECRET_STORAGE_KEY = "husholdningspilot-admin-secret";

export function getClientAdminSecret() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY) ?? "";
}

export function setClientAdminSecret(secret: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, secret);
}

export function clearClientAdminSecret() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
}

export function adminSecretHeaders(init?: HeadersInit): HeadersInit {
  const headers = new Headers(init);
  const secret = getClientAdminSecret().trim();

  if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
  }

  return headers;
}
