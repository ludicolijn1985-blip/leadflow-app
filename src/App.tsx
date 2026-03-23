import { FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { API_CONNECTION_ERROR, apiRequest, checkApiHealth } from "./lib/api";
import { Campaign, DashboardSummary, Lead, SessionResponse, SessionUser } from "./types";

type AppOutletContext = { token: string; user: SessionUser };
type LoginResult = SessionResponse | { twoFactorRequired: true; challengeToken: string; user: SessionUser };
type EmailLog = { id: string; toEmail: string; status: string; campaign: { name: string } };
type CampaignVariant = { id?: string; label: string; subject: string; bodyTemplate: string; trafficPercent: number; sentCount?: number; openCount?: number; replyCount?: number };
type CampaignStep = { id?: string; nodeId: string; stepType: string; delayHours: number; config: Record<string, unknown>; positionX: number; positionY: number };
type AnalyticsSummary = {
  funnel: { leadCreated: number; emailSent: number; emailOpened: number; replies: number };
  attribution: Array<{ source: string; replies: number }>;
  variantAttribution: Array<{ variantId: string | null; sent: number }>;
};
type InboxConnectionStatus = { connected: boolean; lastSyncedAt: string | null; username: string | null };
type CRMConnection = { id: string; provider: string; endpointUrl: string | null; lastSyncAt: string | null };
type AuditLog = { id: string; action: string; entityType: string; entityId: string | null; createdAt: string };
type Subscription = { id: string; plan: string; status: string; amountCents: number; createdAt: string };
type UsageSummary = { periodKey: string; totalAmountCents: number; metrics: Array<{ metric: string; quantity: number; amountCents: number }> };
type DunningEvent = {
  id: string;
  attemptNumber: number;
  status: string;
  stage: "grace" | "warning" | "suspended";
  message: string | null;
  scheduledFor: string;
  subscription: { id: string; plan: string; status: string };
};
type BillingPlanResponse = Record<string, { amountCents: number; amount: string; label: string }>;
type WorkerHealth = { workerOnline: boolean; lastHeartbeatAt: string | null; completedJobs30m: number; failedJobs30m: number };

const menu = [
  { key: "/dashboard", label: "Dashboard" },
  { key: "/leads", label: "Leads" },
  { key: "/campaigns", label: "Campaigns" },
  { key: "/analytics", label: "Analytics" },
  { key: "/inbox", label: "Inbox" },
  { key: "/integrations", label: "Integrations" },
  { key: "/security", label: "Security" },
  { key: "/billing", label: "Billing" },
];

const fallbackLeads: Lead[] = Array.from({ length: 25 }, (_, i) => ({
  id: `sample-${i + 1}`,
  name: `Contact ${i + 1}`,
  company: `Demo Company ${i + 1}`,
  website: `https://example${i + 1}.com`,
  email: `team${i + 1}@example${i + 1}.com`,
  location: "Amsterdam",
  status: i % 6 === 0 ? "replied" : i % 3 === 0 ? "contacted" : "new",
  source: "demo",
  createdAt: new Date().toISOString(),
}));

const fallbackCampaigns: Campaign[] = [
  { id: "c1", name: "Local Growth Push", subject: "Quick idea for {company}", bodyTemplate: "Hi {name}", status: "active", createdAt: new Date().toISOString(), _count: { campaignLeads: 12, emailLogs: 6 } },
  { id: "c2", name: "Agency Follow-up", subject: "Following up", bodyTemplate: "Hi {name}", status: "active", createdAt: new Date().toISOString(), _count: { campaignLeads: 13, emailLogs: 4 } },
];

const fallbackDashboard: DashboardSummary = {
  leadCount: 25,
  emailsSent: 10,
  replies: 3,
  conversion: 30,
  estimatedRevenue: 4500,
  recentLeads: fallbackLeads.slice(0, 8),
  recentCampaigns: fallbackCampaigns,
  dealValue: 1500,
};

const fallbackPlans: BillingPlanResponse = {
  starter: { label: "Starter", amount: "49.00", amountCents: 4900 },
  pro: { label: "Pro", amount: "99.00", amountCents: 9900 },
  agency: { label: "Agency", amount: "199.00", amountCents: 19900 },
};

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("Failed to fetch") || message.includes("NetworkError") || message === API_CONNECTION_ERROR) {
    return API_CONNECTION_ERROR;
  }
  return message;
}

