/**
 * Detects an available backend server and returns its base URL.
 * Tries a list of common localhost ports with exponential backoff.
 * Falls back to the same origin if no server is reachable.
 */
export async function detectServer(retries: number = 3, delay: number = 500): Promise<string> {
  const fallbackPorts = [3000, 8080, 8000, 5000];
  const origin = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}` : '';

  for (const port of fallbackPorts) {
    const base = `${origin}:${port}`;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`${base}/api/system/config`, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) return base;
      } catch (e) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
      }
    }
  }
  // If none succeeded, return empty (same origin)
  return '';
}

export function getApiBase(): string {
  try {
    // Vite env var: VITE_API_BASE
    const viteEnv = (import.meta as any).env && (import.meta as any).env.VITE_API_BASE;
    if (viteEnv && typeof viteEnv === 'string' && viteEnv.trim()) return viteEnv.trim();
  } catch (e) {
    // ignore
  }
  try {
    // Runtime override if needed
    if (typeof window !== 'undefined' && (window as any).__API_BASE__) {
      return (window as any).__API_BASE__;
    }
  } catch (e) {
    // ignore
  }
  // Default: same origin
  return '';
}

/**
 * Returns a detected server base URL, trying common localhost ports.
 * Falls back to the value from getApiBase() (which may be empty for same origin).
 */
export async function getDetectedApiBase(): Promise<string> {
  const detected = await detectServer();
  if (detected) return detected;
  return getApiBase();
}
