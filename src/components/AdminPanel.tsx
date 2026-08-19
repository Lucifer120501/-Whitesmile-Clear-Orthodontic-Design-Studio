import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Users,
  RefreshCw,
  Download,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Globe,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Boxes,
  GitBranch,
  UserPlus,
  KeyRound,
  BarChart3,
} from "lucide-react";
import { FeaturePack } from "../lib/auth";

// ── Types ────────────────────────────────────────────────────────────────
interface CompanyRow {
  id: string;
  name: string;
  enabledPacks: string[];
  syncEnabled: boolean;
  createdAt: string;
  userCount: number;
}

interface UserRow {
  id: string;
  username: string;
  role: "admin" | "user";
  companyId: string | null;
  companyName: string | null;
  active: boolean;
  createdAt: string;
}

interface UpdateStatus {
  currentCommit: string;
  currentVersion: string;
  remoteConfigured: boolean;
  updatesAvailable: boolean;
  commitsBehind: number;
  workingTreeDirty: boolean;
  lastUpdate: { version: string; commit: string; timestamp: string; status: string; note?: string } | null;
  updateLog: Array<{ version: string; commit: string; timestamp: string; status: string; note?: string }>;
}

interface AdminPanelProps {
  packs: FeaturePack[];
  connection: { ipv4: string[]; urls: string[] };
  onRefreshMe: () => Promise<void>;
}

interface AiUsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  byCompany: Record<string, { companyName: string; requests: number; tokens: number; cost: number }>;
}

type AdminTab = "companies" | "users" | "usage" | "updates" | "connection";

