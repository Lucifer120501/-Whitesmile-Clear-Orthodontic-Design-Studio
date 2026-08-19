// ── Auth API helpers ─────────────────────────────────────────────────────
// Token + server address are stored in localStorage. The global fetch
// wrapper in main.tsx attaches the token and prepends the server address.

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
  companyId: string | null;
  active: boolean;
  createdAt: string;
}

export interface AuthCompany {
  id: string;
  name: string;
  enabledPacks: string[];
  syncEnabled: boolean;
}

export interface FeaturePack {
  id: string;
  name: string;
  description: string;
}

export interface MeResponse {
  user: AuthUser;
  company: AuthCompany | null;
  enabledPacks: string[];
  connection: { ipv4: string[]; urls: string[] };
  packs: FeaturePack[];
}

export function getToken(): string | null {
  return localStorage.getItem("wsAuthToken");
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem("wsAuthToken", token);
  else localStorage.removeItem("wsAuthToken");
}

export function getServerAddress(): string {
  return (localStorage.getItem("wsServerAddress") || "").replace(/\/+$/, "");
}

export function setServerAddress(address: string): void {
  const clean = address.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem("wsServerAddress", clean);
  else localStorage.removeItem("wsServerAddress");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function apiLogin(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Cannot reach the server. Check the server address and that the server is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Login failed.");
  return { token: data.token, user: data.user };
}

export async function apiSetupAdmin(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  let res: Response;
  try {
    res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Cannot reach the server. Check the server address and that the server is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Setup failed.");
  return { token: data.token, user: data.user };
}

export async function apiLogout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore network errors on logout */
  }
  setToken(null);
}

export async function apiFetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Session expired. Please log in again.");
  return data as MeResponse;
}

/** True when the server has no users yet (first-run setup needed). */
export async function apiNeedsSetup(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return false;
    const data = await res.json();
    return data.usersExist === false;
  } catch {
    return false;
  }
}