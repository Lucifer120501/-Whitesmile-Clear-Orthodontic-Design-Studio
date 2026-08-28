import React, { useState, useEffect } from "react";
import { AlignerLogo } from "./AlignerLogo";
import {
  Loader2,
  Lock,
  User,
  AlertCircle,
  Eye,
  EyeOff,
  Server,
  Settings2,
  CheckCircle2,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  KeyRound,
} from "lucide-react";
import { getServerAddress, setServerAddress as setAuthServerAddress } from "../lib/auth";

interface LoginPageProps {
  readonly needsSetup: boolean;
  readonly onLogin: (username: string, password: string) => Promise<void>;
  readonly onSetupAdmin: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ needsSetup, onLogin, onSetupAdmin }: LoginPageProps) {
  // Saved username / remember me
  const savedUsername = localStorage.getItem("wsRememberedUsername") || "";
  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(!!savedUsername);

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);

  // Server address setting (collapsible)
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverAddress, setServerAddress] = useState(getServerAddress());

  // Connection & status state
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  // Check server health on mount & when serverAddress changes
  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch("/api/auth/status");
        if (!cancelled) setServerOnline(res.ok);
      } catch {
        if (!cancelled) setServerOnline(false);
      }
    }
    checkHealth();
    return () => {
      cancelled = true;
    };
  }, [serverAddress]);

  const handleServerAddressChange = (val: string) => {
    setServerAddress(val);
    setAuthServerAddress(val);
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError("Please enter both username and password.");
      return;
    }

    if (needsSetup) {
      if (password.length < 6) {
        setError("Admin password must be at least 6 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    // Save or clear remembered username
    if (rememberMe) {
      localStorage.setItem("wsRememberedUsername", cleanUser);
    } else {
      localStorage.removeItem("wsRememberedUsername");
    }

    setBusy(true);
    try {
      if (needsSetup) {
        await onSetupAdmin(cleanUser, password);
      } else {
        await onLogin(cleanUser, password);
      }
    } catch (err: any) {
      setError(err?.message || "Login failed. Check your credentials and server connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 flex flex-col items-center justify-center p-4 sm:p-6 select-none relative overflow-hidden font-sans">
      {/* Background Ambient Glows */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-[#46c0bd]/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 -right-20 w-[400px] h-[400px] bg-[#3ba8a5]/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="bg-slate-800/80 p-3 rounded-2xl border border-teal-500/20 shadow-xl backdrop-blur-md mb-3 flex items-center justify-center">
            <AlignerLogo iconOnly={false} className="text-[#46c0bd]" />
          </div>
          <p className="text-xs text-teal-200/70 font-medium mt-1">CAD & Design Studio</p>
        </div>

        {/* Main Card */}
        <div className="bg-white/95 dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Card Header Banner */}
          <div className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-[#46c0bd]/15 via-teal-500/5 to-transparent flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-[#46c0bd]/10 dark:bg-[#46c0bd]/20 text-[#46c0bd]">
                {needsSetup ? <KeyRound className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {needsSetup ? "Initial Admin Setup" : "Sign In"}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {needsSetup
                    ? "Create your super administrator account to initialize the system."
                    : "Enter your credentials to access the design workstation."}
                </p>
              </div>
            </div>

            {/* Server Online Status Pill */}
            {serverOnline !== null && (
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 border ${
                  serverOnline
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/50"
                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50"
                }`}
                title={serverOnline ? "Connected to backend server" : "Server unreachable or offline"}
              >
                {serverOnline ? (
                  <>
                    <Wifi className="w-3 h-3 text-emerald-500" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 text-amber-500" />
                    <span>Offline</span>
                  </>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Username Field */}
            <div>
              <label htmlFor="login-username" className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 block mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or dentist1"
                  autoComplete="username"
                  required
                  className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#46c0bd]/40 transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="login-password" className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 block mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#46c0bd]/40 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md cursor-pointer transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password (only during initial setup) */}
            {needsSetup && (
              <div>
                <label htmlFor="login-confirm-password" className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 block mb-1.5">
                  Confirm Admin Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#46c0bd]/40 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Options Row (Remember Me) */}
            {!needsSetup && (
              <div className="flex items-center justify-between text-xs pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-[#46c0bd] focus:ring-[#46c0bd]/40 cursor-pointer"
                  />
                  <span>Remember username</span>
                </label>
              </div>
            )}

            {/* Quick Demo Credentials Autofill */}
            {!needsSetup && (
              <div className="pt-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-1.5">
                  <span>QUICK LOGIN ACCOUNTS</span>
                  <span>(Click to fill)</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickFill("admin", "admin123")}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:border-teal-300 dark:hover:border-teal-700 text-[11px] text-slate-700 dark:text-slate-300 flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="font-medium">Admin</span>
                    <span className="text-[10px] text-slate-400 font-mono">admin123</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill("dentist1", "dent123")}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:border-teal-300 dark:hover:border-teal-700 text-[11px] text-slate-700 dark:text-slate-300 flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="font-medium">Clinic</span>
                    <span className="text-[10px] text-slate-400 font-mono">dent123</span>
                  </button>
                </div>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-3 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#3ba8a5] hover:bg-[#349693] active:bg-[#2e8481] border border-[#3ba8a5] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-teal-500/20"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{needsSetup ? "Setting up Admin..." : "Signing in..."}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{needsSetup ? "Initialize & Sign In" : "Sign In to Studio"}</span>
                </>
              )}
            </button>
          </form>

          {/* Advanced Server Address Accordion (Optional for Remote Clients) */}
          <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-6 py-2.5">
            <button
              type="button"
              onClick={() => setShowServerSettings(!showServerSettings)}
              className="w-full flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Server Connection Settings</span>
              </div>
              {showServerSettings ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showServerSettings && (
              <div className="mt-3 pb-2 space-y-2 text-xs animate-in fade-in duration-200">
                <label htmlFor="login-server-address" className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 block">
                  Server Address <span className="normal-case font-normal">(leave empty for default)</span>
                </label>
                <div className="relative">
                  <Server className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-server-address"
                    type="text"
                    value={serverAddress}
                    onChange={(e) => handleServerAddressChange(e.target.value)}
                    placeholder="https://192.168.1.50:3000"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]"
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
                  For remote laptops or tablets connecting across LAN. Leave blank when running directly on this computer.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-400/80 dark:text-slate-500 mt-6 font-medium">
          Whitesmile Clear © 2026 Whitesmile Clear Orthodontic Inc. · Multi-user server edition
        </p>
      </div>
    </div>
  );
}