function ErrorBanner({ message }: { message: string }) {
  return message ? <p className="rounded border border-amber-800 bg-amber-950/70 px-3 py-2 text-sm text-amber-200">{message}</p> : null;
}

function useSession() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("lf_token"));
  const [user, setUser] = useState<SessionUser | null>(() => {
    const raw = localStorage.getItem("lf_user");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionUser;
    } catch {
      return null;
    }
  });

  const save = (session: SessionResponse) => {
    localStorage.setItem("lf_token", session.token);
    localStorage.setItem("lf_user", JSON.stringify(session.user));
    setToken(session.token);
    setUser(session.user);
  };

  const logout = () => {
    localStorage.removeItem("lf_token");
    localStorage.removeItem("lf_user");
    setToken(null);
    setUser(null);
  };

  return { token, user, save, logout };
}

function useShellContext() {
  return useOutletContext<AppOutletContext>();
}

function LoginPage({ onSession }: { onSession: (session: SessionResponse) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [registerMode, setRegisterMode] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [twoFactorMode, setTwoFactorMode] = useState<"token" | "recovery">("token");

  const verifyConnection = async () => {
    setChecking(true);
    try {
      const health = await checkApiHealth();
      setBackendOnline(health.status === "ok");
      setError(health.status === "ok" ? "" : API_CONNECTION_ERROR);
    } catch {
      setBackendOnline(false);
      setError(API_CONNECTION_ERROR);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void verifyConnection();
  }, []);

  const onSubmitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    if (!backendOnline) return setError(API_CONNECTION_ERROR);
    setLoading(true);
    setError("");
    try {
      const endpoint = registerMode ? "/api/auth/register" : "/api/auth/login";
      const payload = registerMode ? form : { email: form.email, password: form.password };
      const result = await apiRequest<LoginResult>(endpoint, { method: "POST", body: payload });
      if ("twoFactorRequired" in result) {
        setChallengeToken(result.challengeToken);
        setTwoFactorCode("");
        setRecoveryCode("");
        return;
      }
      onSession(result);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitTwoFactor = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload =
        twoFactorMode === "token"
          ? { challengeToken, token: twoFactorCode }
          : { challengeToken, recoveryCode };
      const session = await apiRequest<SessionResponse>("/api/auth/login/2fa", { method: "POST", body: payload });
      onSession(session);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  };

  const tryDemo = async () => {
    if (!backendOnline) return setError(API_CONNECTION_ERROR);
    setLoading(true);
    setError("");
    try {
      const session = await apiRequest<SessionResponse>("/api/auth/demo", { method: "POST" });
      onSession(session);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-2">
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col justify-center px-8 py-16 sm:px-14">
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-300">LeadFlow Pro</p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight">Outreach automation without blank states.</h1>
          <p className="mt-3 max-w-xl text-zinc-400">Login, test with demo data, and manage full campaigns from one workspace.</p>

          {!challengeToken ? (
            <form className="mt-8 space-y-4" onSubmit={onSubmitCredentials}>
              {registerMode ? (
                <input className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2" placeholder="Full name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              ) : null}
              <input type="email" className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2" placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              <input type="password" className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2" placeholder="Password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
              <ErrorBanner message={error} />
              {!backendOnline ? (
                <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
                  <span>{checking ? "Checking backend connection..." : API_CONNECTION_ERROR}</span>
                  {!checking ? <button type="button" onClick={verifyConnection} className="rounded border border-zinc-700 px-2 py-1 text-xs">Retry</button> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button disabled={loading || !backendOnline} className="rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50">{loading ? "Loading..." : registerMode ? "Create Account" : "Sign In"}</button>
                <button type="button" onClick={tryDemo} disabled={loading || !backendOnline} className="rounded border border-zinc-700 px-4 py-2">Try Demo</button>
                <button type="button" onClick={() => setRegisterMode((p) => !p)} className="px-4 py-2 text-zinc-300 underline-offset-4 hover:underline">{registerMode ? "Have an account? Login" : "Need an account? Register"}</button>
              </div>
            </form>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={onSubmitTwoFactor}>
              <h2 className="text-lg font-semibold">Two-Factor Verification</h2>
              <p className="text-sm text-zinc-400">Enter your authenticator code or use a recovery code.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTwoFactorMode("token")} className={`rounded px-3 py-2 text-sm ${twoFactorMode === "token" ? "bg-zinc-800" : "bg-zinc-900"}`}>Authenticator Code</button>
                <button type="button" onClick={() => setTwoFactorMode("recovery")} className={`rounded px-3 py-2 text-sm ${twoFactorMode === "recovery" ? "bg-zinc-800" : "bg-zinc-900"}`}>Recovery Code</button>
              </div>
              {twoFactorMode === "token" ? (
                <input className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2" placeholder="123456" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} />
              ) : (
                <input className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2" placeholder="recovery code" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
              )}
              <ErrorBanner message={error} />
              <div className="flex gap-3">
                <button disabled={loading} className="rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50">{loading ? "Verifying..." : "Verify & Continue"}</button>
                <button type="button" onClick={() => setChallengeToken("")} className="rounded border border-zinc-700 px-4 py-2">Back</button>
              </div>
            </form>
          )}
        </motion.section>
        <section className="hidden bg-[url('https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=1974&auto=format&fit=crop')] bg-cover bg-center lg:block" />
      </div>
    </div>
  );
}

function Shell({ user, token, onLogout }: { user: SessionUser; token: string; onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const items = useMemo(() => (user.role === "admin" ? [...menu, { key: "/admin", label: "Admin" }] : menu), [user.role]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto grid min-h-screen max-w-[1400px] lg:grid-cols-[240px_1fr]">
        <aside className="border-r border-zinc-900 px-5 py-8">
          <button onClick={() => navigate("/dashboard")} className="text-sm uppercase tracking-[0.23em] text-cyan-300">LeadFlow Pro</button>
          <p className="mt-1 text-xs text-zinc-500">{user.email}</p>
          <nav className="mt-8 space-y-1">
            {items.map((item) => (
              <button key={item.key} onClick={() => navigate(item.key)} className={`w-full rounded px-3 py-2 text-left text-sm ${location.pathname.startsWith(item.key) ? "bg-zinc-800" : "text-zinc-400 hover:bg-zinc-900"}`}>
                {item.label}
              </button>
            ))}
          </nav>
          <button onClick={onLogout} className="mt-8 rounded border border-zinc-700 px-3 py-2 text-sm">Logout</button>
        </aside>
        <main className="px-4 py-6 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Outlet context={{ token, user }} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { token } = useShellContext();
  const [summary, setSummary] = useState<DashboardSummary>(fallbackDashboard);
  const [dealValue, setDealValue] = useState(summary.dealValue);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiRequest<DashboardSummary>("/api/dashboard/summary", { token })
      .then((data) => {
        setSummary(data);
        setDealValue(data.dealValue);
      })
      .catch((err) => setError(normalizeError(err)));
  }, [token]);

  const saveDealValue = async () => {
    try {
      await apiRequest("/api/dashboard/deal-value", { method: "PATCH", token, body: { dealValue } });
      const refreshed = await apiRequest<DashboardSummary>("/api/dashboard/summary", { token });
      setSummary(refreshed);
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  const leads = summary.recentLeads.length ? summary.recentLeads : fallbackLeads.slice(0, 8);
  const campaigns = summary.recentCampaigns.length ? summary.recentCampaigns : fallbackCampaigns;

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Revenue Dashboard</h2>
          <p className="text-zinc-400">Leads, outreach, replies and conversion at a glance.</p>
        </div>
      </div>
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[summary.leadCount, summary.emailsSent, summary.replies, summary.conversion].map((value, i) => (
          <div key={i} className="rounded border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm text-zinc-400">{["Leads", "Emails Sent", "Replies", "Conversion %"][i]}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">Revenue Estimator</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input type="number" value={dealValue} onChange={(e) => setDealValue(Number(e.target.value || 0))} className="w-40 rounded border border-zinc-700 bg-zinc-950 px-3 py-2" />
          <button onClick={saveDealValue} className="rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Save</button>
          <p className="font-semibold text-emerald-300">EUR {summary.estimatedRevenue.toLocaleString()}</p>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="font-semibold">Recent Leads</h3>
          {leads.map((lead) => <p key={lead.id} className="mt-2 text-sm text-zinc-300">{lead.company} · {lead.status}</p>)}
        </div>
        <div>
          <h3 className="font-semibold">Recent Campaigns</h3>
          {campaigns.map((campaign) => <p key={campaign.id} className="mt-2 text-sm text-zinc-300">{campaign.name} · {campaign.status}</p>)}
        </div>
      </div>
    </section>
  );
}

function LeadsPage() {
  const { token } = useShellContext();
  const [leads, setLeads] = useState<Lead[]>(fallbackLeads);
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("dentist");
  const [location, setLocation] = useState("Amsterdam");

  const load = async () => {
    try {
      const data = await apiRequest<Lead[]>(`/api/leads?status=${status}`, { token });
      setLeads(data);
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token, status]);

  const visible = leads.length ? leads : fallbackLeads;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Lead Management</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <option value="all">All</option><option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option>
        </select>
      </div>
      <ErrorBanner message={error} />
      <div className="flex flex-wrap gap-2 rounded border border-zinc-800 bg-zinc-900 p-3">
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Keyword" />
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Location" />
        <button onClick={() => apiRequest("/api/leads/scrape", { method: "POST", token, body: { keyword, location, maxResults: 25 } }).then(load).catch((err) => setError(normalizeError(err)))} className="rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Scrape Leads</button>
        <button disabled={!selected.length} onClick={() => apiRequest("/api/leads/bulk-delete", { method: "POST", token, body: { ids: selected } }).then(() => { setSelected([]); return load(); }).catch((err) => setError(normalizeError(err)))} className="rounded border border-red-800 px-4 py-2 text-red-300 disabled:opacity-50">Delete Selected</button>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-300"><tr><th className="px-3 py-2"/><th className="px-3 py-2">Company</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {visible.map((lead) => (
              <tr key={lead.id} className="border-t border-zinc-900"><td className="px-3 py-2"><input type="checkbox" checked={selected.includes(lead.id)} onChange={() => setSelected((prev) => prev.includes(lead.id) ? prev.filter((id) => id !== lead.id) : [...prev, lead.id])} /></td><td className="px-3 py-2">{lead.company}</td><td className="px-3 py-2">{lead.email || "-"}</td><td className="px-3 py-2">{lead.status}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CampaignsPage() {
  const { token } = useShellContext();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>(fallbackCampaigns);
  const [leads, setLeads] = useState<Lead[]>(fallbackLeads);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [name, setName] = useState("New campaign");
  const [subject, setSubject] = useState("Quick idea for {company}");
  const [bodyTemplate, setBodyTemplate] = useState("Hi {name},\n\nI can help {company} generate more qualified leads.");
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [campaignData, leadData, logData] = await Promise.all([
        apiRequest<Campaign[]>("/api/campaigns", { token }),
        apiRequest<Lead[]>("/api/leads?status=all", { token }),
        apiRequest<EmailLog[]>("/api/campaigns/emails/logs", { token }),
      ]);
      setCampaigns(campaignData);
      setLeads(leadData.filter((lead) => Boolean(lead.email)));
      setLogs(logData);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const visibleCampaigns = campaigns.length ? campaigns : fallbackCampaigns;
  const visibleLeads = leads.length ? leads : fallbackLeads;

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Campaigns</h2>
      <ErrorBanner message={error} />
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Create Campaign</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Campaign name" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Subject" />
          <textarea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 lg:col-span-2" rows={4} />
        </div>
        <div className="mt-3 max-h-40 overflow-auto rounded border border-zinc-800 p-2 text-sm">
          {visibleLeads.map((lead) => <label key={lead.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={selectedLeads.includes(lead.id)} onChange={() => setSelectedLeads((prev) => prev.includes(lead.id) ? prev.filter((id) => id !== lead.id) : [...prev, lead.id])} /><span>{lead.company}</span></label>)}
        </div>
        <button onClick={() => apiRequest("/api/campaigns", { method: "POST", token, body: { name, subject, bodyTemplate, leadIds: selectedLeads } }).then(load).catch((err) => setError(normalizeError(err)))} className="mt-3 rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Create</button>
      </div>

      <div className="space-y-2">
        {visibleCampaigns.map((campaign) => (
          <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900 p-3 text-sm">
            <div>
              <p className="font-semibold">{campaign.name}</p>
              <p className="text-zinc-400">{campaign._count?.campaignLeads || 0} leads · {campaign._count?.emailLogs || 0} sent</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigate(`/campaigns/${campaign.id}/builder`)} className="rounded border border-zinc-700 px-3 py-1">Builder</button>
              <button onClick={() => apiRequest("/api/campaigns/send", { method: "POST", token, body: { campaignId: campaign.id } }).then(load).catch((err) => setError(normalizeError(err)))} className="rounded border border-cyan-700 px-3 py-1 text-cyan-300">Launch</button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-semibold">Email Logs</h3>
        {logs.slice(0, 10).map((log) => <p key={log.id} className="mt-2 text-sm text-zinc-300">{log.toEmail} · {log.status} · {log.campaign.name}</p>)}
      </div>
    </section>
  );
}

function CampaignBuilderPage() {
  const { token } = useShellContext();
  const { id = "" } = useParams();
  const [variants, setVariants] = useState<CampaignVariant[]>([
    { label: "A", subject: "Quick idea for {company}", bodyTemplate: "Hi {name}", trafficPercent: 50 },
    { label: "B", subject: "Second angle for {company}", bodyTemplate: "Hi {name}", trafficPercent: 50 },
  ]);
  const [steps, setSteps] = useState<CampaignStep[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [variantData, stepData] = await Promise.all([
        apiRequest<CampaignVariant[]>(`/api/campaigns/${id}/variants`, { token }).catch(() => variants),
        apiRequest<CampaignStep[]>(`/api/campaigns/${id}/flow`, { token }).catch(() => []),
      ]);
      if (variantData.length) setVariants(variantData);
      setSteps(stepData);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token, id]);

  const saveVariants = async () => {
    try {
      await apiRequest("/api/campaigns/variants", { method: "POST", token, body: { campaignId: id, variants } });
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  const saveFlow = async () => {
    try {
      await apiRequest("/api/campaigns/flow", { method: "POST", token, body: { campaignId: id, steps } });
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Visual Campaign Builder</h2>
      <ErrorBanner message={error} />
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">A/B Variants</h3>
        {variants.map((variant, index) => (
          <div key={index} className="mt-3 grid gap-2 md:grid-cols-4">
            <input value={variant.label} onChange={(e) => setVariants((prev) => prev.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input value={variant.subject} onChange={(e) => setVariants((prev) => prev.map((item, i) => i === index ? { ...item, subject: e.target.value } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input type="number" value={variant.trafficPercent} onChange={(e) => setVariants((prev) => prev.map((item, i) => i === index ? { ...item, trafficPercent: Number(e.target.value || 0) } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input value={variant.bodyTemplate} onChange={(e) => setVariants((prev) => prev.map((item, i) => i === index ? { ...item, bodyTemplate: e.target.value } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
          </div>
        ))}
        <button onClick={saveVariants} className="mt-3 rounded border border-cyan-700 px-3 py-1 text-cyan-300">Save Variants</button>
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Flow Steps</h3>
        <button onClick={() => setSteps((prev) => [...prev, { nodeId: `node-${Date.now()}`, stepType: "email", delayHours: 0, config: { subject: "Follow-up" }, positionX: 0, positionY: 0 }])} className="mt-2 rounded border border-zinc-700 px-3 py-1 text-sm">Add Step</button>
        {steps.map((step, index) => (
          <div key={step.nodeId} className="mt-3 grid gap-2 md:grid-cols-4">
            <input value={step.stepType} onChange={(e) => setSteps((prev) => prev.map((item, i) => i === index ? { ...item, stepType: e.target.value } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input type="number" value={step.delayHours} onChange={(e) => setSteps((prev) => prev.map((item, i) => i === index ? { ...item, delayHours: Number(e.target.value || 0) } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input type="number" value={step.positionX} onChange={(e) => setSteps((prev) => prev.map((item, i) => i === index ? { ...item, positionX: Number(e.target.value || 0) } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
            <input type="number" value={step.positionY} onChange={(e) => setSteps((prev) => prev.map((item, i) => i === index ? { ...item, positionY: Number(e.target.value || 0) } : item))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
          </div>
        ))}
        <button onClick={saveFlow} className="mt-3 rounded border border-cyan-700 px-3 py-1 text-cyan-300">Save Flow</button>
      </div>
    </section>
  );
}

function AnalyticsPage() {
  const { token } = useShellContext();
  const [summary, setSummary] = useState<AnalyticsSummary>({ funnel: { leadCreated: 25, emailSent: 10, emailOpened: 7, replies: 3 }, attribution: [{ source: "demo", replies: 3 }], variantAttribution: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    void apiRequest<AnalyticsSummary>("/api/analytics/funnel", { token })
      .then(setSummary)
      .catch((err) => setError(normalizeError(err)));
  }, [token]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Funnel Analytics</h2>
      <ErrorBanner message={error} />
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Leads: {summary.funnel.leadCreated}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Sent: {summary.funnel.emailSent}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Opened: {summary.funnel.emailOpened}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Replies: {summary.funnel.replies}</div>
      </div>
      <div>
        <h3 className="font-semibold">Attribution</h3>
        {summary.attribution.map((row) => <p key={row.source} className="mt-2 text-sm text-zinc-300">{row.source}: {row.replies} replies</p>)}
      </div>
      <div>
        <h3 className="font-semibold">Variant Attribution</h3>
        {summary.variantAttribution.length ? summary.variantAttribution.map((row) => <p key={row.variantId || "none"} className="mt-2 text-sm text-zinc-300">{row.variantId || "default"}: {row.sent} sent</p>) : <p className="mt-2 text-sm text-zinc-400">No variant send data yet.</p>}
      </div>
    </section>
  );
}

function InboxPage() {
  const { token } = useShellContext();
  const [status, setStatus] = useState<InboxConnectionStatus>({ connected: false, lastSyncedAt: null, username: null });
  const [form, setForm] = useState({ host: "imap.gmail.com", port: 993, secure: true, username: "", password: "" });
  const [syncResult, setSyncResult] = useState<{ detectedReplies: number } | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const payload = await apiRequest<InboxConnectionStatus>("/api/inbox/status", { token });
      setStatus(payload);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Inbox Sync</h2>
      <ErrorBanner message={error} />
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4 text-sm">
        <p>Connected: {status.connected ? `Yes (${status.username || "mailbox"})` : "No"}</p>
        <p className="text-zinc-400">Last sync: {status.lastSyncedAt || "Never"}</p>
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Mailbox Connection</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input value={form.host} onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Host" />
          <input type="number" value={form.port} onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value || 0) }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Port" />
          <input value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Username" />
          <input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Password / App Password" />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => apiRequest("/api/inbox/connection", { method: "POST", token, body: form }).then(load).catch((err) => setError(normalizeError(err)))} className="rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Save Connection</button>
          <button onClick={() => apiRequest<{ detectedReplies: number }>("/api/inbox/sync", { method: "POST", token }).then((result) => { setSyncResult(result); return load(); }).catch((err) => setError(normalizeError(err)))} className="rounded border border-zinc-700 px-4 py-2">Sync Replies</button>
        </div>
        {syncResult ? <p className="mt-3 text-sm text-emerald-300">Detected replies: {syncResult.detectedReplies}</p> : null}
      </div>
    </section>
  );
}

function IntegrationsPage() {
  const { token } = useShellContext();
  const [connections, setConnections] = useState<CRMConnection[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [form, setForm] = useState({ provider: "hubspot", accessToken: "", refreshToken: "", endpointUrl: "" });
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [connData, leadData] = await Promise.all([
        apiRequest<CRMConnection[]>("/api/integrations/crm", { token }),
        apiRequest<Lead[]>("/api/leads?status=all", { token }),
      ]);
      setConnections(connData);
      setLeads(leadData.filter((lead) => Boolean(lead.email)));
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const save = () => {
    apiRequest("/api/integrations/crm", { method: "POST", token, body: { ...form, refreshToken: form.refreshToken || undefined, endpointUrl: form.endpointUrl || undefined } })
      .then(load)
      .catch((err) => setError(normalizeError(err)));
  };

  const sync = (provider: string) => {
    apiRequest("/api/integrations/crm/sync", { method: "POST", token, body: { provider, leadIds: selectedLeadIds } })
      .then(() => setError(""))
      .catch((err) => setError(normalizeError(err)));
  };

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">CRM Integrations</h2>
      <ErrorBanner message={error} />
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Connect CRM</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <select value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="hubspot">HubSpot</option><option value="pipedrive">Pipedrive</option><option value="salesforce">Salesforce</option></select>
          <input value={form.endpointUrl} onChange={(e) => setForm((p) => ({ ...p, endpointUrl: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Endpoint URL (optional)" />
          <input value={form.accessToken} onChange={(e) => setForm((p) => ({ ...p, accessToken: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Access token" />
          <input value={form.refreshToken} onChange={(e) => setForm((p) => ({ ...p, refreshToken: e.target.value }))} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Refresh token (optional)" />
        </div>
        <button onClick={save} className="mt-3 rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Save Integration</button>
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Select Leads To Sync</h3>
        <div className="mt-2 max-h-40 overflow-auto">
          {leads.slice(0, 30).map((lead) => <label key={lead.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={() => setSelectedLeadIds((prev) => prev.includes(lead.id) ? prev.filter((id) => id !== lead.id) : [...prev, lead.id])} /><span>{lead.company}</span></label>)}
        </div>
      </div>
      <div className="space-y-2">
        {connections.length ? connections.map((connection) => (
          <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900 p-3 text-sm">
            <span>{connection.provider} · Last sync: {connection.lastSyncAt || "Never"}</span>
            <div className="flex gap-2">
              <button onClick={() => sync(connection.provider)} className="rounded border border-cyan-700 px-3 py-1 text-cyan-300">Sync Selected Leads</button>
              <button onClick={() => apiRequest(`/api/integrations/crm/${connection.provider}`, { method: "DELETE", token }).then(load).catch((err) => setError(normalizeError(err)))} className="rounded border border-red-800 px-3 py-1 text-red-300">Disconnect</button>
            </div>
          </div>
        )) : <p className="text-sm text-zinc-400">No CRM connections yet.</p>}
      </div>
    </section>
  );
}

function SecurityPage() {
  const { token, user } = useShellContext();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [tokenCode, setTokenCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState("");

  const loadAudit = async () => {
    try {
      const logs = await apiRequest<AuditLog[]>("/api/security/audit-logs", { token });
      setAuditLogs(logs);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void loadAudit();
  }, [token]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Security & 2FA</h2>
      <ErrorBanner message={error} />
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-300">2FA enabled: {user.twoFactorEnabled ? "Yes" : "No"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => apiRequest<{ qrDataUrl: string; secret: string }>("/api/security/2fa/setup", { token }).then(setSetup).catch((err) => setError(normalizeError(err)))} className="rounded border border-zinc-700 px-3 py-1">Setup 2FA</button>
          <input value={tokenCode} onChange={(e) => setTokenCode(e.target.value)} placeholder="Enable token" className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1" />
          <button onClick={() => apiRequest("/api/security/2fa/enable", { method: "POST", token, body: { token: tokenCode } }).then(loadAudit).catch((err) => setError(normalizeError(err)))} className="rounded border border-cyan-700 px-3 py-1 text-cyan-300">Enable</button>
          <input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="Disable token" className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1" />
          <button onClick={() => apiRequest("/api/security/2fa/disable", { method: "POST", token, body: { token: disableCode } }).then(loadAudit).catch((err) => setError(normalizeError(err)))} className="rounded border border-red-800 px-3 py-1 text-red-300">Disable</button>
        </div>
        {setup ? <img src={setup.qrDataUrl} alt="2fa qr" className="mt-3 h-40 w-40" /> : null}
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Audit Logs</h3>
        {auditLogs.slice(0, 20).map((log) => <p key={log.id} className="mt-2 text-sm text-zinc-300">{new Date(log.createdAt).toLocaleString()} · {log.action}</p>)}
      </div>
    </section>
  );
}

function BillingPage() {
  const { token, user } = useShellContext();
  const [plans, setPlans] = useState<BillingPlanResponse>(fallbackPlans);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [dunning, setDunning] = useState<DunningEvent[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [planData, subscriptionData, usageData, dunningData] = await Promise.all([
        apiRequest<BillingPlanResponse>("/api/billing/plans", { token }),
        apiRequest<Subscription[]>("/api/billing/subscriptions", { token }),
        apiRequest<UsageSummary>("/api/billing/usage-summary", { token }),
        apiRequest<DunningEvent[]>("/api/billing/dunning-events", { token }),
      ]);
      setPlans(planData);
      setSubscriptions(subscriptionData);
      setUsage(usageData);
      setDunning(dunningData);
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Billing</h2>
      <p className="text-zinc-400">Current plan: {user.plan}</p>
      <ErrorBanner message={error} />
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(plans).map(([key, plan]) => (
          <div key={key} className="rounded border border-zinc-800 bg-zinc-900 p-4">
            <p className="font-semibold">{plan.label}</p>
            <p className="text-zinc-400">EUR {plan.amount}/month</p>
            <button onClick={() => apiRequest<{ checkoutUrl: string }>("/api/billing/upgrade", { method: "POST", token, body: { plan: key } }).then((r) => (window.location.href = r.checkoutUrl)).catch((err) => setError(normalizeError(err)))} className="mt-2 rounded bg-cyan-400 px-4 py-2 font-semibold text-zinc-950">Upgrade</button>
          </div>
        ))}
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Usage ({usage?.periodKey || "current"})</h3>
        <p className="mt-1 text-sm text-zinc-300">Total: EUR {((usage?.totalAmountCents || 0) / 100).toFixed(2)}</p>
        {usage?.metrics.map((metric) => <p key={metric.metric} className="mt-1 text-sm text-zinc-400">{metric.metric}: {metric.quantity} · EUR {(metric.amountCents / 100).toFixed(2)}</p>)}
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Dunning</h3>
        {dunning.length ? dunning.map((event) => (
          <div key={event.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Attempt {event.attemptNumber} · {event.stage} · {event.status}</span>
            <span className="text-zinc-500">{new Date(event.scheduledFor).toLocaleString()}</span>
          </div>
        )) : <p className="mt-2 text-sm text-zinc-400">No dunning events.</p>}
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Subscriptions</h3>
        {subscriptions.map((sub) => <p key={sub.id} className="mt-2 text-sm text-zinc-300">{sub.plan} · {sub.status} · EUR {(sub.amountCents / 100).toFixed(2)}</p>)}
      </div>
    </section>
  );
}

function AdminPage() {
  const { token } = useShellContext();
  const [summary, setSummary] = useState<{ totals: { totalUsers: number; totalLeads: number; totalCampaigns: number; totalEmailsSent: number } } | null>(null);
  const [worker, setWorker] = useState<WorkerHealth | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      apiRequest<{ totals: { totalUsers: number; totalLeads: number; totalCampaigns: number; totalEmailsSent: number } }>("/api/admin/summary", { token }),
      apiRequest<WorkerHealth>("/api/admin/worker-health", { token }),
    ])
      .then(([summaryData, workerData]) => {
        setSummary(summaryData);
        setWorker(workerData);
      })
      .catch((err) => setError(normalizeError(err)));
  }, [token]);

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Admin</h2>
      <ErrorBanner message={error} />
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Users: {summary?.totals.totalUsers || 0}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Leads: {summary?.totals.totalLeads || 0}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Campaigns: {summary?.totals.totalCampaigns || 0}</div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">Emails: {summary?.totals.totalEmailsSent || 0}</div>
      </div>
      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="font-semibold">Worker Health</h3>
        <p className="mt-2 text-sm text-zinc-300">Online: {worker?.workerOnline ? "Yes" : "No"}</p>
        <p className="mt-1 text-sm text-zinc-400">Last heartbeat: {worker?.lastHeartbeatAt || "Never"}</p>
        <p className="mt-1 text-sm text-zinc-400">Completed jobs (30m): {worker?.completedJobs30m || 0}</p>
        <p className="mt-1 text-sm text-zinc-400">Failed jobs (30m): {worker?.failedJobs30m || 0}</p>
      </div>
    </section>
  );
}

function AppRoutes() {
  const session = useSession();

  if (!session.token || !session.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSession={session.save} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell user={session.user} token={session.token} onLogout={session.logout} />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/:id/builder" element={<CampaignBuilderPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/admin" element={session.user.role === "admin" ? <AdminPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
