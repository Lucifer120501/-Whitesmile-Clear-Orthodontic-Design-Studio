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
