import React, { useState } from "react";
import { AlignerLogo } from "./AlignerLogo";
import { Loader2, Lock, User, AlertCircle, Eye, EyeOff } from "lucide-react";

interface LoginPageProps {
  needsSetup: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onSetupAdmin: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ needsSetup, onLogin, onSetupAdmin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    if (needsSetup && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (needsSetup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) {
        await onSetupAdmin(username.trim(), password);
      } else {
        await onLogin(username.trim(), password);
      }
    } catch (err: any) {
      setError(err.message || "Login failed. Check your credentials and server address.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#46c0bd] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <AlignerLogo iconOnly={false} className="text-[#46c0bd]" />
          <h1 className="text-2xl font-bold text-slate-800 mt-4 tracking-tight">Whitesmile Clear</h1>
          <p className="text-sm text-slate-500 mt-1">Orthodontic Design Studio</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-[#46c0bd]/10 to-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-[#46c0bd]" />
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                Sign In
              </h2>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Enter your credentials to access the design studio.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Username */}
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. dentist1"
                  autoComplete="username"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-10 py-2 text-sm text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg text-sm font-bold text-[#46c0bd] bg-white hover:bg-slate-50 border border-[#46c0bd] transition-colors disabled:bg-slate-300 disabled:border-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 shadow-xs"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#46c0bd]" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-slate-400 mt-6">
          Whitesmile Clear © 2026 Whitesmile Clear Orthodontic Inc. · Multi-user server edition
        </p>
      </div>
    </div>
  );
}