export default function AdminPanel({ packs, connection, onRefreshMe }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("companies");
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [usageSummary, setUsageSummary] = useState<AiUsageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Company form state ──
  const [editingCompany, setEditingCompany] = useState<CompanyRow | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyPacks, setCompanyPacks] = useState<string[]>([]);
  const [companySync, setCompanySync] = useState(false);

  // ── User form state ──
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [userName, setUserName] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<"user" | "admin">("user");
  const [userCompanyId, setUserCompanyId] = useState<string>("");

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };
  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 6000);
  };

  const loadCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/companies");
      const data = await res.json();
      if (res.ok) setCompanies(data.companies || []);
      else showError(data.error || "Failed to load companies.");
    } catch {
      showError("Failed to load companies.");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (res.ok) setUsers(data.users || []);
      else showError(data.error || "Failed to load users.");
    } catch {
      showError("Failed to load users.");
    }
  }, []);

  const loadUpdateStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/update/status");
      const data = await res.json();
      if (res.ok) setUpdateStatus(data);
      else showError(data.error || "Failed to load update status.");
    } catch {
      showError("Failed to load update status.");
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/usage?limit=100");
      const data = await res.json();
      if (res.ok) setUsageSummary(data.summary || null);
      else showError(data.error || "Failed to load AI usage.");
    } catch {
      showError("Failed to load AI usage.");
    }
  }, []);

  useEffect(() => {
    loadCompanies();
    loadUsers();
    loadUpdateStatus();
    loadUsage();
  }, [loadCompanies, loadUsers, loadUpdateStatus, loadUsage]);

  // ── Company actions ──
  const startNewCompany = () => {
    setEditingCompany(null);
    setCompanyName("");
    setCompanyPacks(packs.filter((p) => p.id === "analysis").map((p) => p.id));
    setCompanySync(false);
  };

  const startEditCompany = (c: CompanyRow) => {
    setEditingCompany(c);
    setCompanyName(c.name);
    setCompanyPacks([...c.enabledPacks]);
    setCompanySync(c.syncEnabled);
  };

  const saveCompany = async () => {
    if (!companyName.trim()) {
      showError("Company name is required.");
      return;
    }
    setBusy(true);
    try {
      const url = editingCompany ? `/api/admin/companies/${editingCompany.id}` : "/api/admin/companies";
      const method = editingCompany ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName.trim(), enabledPacks: companyPacks, syncEnabled: companySync }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to save company.");
        return;
      }
      showNotice(editingCompany ? "Company updated." : "Company created.");
      setEditingCompany(null);
      setCompanyName("");
      setCompanyPacks(packs.filter((p) => p.id === "analysis").map((p) => p.id));
      setCompanySync(false);
      await loadCompanies();
      await onRefreshMe();
    } catch {
      showError("Failed to save company.");
    } finally {
      setBusy(false);
    }
  };

  const deleteCompany = async (c: CompanyRow) => {
    if (!window.confirm(`Delete company "${c.name}"? Users must be removed first.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${c.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to delete company.");
        return;
      }
      showNotice("Company deleted.");
      await loadCompanies();
    } catch {
      showError("Failed to delete company.");
    } finally {
      setBusy(false);
    }
  };

  const togglePack = (packId: string) => {
    setCompanyPacks((prev) =>
      prev.includes(packId) ? prev.filter((p) => p !== packId) : [...prev, packId]
    );
  };

  // ── User actions ──
  const startNewUser = () => {
    setEditingUser(null);
    setUserName("");
    setUserPassword("");
    setUserRole("user");
    setUserCompanyId(companies.length > 0 ? companies[0].id : "");
  };

  const startEditUser = (u: UserRow) => {
    setEditingUser(u);
    setUserName(u.username);
    setUserPassword("");
    setUserRole(u.role);
    setUserCompanyId(u.companyId || "");
  };

  const saveUser = async () => {
    if (!userName.trim()) {
      showError("Username is required.");
      return;
    }
    if (!editingUser && userPassword.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }
    if (editingUser && userPassword && userPassword.length < 6) {
      showError("New password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : "/api/admin/users";
      const method = editingUser ? "PUT" : "POST";
      const body: Record<string, unknown> = {
        username: userName.trim(),
        role: userRole,
        companyId: userRole === "user" ? userCompanyId || null : null,
      };
      if (userPassword) body.password = userPassword;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to save user.");
        return;
      }
      showNotice(editingUser ? "User updated." : "User created.");
      setEditingUser(null);
      setUserName("");
      setUserPassword("");
      setUserRole("user");
      setUserCompanyId(companies.length > 0 ? companies[0].id : "");
      await loadUsers();
    } catch {
      showError("Failed to save user.");
    } finally {
      setBusy(false);
    }
  };

  const toggleUserActive = async (u: UserRow) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to update user.");
        return;
      }
      showNotice(u.active ? `User "${u.username}" deactivated.` : `User "${u.username}" activated.`);
      await loadUsers();
    } catch {
      showError("Failed to update user.");
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async (u: UserRow) => {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to delete user.");
        return;
      }
      showNotice("User deleted.");
      await loadUsers();
    } catch {
      showError("Failed to delete user.");
    } finally {
      setBusy(false);
    }
  };

  // ── Update actions ──
  const applyUpdate = async () => {
    if (!window.confirm("Apply the latest update? The server will restart automatically. Users will be briefly disconnected.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/update/apply", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Update failed.");
        return;
      }
      showNotice(data.message || "Update applied.");
      setTimeout(() => loadUpdateStatus(), 4000);
    } catch {
      showError("Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const rollbackUpdate = async () => {
    if (!window.confirm("Roll back to the previous version? The server will restart automatically.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/update/rollback", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Rollback failed.");
        return;
      }
      showNotice(data.message || "Rollback applied.");
      setTimeout(() => loadUpdateStatus(), 4000);
    } catch {
      showError("Rollback failed.");
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: "companies", label: "Companies & Packs", icon: <Building2 className="w-3.5 h-3.5" /> },
    { id: "users", label: "Users", icon: <Users className="w-3.5 h-3.5" /> },
    { id: "usage", label: "AI Meter", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "updates", label: "Updates", icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: "connection", label: "Connection", icon: <Globe className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#46c0bd]" />
          <div>
            <h2 className="text-sm font-bold text-slate-800">Admin Control Panel</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Manage companies, feature packs, user accounts, updates &amp; server connection
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-slate-100 bg-slate-50/50 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                tab === t.id ? "bg-[#46c0bd] text-white shadow-xs" : "text-slate-600 hover:bg-slate-200/60"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Error / notice */}
        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        <div className="p-5">
          {/* ═══════════ COMPANIES ═══════════ */}
          {tab === "companies" && (
            <div className="space-y-4">
              {/* Company form */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-[#46c0bd]" />
                    {editingCompany ? `Edit Company: ${editingCompany.name}` : "Create Company"}
                  </h3>
                  {(editingCompany || companyName) && (
                    <button
                      onClick={() => { setEditingCompany(null); setCompanyName(""); }}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Company Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Ali's Dental Clinic"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                  />
                </div>

                {/* Feature pack checkboxes */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                    Feature Packs <span className="normal-case font-medium">(what this company's users can see)</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {packs.map((p) => (
                      <label
                        key={p.id}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          companyPacks.includes(p.id)
                            ? "border-[#46c0bd] bg-[#46c0bd]/5"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={companyPacks.includes(p.id)}
                          onChange={() => togglePack(p.id)}
                          className="mt-0.5 accent-[#46c0bd]"
                        />
                        <div>
                          <span className="text-xs font-bold text-slate-700 block">{p.name}</span>
                          <span className="text-[10px] text-slate-500">{p.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Sync toggle */}
                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">Company Data Sync</span>
                    <span className="text-[10px] text-slate-500">
                      When ON, all users in this company can see each other's cases. When OFF, each user keeps private records.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={companySync}
                    onChange={(e) => setCompanySync(e.target.checked)}
                    className="accent-[#46c0bd] w-4 h-4"
                  />
                </label>

                <div className="flex justify-end">
                  <button
                    onClick={saveCompany}
                    disabled={busy}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg transition-colors disabled:bg-slate-300 cursor-pointer flex items-center gap-1.5"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {editingCompany ? "Save Changes" : "Create Company"}
                  </button>
                </div>
              </div>

              {/* Company list */}
              <div className="space-y-2">
                {companies.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-6">No companies yet. Create one above.</p>
                ) : (
                  companies.map((c) => (
                    <div key={c.id} className="border border-slate-200 rounded-xl p-4 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className="w-4 h-4 text-[#46c0bd] shrink-0" />
                          <span className="text-sm font-bold text-slate-800 truncate">{c.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">({c.userCount} user{c.userCount !== 1 ? "s" : ""})</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => startEditCompany(c)}
                            className="p-1.5 text-slate-400 hover:text-[#46c0bd] rounded cursor-pointer"
                            title="Edit company"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteCompany(c)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                            title="Delete company"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {packs.map((p) => (
                          <span
                            key={p.id}
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                              c.enabledPacks.includes(p.id)
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-50 text-slate-400 border-slate-200"
                            }`}
                          >
                            {c.enabledPacks.includes(p.id) ? "✓ " : "○ "}{p.name}
                          </span>
                        ))}
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                            c.syncEnabled
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-slate-50 text-slate-400 border-slate-200"
                          }`}
                        >
                          {c.syncEnabled ? "Sync ON" : "Sync OFF"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ═══════════ USERS ═══════════ */}
          {tab === "users" && (
            <div className="space-y-4">
              {/* User form */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-[#46c0bd]" />
                    {editingUser ? `Edit User: ${editingUser.username}` : "Create User Account"}
                  </h3>
                  {(editingUser || userName) && (
                    <button
                      onClick={() => { setEditingUser(null); setUserName(""); setUserPassword(""); }}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Username</label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="e.g. dentist1"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Password {editingUser && <span className="normal-case font-medium">(blank = keep current)</span>}
                    </label>
                    <input
                      type="password"
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      placeholder={editingUser ? "Leave blank to keep" : "Min 6 characters"}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Role</label>
                    <select
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value as "user" | "admin")}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Company</label>
                    <select
                      value={userCompanyId}
                      onChange={(e) => setUserCompanyId(e.target.value)}
                      disabled={userRole === "admin"}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]/50 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">— No company —</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={saveUser}
                    disabled={busy}
                    className="px-4 py-2 text-xs font-bold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg transition-colors disabled:bg-slate-300 cursor-pointer flex items-center gap-1.5"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {editingUser ? "Save Changes" : "Create User"}
                  </button>
                </div>
              </div>

              {/* User list */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400">Username</th>
                      <th className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400">Role</th>
                      <th className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400">Company</th>
                      <th className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400">Status</th>
                      <th className="px-3 py-2 text-[10px] uppercase font-bold text-slate-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                          No users yet. Create one above.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2 text-xs font-semibold text-slate-700">{u.username}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              u.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-600"
                            }`}>
                              {u.role === "admin" ? "ADMIN" : "USER"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">{u.companyName || "—"}</td>
                          <td className="px-3 py-2">
                            {u.active ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">ACTIVE</span>
                            ) : (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600">DISABLED</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => startEditUser(u)}
                                className="p-1.5 text-slate-400 hover:text-[#46c0bd] rounded cursor-pointer"
                                title="Edit user"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => toggleUserActive(u)}
                                className="p-1.5 text-slate-400 hover:text-amber-600 rounded cursor-pointer"
                                title={u.active ? "Deactivate" : "Activate"}
                              >
                                {u.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => deleteUser(u)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══════════ UPDATES ═══════════ */}
          {tab === "updates" && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-[#46c0bd]" />
                    System Updates
                  </h3>
                  <button
                    onClick={loadUpdateStatus}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                    title="Refresh status"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {updateStatus ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Version</span>
                      <span className="text-sm font-bold text-slate-800 font-mono">{updateStatus.currentVersion}</span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Commit</span>
                      <span className="text-sm font-bold text-slate-800 font-mono">{updateStatus.currentCommit}</span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Updates Available</span>
                      {updateStatus.updatesAvailable ? (
                        <span className="text-sm font-bold text-amber-600">{updateStatus.commitsBehind} commit(s) behind</span>
                      ) : (
                        <span className="text-sm font-bold text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Up to date
                        </span>
                      )}
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <span className="text-[9px] uppercase font-bold text-slate-400 block">Remote</span>
                      <span className={`text-sm font-bold ${updateStatus.remoteConfigured ? "text-emerald-600" : "text-rose-500"}`}>
                        {updateStatus.remoteConfigured ? "Configured" : "Not configured"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Loading update status...</p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={applyUpdate}
                    disabled={busy || !updateStatus?.updatesAvailable}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Apply Update
                  </button>
                  <button
                    onClick={rollbackUpdate}
                    disabled={busy || !updateStatus?.lastUpdate}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Roll Back Last Update
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  Updates are pulled from the git repository, rebuilt, and the server restarts automatically. Users are briefly disconnected.
                </p>
              </div>

              {/* Update log */}
              {updateStatus && updateStatus.updateLog.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Update History</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {[...updateStatus.updateLog].reverse().map((u, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          u.status === "applied" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                        }`}>
                          {u.status === "applied" ? "APPLIED" : "ROLLED BACK"}
                        </span>
                        <span className="text-xs font-mono text-slate-700">{u.commit}</span>
                        <span className="text-xs text-slate-500">v{u.version}</span>
                        <span className="ml-auto text-[10px] text-slate-400">
                          {new Date(u.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════ CONNECTION ═══════════ */}
          {tab === "usage" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><h3 className="text-sm font-bold text-slate-800">AI Usage Meter</h3><p className="text-[10px] text-slate-500">Measured requests, tokens and estimated API cost across all companies.</p></div>
                <button onClick={loadUsage} className="px-3 py-2 text-xs font-bold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg cursor-pointer">Refresh</button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[["Requests", usageSummary?.totalRequests ?? 0], ["Input tokens", (usageSummary?.totalInputTokens ?? 0).toLocaleString()], ["Output tokens", (usageSummary?.totalOutputTokens ?? 0).toLocaleString()], ["Est. cost", `$${(usageSummary?.totalEstimatedCost ?? 0).toFixed(4)}`]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="block text-[10px] uppercase font-bold text-slate-400">{label}</span><span className="block mt-1 text-lg font-bold text-slate-800">{value}</span></div>)}
              </div>
              <div className="rounded-xl border border-slate-200 overflow-hidden"><div className="px-3 py-2 bg-slate-50 text-[10px] uppercase font-bold text-slate-400">Usage by company</div>{Object.values(usageSummary?.byCompany || {}).length === 0 ? <p className="p-4 text-xs text-slate-500">No successful AI requests have been metered yet.</p> : Object.values(usageSummary!.byCompany).map((company) => <div key={company.companyName} className="grid grid-cols-4 gap-2 px-3 py-2 border-t border-slate-100 text-xs"><span className="font-semibold text-slate-700">{company.companyName}</span><span>{company.requests} requests</span><span>{company.tokens.toLocaleString()} tokens</span><span>${company.cost.toFixed(4)}</span></div>)}</div>
            </div>
          )}

          {tab === "connection" && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-[#46c0bd]" />
                  Share This Address With Your Users
                </h3>
                <p className="text-[10px] text-slate-500">
                  Users open this URL in their browser on their own computer, then sign in with the account you created for them.
                  The server must stay running on this PC (24/7) and all devices must be on the same network.
                </p>
                <div className="space-y-2">
                  {connection.urls.map((url) => (
                    <div key={url} className="flex items-center gap-2">
                      <code className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700">
                        {url}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(url).then(() => showNotice("Address copied to clipboard."));
                        }}
                        className="px-3 py-2 text-xs font-bold text-white bg-[#46c0bd] hover:bg-[#3ba6a3] rounded-lg transition-colors cursor-pointer"
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
                {connection.ipv4.length === 0 && (
                  <p className="text-[10px] text-amber-600">
                    No LAN address detected — users may only be able to reach this server via localhost.
                  </p>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Boxes className="w-4 h-4 text-[#46c0bd]" />
                  Feature Packs
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {packs.map((p) => (
                    <div key={p.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-slate-700 block">{p.name}</span>
                      <span className="text-[10px] text-slate-500">{p.description}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">
                  Activate packs per company in the <strong>Companies &amp; Packs</strong> tab. Users only see features from packs their company has enabled.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
