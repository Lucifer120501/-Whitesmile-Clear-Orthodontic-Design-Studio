import { useCallback, useEffect, useState } from "react";

export interface SystemsStatus {
  main: { up: boolean; url: string };
  agliner: { up: boolean; url: string; managed?: boolean; port?: number };
  ortho: { up: boolean; url: string; managed?: boolean; port?: number };
  storageFolder: string;
  storageExists: boolean;
  aiAvailable: boolean;
}

export const DEFAULT_STATUS: SystemsStatus = {
  main: { up: true, url: "http://localhost:3000" },
  agliner: { up: false, url: "http://localhost:3000/agliner/" },
  ortho: { up: false, url: "http://localhost:3000/ortho/" },
  storageFolder: "",
  storageExists: false,
  aiAvailable: false,
};

/**
 * Shared systems status — polls the main server's /api/systems/status
 * endpoint so both the sidebar status card and the embedded panels stay in sync.
 */
export function useSystemsStatus() {
  const [status, setStatus] = useState<SystemsStatus>(DEFAULT_STATUS);
  const [checking, setChecking] = useState(true);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/systems/status");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // keep last known status
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return { status, checking, checkStatus };
}
