import { useCallback, useEffect, useState } from "react";
import {
  AuthUser,
  AuthCompany,
  FeaturePack,
  MeResponse,
  apiFetchMe,
  apiLogin,
  apiLogout,
  apiNeedsSetup,
  apiSetupAdmin,
  getToken,
  setToken,
} from "../lib/auth";

interface UseAuthResult {
  user: AuthUser | null;
  company: AuthCompany | null;
  enabledPacks: string[];
  packs: FeaturePack[];
  connection: { ipv4: string[]; urls: string[] };
  loading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  setupAdmin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthCompany | null>(null);
  const [enabledPacks, setEnabledPacks] = useState<string[]>([]);
  const [packs, setPacks] = useState<FeaturePack[]>([]);
  const [connection, setConnection] = useState<{ ipv4: string[]; urls: string[] }>({ ipv4: [], urls: [] });
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setCompany(null);
      setEnabledPacks([]);
      setNeedsSetup(await apiNeedsSetup());
      setLoading(false);
      return;
    }
    try {
      const me: MeResponse = await apiFetchMe();
      setUser(me.user);
      setCompany(me.company);
      setEnabledPacks(me.enabledPacks || []);
      setPacks(me.packs || []);
      setConnection(me.connection || { ipv4: [], urls: [] });
      setNeedsSetup(false);
    } catch {
      // Session expired or server unreachable
      setToken(null);
      setUser(null);
      setCompany(null);
      setEnabledPacks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const { token } = await apiLogin(username, password);
    setToken(token);
    await refresh();
  }, [refresh]);

  const setupAdmin = useCallback(async (username: string, password: string) => {
    const { token } = await apiSetupAdmin(username, password);
    setToken(token);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setCompany(null);
    setEnabledPacks([]);
  }, []);

  return {
    user,
    company,
    enabledPacks,
    packs,
    connection,
    loading,
    needsSetup,
    login,
    setupAdmin,
    logout,
    refresh,
  };
}