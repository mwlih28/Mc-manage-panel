import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Copy, Eye, EyeOff, RefreshCw, Download, ShoppingCart, X, Gauge, Info,
  Unlink, Save,
} from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

interface CommandMapping {
  packageId: string;
  // Either or both — a mapping can run a console command, apply a resource
  // plan upgrade, or both from a single purchase.
  command?: string;
  planId?: string;
  // Stripe-only — the price to charge, used once to auto-create the
  // Product/Price that becomes this mapping's packageId. Not sent again
  // once packageId is set (Stripe Prices are immutable).
  unitAmount?: number;
  currency?: string;
}

interface PlanRow {
  id: string;
  name: string;
  memory: number;
  swap: number;
  disk: number;
  io: number;
  cpu: number;
  databaseLimit: number;
  allocationLimit: number;
  backupLimit: number;
}

interface StoreIntegrationRow {
  id: string;
  provider: 'tebex' | 'craftingstore' | 'stripe' | 'paytr';
  name: string;
  serverId: string;
  server: { id: string; name: string };
  commandMappings: CommandMapping[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastStatus: 'success' | 'failed' | 'skipped' | null;
  lastError: string | null;
}

function StatusDot({ status }: { status: StoreIntegrationRow['lastStatus'] }) {
  const color = status === 'success' ? 'bg-[#3EC896]' : status === 'failed' ? 'bg-red-500' : status === 'skipped' ? 'bg-amber-500' : 'bg-zinc-600';
  const title = status === 'success' ? 'Last purchase ran successfully' : status === 'failed' ? 'Last purchase failed' : status === 'skipped' ? 'Last purchase had no matching package mapping' : 'Never triggered';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={title} />;
}

// Stripe's own logomark (the "S" wordmark), on their brand purple (#635BFF).
export function StripeMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md shrink-0 ${className}`}
      style={{ width: size + 10, height: size + 10, backgroundColor: '#635BFF' }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" />
      </svg>
    </span>
  );
}

// PayTR's own wordmark, on their brand navy (#0F2666) — matches how PayTR
// displays it themselves (white logo on a dark header).
export function PaytrMark({ height = 20, className = '' }: { height?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md shrink-0 px-2.5 ${className}`}
      style={{ height: height + 10, backgroundColor: '#0F2666' }}
    >
      <svg height={height * 0.7} viewBox="0 0 135 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fillRule="evenodd" clipRule="evenodd" d="M22.9758 12.9827H16.8273C16.0221 12.9827 15.2901 13.5683 15.1071 14.3734L13.6798 20.8513C13.4236 21.9493 14.485 23.0107 15.5829 23.0107H34.0285C35.5657 23.0107 36.9198 21.8761 37.1394 20.339L38.6399 11.1527L39.8111 3.94285C40.1405 2.00313 38.6399 0.283005 36.7002 0.283005H18.95C18.0716 0.283005 17.3396 0.905179 17.1932 1.74694L17.0468 2.7351C16.8639 3.79645 17.7056 4.78461 18.8036 4.78461H23.8542C25.9769 4.78461 27.5872 6.72433 27.1846 8.77384L26.965 10.5306C26.6722 12.1409 25.4645 13.0193 23.8176 13.0193" fill="white" />
        <path fillRule="evenodd" clipRule="evenodd" d="M8.95858 19.2776H5.88431C5.15234 19.2776 4.49356 19.7168 4.31057 20.3024L4.01778 21.2905C3.76159 22.1323 4.53016 22.9741 5.59152 22.9741H8.66579C9.39776 22.9741 10.0565 22.5349 10.2395 21.9493L10.5323 20.9611C10.7885 20.0828 10.0199 19.2776 8.95858 19.2776Z" fill="white" />
        <path fillRule="evenodd" clipRule="evenodd" d="M10.1297 13.0193H2.48065C1.74868 13.0193 1.0899 13.5316 0.906912 14.227L0.614123 15.3616C0.357933 16.3497 1.1265 17.3013 2.18786 17.3013H9.83694C10.5689 17.3013 11.2277 16.7889 11.4107 16.0935L11.7035 14.959C11.9597 14.0074 11.1911 13.0193 10.1297 13.0193Z" fill="white" />
        <path fillRule="evenodd" clipRule="evenodd" d="M6.0673 4.63821H11.9597C12.6916 4.63821 13.3504 4.12583 13.5334 3.39386L13.8262 2.22271C14.0824 1.19795 13.3138 0.209793 12.2524 0.209793H6.36008C5.62811 0.209793 4.96934 0.722169 4.78635 1.45414L4.49356 2.62529C4.27397 3.65005 5.04254 4.63821 6.0673 4.63821Z" fill="white" />
        <path fillRule="evenodd" clipRule="evenodd" d="M6.76267 7.93207L6.46988 9.10323C6.21369 10.128 6.98226 11.1161 8.04362 11.1161H19.5721C20.3041 11.1161 20.9629 10.6038 21.1459 9.87179L21.4387 8.70064C21.6949 7.67589 20.9263 6.68773 19.8649 6.68773H8.33641C7.60444 6.68773 6.94566 7.20011 6.76267 7.93207Z" fill="white" />
        <path d="M46.472 0.100006H54.2675C59.7207 0.100006 62.8681 2.91808 62.8681 7.67588C62.8681 12.5435 59.6841 15.325 54.2675 15.325H51.3762V22.8643H46.472V0.100006ZM54.1577 11.3357C56.4634 11.3357 57.8541 10.0182 57.8541 7.74909C57.8541 5.47998 56.4634 4.16244 54.1577 4.16244H51.3396V11.3723H54.1577V11.3357Z" fill="white" />
        <path d="M75.6776 17.9967H66.7842L65.2104 22.8643H60.0867L68.2115 0.100006H74.6528L82.7777 22.8643H77.2879L75.6776 17.9967ZM74.4699 14.3734L71.3224 4.74801H71.0662L67.9187 14.3734H74.4699Z" fill="white" />
        <path d="M85.2298 14.2636L77.1781 0.136612H82.6679L87.6087 9.65222H87.9015L92.9521 0.136612H98.1125L90.0974 14.2636V22.9009H85.2298V14.2636Z" fill="white" />
        <path d="M104.041 4.16244H97.6733L99.9424 0.136612H115.314V4.16244H108.909V22.9009H104.041V4.16244Z" fill="white" />
        <path d="M129.221 22.9009L124.829 15.3616H124.683H121.792V22.9009H116.924V0.136612H124.72C130.173 0.136612 133.32 2.95469 133.32 7.71249C133.32 11.0795 131.82 13.4585 129.038 14.593L134.565 22.9009H129.221ZM121.792 11.3357H124.61C126.915 11.3357 128.306 9.9816 128.306 7.71249C128.306 5.47998 126.915 4.16244 124.61 4.16244H121.792V11.3357Z" fill="white" />
      </svg>
    </span>
  );
}

// "Connect with Stripe" — a real OAuth round trip through a central relay
// (Stripe requires a fixed, pre-registered redirect_uri, which can't be
// every self-hosted admin's own domain). This component only ever sees the
// tail end of that flow: the API's /stripe-connect/finish route redirects
// the browser back here with a short-lived, single-use exchange code, which
// gets traded (server-to-server, from this install's own backend) for the
// real connection — nothing sensitive ever reaches this component directly.
function StripeSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then((r) => r.data as Record<string, string>),
  });
  const accountId = settings?.['stripe.connect.accountId'];
  const connected = !!accountId;

  useEffect(() => {
    const exchangeCode = searchParams.get('stripeExchangeCode');
    const state = searchParams.get('stripeState');
    const error = searchParams.get('stripeError');

    if (error) {
      const messages: Record<string, string> = {
        not_configured: 'Stripe Connect is not set up on this deployment yet.',
        stripe_exchange_failed: 'Stripe was unable to complete the connection. Please try again.',
        invalid: 'The Stripe connection attempt was invalid or expired.',
      };
      toast.error(messages[error] || 'Failed to connect Stripe.');
      setSearchParams({}, { replace: true });
    } else if (exchangeCode && state) {
      setConnecting(true);
      api.post('/stripe-connect/complete', { exchangeCode, state })
        .then(() => {
          toast.success('Stripe connected');
          queryClient.invalidateQueries({ queryKey: ['site-settings'] });
        })
        .catch((err) => {
          const e = err as { response?: { data?: { message?: string } } };
          toast.error(e.response?.data?.message || 'Failed to complete the Stripe connection');
        })
        .finally(() => {
          setConnecting(false);
          setSearchParams({}, { replace: true });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: () => api.post('/stripe-connect/disconnect'),
    onSuccess: () => {
      toast.success('Stripe disconnected');
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: () => toast.error('Failed to disconnect Stripe'),
  });

  // /stripe-connect/start needs the admin's JWT (axios attaches it to a
  // normal fetch automatically) — a plain <a href> navigation wouldn't carry
  // it, since this panel keeps its session token in localStorage rather
  // than a cookie. So this fetches the authorize URL first, then navigates
  // the browser there itself once it has it.
  const [startingConnect, setStartingConnect] = useState(false);
  const startConnect = async () => {
    setStartingConnect(true);
    try {
      const { data } = await api.get('/stripe-connect/start');
      window.location.href = data.url;
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to start the Stripe connection');
      setStartingConnect(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Stripe</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Connect your own Stripe account to sell resource upgrades or ranks through a real checkout — payments go straight to your account, Kretase never touches the money.
          </p>
        </div>
        <StripeMark />
      </div>
      <div className="p-6">
        {connecting ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400"><Spinner size="sm" /> Completing connection…</div>
        ) : connected ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-200">Connected</p>
              <p className="text-xs text-zinc-600 font-mono mt-0.5">{accountId}</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
              <Unlink size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <button className="btn-stripe" onClick={startConnect} disabled={startingConnect}>
            {startingConnect && <Spinner size="sm" />} Connect with Stripe
          </button>
        )}
      </div>
    </div>
  );
}

// PayTR is a plain Settings-form card, not an OAuth button — no platform
// account, no relay, admins just paste the 3 credentials from their own
// PayTR merchant panel (issued after PayTR's own KYC approval, entirely on
// their side). Same shape as smtp.*/discord.botToken elsewhere in Settings.
function PaytrSection() {
  const queryClient = useQueryClient();
  const [merchantId, setMerchantId] = useState('');
  const [merchantKey, setMerchantKey] = useState('');
  const [merchantSalt, setMerchantSalt] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then((r) => r.data as Record<string, string>),
  });

  useEffect(() => {
    if (!settings) return;
    setMerchantId(settings['paytr.merchantId'] || '');
    setMerchantKey(settings['paytr.merchantKey'] || '');
    setMerchantSalt(settings['paytr.merchantSalt'] || '');
    setTestMode(settings['paytr.testMode'] === 'true');
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings', {
      'paytr.merchantId': merchantId.trim(),
      'paytr.merchantKey': merchantKey.trim(),
      'paytr.merchantSalt': merchantSalt.trim(),
      'paytr.testMode': String(testMode),
    }),
    onSuccess: () => {
      toast.success('PayTR settings saved');
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: () => toast.error('Failed to save PayTR settings'),
  });

  const API_ORIGIN = import.meta.env.VITE_API_URL || '';
  // Unlike Tebex/CraftingStore/Stripe, PayTR's notify_url is a single
  // account-wide setting configured once in the merchant's own PayTR panel
  // — not per-integration. Every PayTR purchase across every integration
  // on this install posts here; merchant_oid is what tells them apart.
  const notifyUrl = `${API_ORIGIN}/api/v1/store-webhooks/paytr`;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">PayTR</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Turkish payment processor — paste the credentials from your own PayTR merchant panel. Payments go straight to your PayTR account.
          </p>
        </div>
        <PaytrMark />
      </div>
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Merchant ID</label>
          <input className="input font-mono text-xs" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="123456" />
        </div>
        <div>
          <label className="label">Merchant Key</label>
          <div className="flex items-center gap-2">
            <input className="input font-mono text-xs flex-1" type={showSecrets ? 'text' : 'password'} value={merchantKey} onChange={(e) => setMerchantKey(e.target.value)} />
            <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setShowSecrets((s) => !s)}>
              {showSecrets ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Merchant Salt</label>
          <input className="input font-mono text-xs" type={showSecrets ? 'text' : 'password'} value={merchantSalt} onChange={(e) => setMerchantSalt(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          Test mode
        </label>
        <div className="rounded-lg border border-zinc-800 p-4 space-y-2">
          <label className="label">Notification URL</label>
          <div className="flex items-center gap-2">
            <code className="input font-mono text-xs flex-1 select-all truncate">{notifyUrl}</code>
            <button className="btn-secondary btn-sm shrink-0" onClick={() => { navigator.clipboard.writeText(notifyUrl); toast.success('Copied'); }}>
              <Copy size={13} />
            </button>
          </div>
          <p className="text-[11px] text-zinc-600">
            Paste this once into your PayTR merchant panel's Notification URL setting — it's account-wide, not per-integration.
          </p>
        </div>
        <button className="btn-paytr" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Spinner size="sm" /> : <Save size={16} />} Save
        </button>
      </div>
    </div>
  );
}

export function AdminIntegrationsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editIntegration, setEditIntegration] = useState<StoreIntegrationRow | null>(null);
  const [deleteIntegration, setDeleteIntegration] = useState<StoreIntegrationRow | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-store-integrations'],
    queryFn: () => api.get('/store-integrations').then((r) => r.data.data as StoreIntegrationRow[]),
  });

  const { data: serversData } = useQuery({
    queryKey: ['admin-store-integration-servers'],
    queryFn: () => api.get('/servers', { params: { perPage: 100 } }).then((r) => r.data.data as { id: string; name: string }[]),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin-plans'],
    queryFn: () => api.get('/plans').then((r) => r.data.data as PlanRow[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/store-integrations/${id}`),
    onSuccess: () => {
      toast.success('Integration deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-store-integrations'] });
      setDeleteIntegration(null);
    },
    onError: () => toast.error('Failed to delete integration'),
  });

  const integrations = data || [];
  const servers = serversData || [];
  const plans = plansData || [];

  // Absolute API-origin URLs — nginx's standard reverse-proxy config only
  // forwards /api/ to the backend, so a plain root-relative link here would
  // hit the SPA fallback instead of the actual file (404 → client-side
  // redirect) on every real deployment.
  const API_ORIGIN = import.meta.env.VITE_API_URL || '';
  const WHMCS_MODULE_URL = `${API_ORIGIN}/api/v1/integrations/whmcs`;
  const BLESTA_MODULE_URL = `${API_ORIGIN}/api/v1/integrations/blesta`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Billing & Store Integrations</h1>
        <p className="text-slate-400 text-sm mt-1">
          Plug Kretase into your billing panel or in-game store.
        </p>
      </div>

      {/* WHMCS / Blesta */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100">Billing Panel Modules</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            WHMCS and Blesta call these modules on order/suspend/terminate — they use your existing Admin API keys, nothing else to configure here.
          </p>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <a href={WHMCS_MODULE_URL} download className="flex items-center justify-between gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div>
              <p className="text-sm font-medium text-zinc-200">WHMCS Module</p>
              <p className="text-xs text-zinc-600 mt-0.5">modules/servers/kretase/kretase.php</p>
            </div>
            <Download size={16} className="text-zinc-500 shrink-0" />
          </a>
          <a href={BLESTA_MODULE_URL} download className="flex items-center justify-between gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div>
              <p className="text-sm font-medium text-zinc-200">Blesta Module</p>
              <p className="text-xs text-zinc-600 mt-0.5">.zip → unzip into components/modules/kretase/</p>
            </div>
            <Download size={16} className="text-zinc-500 shrink-0" />
          </a>
        </div>
        <div className="mx-6 mb-6 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
          <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/80 leading-relaxed">
            These modules are free for anyone to download and resell with — Kretase doesn't gate or license the
            software itself. Downloading one doesn't make a deployment "Kretase Certified": that's a separate,
            manual accreditation the Kretase Core Team issues after reviewing an installation. Kretase isn't
            responsible for the performance, uptime, or support quality of an uncertified provider's deployment.
            Certified providers get a Certificate ID they can enter in their module settings to show a verified
            badge to their own customers — see <a href="https://kretase.com/partners.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-100">kretase.com/partners.html</a>.
          </p>
        </div>
      </div>

      {/* Stripe */}
      <StripeSection />

      {/* PayTR */}
      <PaytrSection />

      {/* Resource Plans */}
      <PlansSection plans={plans} onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin-plans'] })} />

      {/* Tebex / CraftingStore / Stripe / PayTR */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Store Integrations</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Integration
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : integrations.length === 0 ? (
        <div className="card p-12 text-center">
          <ShoppingCart size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">No store integrations yet</p>
          <p className="text-slate-500 text-sm mt-2">Map a Tebex, CraftingStore, Stripe, or PayTR package to a console command — like granting a rank on purchase.</p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create First Integration
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Server</th>
                  <th>Mappings</th>
                  <th>Last Triggered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.id}>
                    <td><StatusDot status={i.lastStatus} /></td>
                    <td className="font-medium text-zinc-200">{i.name}{!i.enabled && <span className="ml-2 text-[10px] text-zinc-600">(disabled)</span>}</td>
                    <td>
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={
                          i.provider === 'tebex' ? { background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }
                            : i.provider === 'stripe' ? { background: 'rgba(99,91,255,0.12)', color: '#8B85FF' }
                            : i.provider === 'paytr' ? { background: 'rgba(15,38,102,0.25)', color: '#5B9BE8' }
                            : { background: 'rgba(16,185,129,0.1)', color: '#34d399' }
                        }
                      >
                        {i.provider}
                      </span>
                    </td>
                    <td className="text-xs text-zinc-500">{i.server?.name}</td>
                    <td className="text-xs text-zinc-500">{i.commandMappings.length} mapping{i.commandMappings.length !== 1 ? 's' : ''}</td>
                    <td className="text-zinc-500 text-xs">{i.lastTriggeredAt ? new Date(i.lastTriggeredAt).toLocaleString() : 'Never'}</td>
                    <td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button className="btn-secondary btn-sm" onClick={() => setEditIntegration(i)} title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => setDeleteIntegration(i)} title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(showCreate || editIntegration) && (
        <StoreIntegrationModal
          servers={servers}
          plans={plans}
          existing={editIntegration}
          onClose={() => { setShowCreate(false); setEditIntegration(null); }}
          onSaved={() => {
            setShowCreate(false);
            setEditIntegration(null);
            queryClient.invalidateQueries({ queryKey: ['admin-store-integrations'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteIntegration}
        onClose={() => setDeleteIntegration(null)}
        onConfirm={() => deleteIntegration && deleteMutation.mutate(deleteIntegration.id)}
        title="Delete Integration"
        message={`Delete "${deleteIntegration?.name}"? Purchases will stop running commands immediately.`}
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function StoreIntegrationModal({ servers, plans, existing, onClose, onSaved }: {
  servers: { id: string; name: string }[];
  plans: PlanRow[];
  existing: StoreIntegrationRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [provider, setProvider] = useState<'tebex' | 'craftingstore' | 'stripe' | 'paytr'>(existing?.provider || 'tebex');
  const [serverId, setServerId] = useState(existing?.serverId || '');
  const [mappings, setMappings] = useState<CommandMapping[]>(existing?.commandMappings?.length ? existing.commandMappings : [{ packageId: '', command: '', planId: '' }]);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then((r) => r.data as Record<string, string>),
  });
  const stripeConnected = !!settings?.['stripe.connect.accountId'];
  const paytrConfigured = settings?.['paytr.configured'] === 'true';
  // Stripe and PayTR share the same UX shape: the admin picks a price, not
  // a pre-existing external package id — see resolveMappings in
  // storeIntegrations.ts for what each does with that server-side.
  const usesPriceMapping = provider === 'stripe' || provider === 'paytr';

  const webhookUrl = existing ? `${window.location.origin}/api/v1/store-webhooks/${existing.id}` : null;

  const loadSecret = async () => {
    if (!existing) return;
    const { data } = await api.get(`/store-integrations/${existing.id}/secret`);
    setSecret(data.secret);
    setShowSecret(true);
  };

  const regenerateSecret = async () => {
    if (!existing) return;
    await api.put(`/store-integrations/${existing.id}`, { regenerateSecret: true });
    await loadSecret();
    toast.success(provider === 'stripe' ? 'Webhook secret rotated' : 'Secret regenerated — update it in your store dashboard too');
  };

  const updateMapping = (idx: number, field: keyof CommandMapping, value: string) => {
    setMappings((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  // Kept separate from updateMapping since unitAmount is stored in cents
  // (a number) while every other mapping field is a plain string.
  const updatePrice = (idx: number, cents: number) => {
    setMappings((prev) => prev.map((m, i) => (i === idx ? { ...m, unitAmount: cents } : m)));
  };

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!serverId) { toast.error('Pick a server'); return; }
    if (provider === 'stripe' && !stripeConnected) { toast.error('Connect Stripe first (above) before creating a Stripe integration'); return; }
    if (provider === 'paytr' && !paytrConfigured) { toast.error('Save your PayTR credentials first (above) before creating a PayTR integration'); return; }
    const cleanMappings = mappings
      .filter((m) => (usesPriceMapping ? (!!m.packageId || !!m.unitAmount) : m.packageId.trim()))
      .filter((m) => m.command?.trim() || m.planId)
      .map((m) => ({
        packageId: m.packageId.trim(),
        command: m.command?.trim() || undefined,
        planId: m.planId || undefined,
        // Only sent for a mapping that still needs its Price/id created —
        // once packageId is set the amount/currency are inert (Stripe
        // Prices are immutable; PayTR mappings just never revisit this).
        ...(usesPriceMapping && !m.packageId ? { unitAmount: m.unitAmount, currency: provider === 'stripe' ? (m.currency || 'usd') : 'try' } : {}),
      }));
    setLoading(true);
    try {
      const payload = { name: name.trim(), provider, serverId, commandMappings: cleanMappings };
      if (existing) {
        await api.put(`/store-integrations/${existing.id}`, payload);
      } else {
        await api.post('/store-integrations', payload);
      }
      onSaved();
      toast.success(existing ? 'Integration updated' : 'Integration created');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to save integration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Edit Integration' : 'New Store Integration'} size="lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="e.g. Main store" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">Provider</label>
          <div className="flex gap-2">
            <button type="button" className={provider === 'tebex' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('tebex')}>Tebex</button>
            <button type="button" className={provider === 'craftingstore' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('craftingstore')}>CraftingStore</button>
            <button type="button" className={provider === 'stripe' ? 'btn-stripe btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('stripe')}>
              <StripeMark size={10} className="!rounded" /> Stripe
            </button>
            <button type="button" className={provider === 'paytr' ? 'btn-paytr btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('paytr')}>
              <PaytrMark height={10} className="!rounded !px-1.5" /> PayTR
            </button>
          </div>
          {provider === 'stripe' && !stripeConnected && (
            <p className="text-[11px] text-amber-400 mt-1.5">Connect Stripe in the card above before creating a Stripe integration.</p>
          )}
          {provider === 'paytr' && !paytrConfigured && (
            <p className="text-[11px] text-amber-400 mt-1.5">Save your PayTR credentials in the card above before creating a PayTR integration.</p>
          )}
        </div>

        <div>
          <label className="label">Server</label>
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">Select a server…</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {provider === 'paytr' && (
          <p className="text-[11px] text-zinc-600 -mt-2">
            PayTR notifications use the single account-wide URL shown in the PayTR card above — no per-integration webhook to configure here.
          </p>
        )}

        {existing && webhookUrl && provider !== 'paytr' && (
          <div className="rounded-lg border border-zinc-800 p-4 space-y-2">
            <label className="label">Webhook URL</label>
            <div className="flex items-center gap-2">
              <code className="input font-mono text-xs flex-1 select-all truncate">{webhookUrl}</code>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copied'); }}>
                <Copy size={13} />
              </button>
            </div>
            <label className="label">Webhook Secret</label>
            <div className="flex items-center gap-2">
              <code className="input font-mono text-xs flex-1 select-all">{showSecret && secret ? secret : '•'.repeat(32)}</code>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => (showSecret ? setShowSecret(false) : loadSecret())}>
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button className="btn-secondary btn-sm shrink-0" onClick={regenerateSecret} title="Regenerate">
                <RefreshCw size={13} />
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              {provider === 'stripe'
                ? 'Registered automatically on your connected Stripe account — nothing to paste anywhere.'
                : `Paste both into your ${provider === 'tebex' ? 'Tebex' : 'CraftingStore'} webhook settings.`}
            </p>
          </div>
        )}

        <div>
          <label className="label">{usesPriceMapping ? 'Price → Command / Plan Mappings' : 'Package → Command / Plan Mappings'}</label>
          <div className="space-y-2">
            {mappings.map((m, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                {usesPriceMapping ? (
                  m.packageId ? (
                    <code className="input font-mono text-[10px] w-28 shrink-0 truncate" title={m.packageId}>{m.packageId}</code>
                  ) : (
                    <>
                      <input
                        className="input text-xs w-20 shrink-0" type="number" step="0.01" min="0" placeholder={provider === 'paytr' ? '9.99 TL' : '9.99'}
                        value={m.unitAmount != null ? String(m.unitAmount / 100) : ''}
                        onChange={(e) => updatePrice(idx, Math.round((parseFloat(e.target.value) || 0) * 100))}
                      />
                      {provider === 'stripe' && (
                        <input className="input text-xs w-14 shrink-0" placeholder="usd" value={m.currency || 'usd'} onChange={(e) => updateMapping(idx, 'currency', e.target.value)} />
                      )}
                    </>
                  )
                ) : (
                  <input className="input font-mono text-xs w-24 shrink-0" placeholder="Package ID" value={m.packageId} onChange={(e) => updateMapping(idx, 'packageId', e.target.value)} />
                )}
                <input className="input font-mono text-xs flex-1 min-w-0" placeholder="lp user {username} parent addtemp vip 30d" value={m.command || ''} onChange={(e) => updateMapping(idx, 'command', e.target.value)} />
                <select className="input text-xs w-32 shrink-0" value={m.planId || ''} onChange={(e) => updateMapping(idx, 'planId', e.target.value)}>
                  <option value="">No plan</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" className="text-zinc-600 hover:text-red-400 shrink-0" onClick={() => setMappings((prev) => prev.filter((_, i) => i !== idx))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => setMappings((prev) => [...prev, { packageId: '', command: '', planId: '' }])}>
            <Plus size={12} /> Add mapping
          </button>
          <p className="text-[11px] text-zinc-600 mt-2">
            <code>{'{username}'}</code> in a command is replaced with the buyer's in-game name. Picking a plan upgrades the server's resources (RAM/CPU/disk) live on purchase — command and plan can be combined, or either left empty.
            {provider === 'stripe' && ' The price creates a real Stripe Product/Price on save and can\'t be edited afterward — remove and re-add the mapping to change it.'}
            {provider === 'paytr' && ' The price is charged in Turkish Lira and can\'t be edited afterward — remove and re-add the mapping to change it.'}
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>
            {loading ? <Spinner size="sm" /> : existing ? 'Save Changes' : 'Create Integration'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// Reusable resource templates (e.g. "2GB", "Elite") that a store purchase
// can apply to a server — defined once here, then picked from the package
// mapping dropdown above.
function PlansSection({ plans, onChanged }: { plans: PlanRow[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editPlan, setEditPlan] = useState<PlanRow | null>(null);
  const [deletePlan, setDeletePlan] = useState<PlanRow | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/plans/${id}`),
    onSuccess: () => { toast.success('Plan deleted'); onChanged(); setDeletePlan(null); },
    onError: () => toast.error('Failed to delete plan'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Resource Plans</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Templates a store purchase can apply — RAM/CPU/disk upgrade on the mapped server, live, no restart needed.</p>
        </div>
        <button className="btn-secondary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="card p-8 text-center">
          <Gauge size={36} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm">No plans yet — create one to map a store package to a resource upgrade.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Memory</th>
                  <th>Disk</th>
                  <th>CPU</th>
                  <th>Databases</th>
                  <th>Backups</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-zinc-200">{p.name}</td>
                    <td className="text-xs text-zinc-500">{p.memory} MB</td>
                    <td className="text-xs text-zinc-500">{p.disk} MB</td>
                    <td className="text-xs text-zinc-500">{p.cpu > 0 ? `${p.cpu}%` : 'Unlimited'}</td>
                    <td className="text-xs text-zinc-500">{p.databaseLimit}</td>
                    <td className="text-xs text-zinc-500">{p.backupLimit}</td>
                    <td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button className="btn-secondary btn-sm" onClick={() => setEditPlan(p)} title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => setDeletePlan(p)} title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(showCreate || editPlan) && (
        <PlanModal
          existing={editPlan}
          onClose={() => { setShowCreate(false); setEditPlan(null); }}
          onSaved={() => { setShowCreate(false); setEditPlan(null); onChanged(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletePlan}
        onClose={() => setDeletePlan(null)}
        onConfirm={() => deletePlan && deleteMutation.mutate(deletePlan.id)}
        title="Delete Plan"
        message={`Delete "${deletePlan?.name}"? Package mappings using it will stop applying it on purchase.`}
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function PlanModal({ existing, onClose, onSaved }: {
  existing: PlanRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [memory, setMemory] = useState(String(existing?.memory ?? 2048));
  const [swap, setSwap] = useState(String(existing?.swap ?? 0));
  const [disk, setDisk] = useState(String(existing?.disk ?? 5120));
  const [cpu, setCpu] = useState(String(existing?.cpu ?? 0));
  const [io, setIo] = useState(String(existing?.io ?? 500));
  const [databaseLimit, setDatabaseLimit] = useState(String(existing?.databaseLimit ?? 0));
  const [allocationLimit, setAllocationLimit] = useState(String(existing?.allocationLimit ?? 0));
  const [backupLimit, setBackupLimit] = useState(String(existing?.backupLimit ?? 0));
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const payload = {
      name: name.trim(),
      memory: parseInt(memory, 10), swap: parseInt(swap, 10) || 0, disk: parseInt(disk, 10),
      cpu: parseInt(cpu, 10) || 0, io: parseInt(io, 10) || 500,
      databaseLimit: parseInt(databaseLimit, 10) || 0, allocationLimit: parseInt(allocationLimit, 10) || 0,
      backupLimit: parseInt(backupLimit, 10) || 0,
    };
    setLoading(true);
    try {
      if (existing) await api.put(`/plans/${existing.id}`, payload);
      else await api.post('/plans', payload);
      onSaved();
      toast.success(existing ? 'Plan updated' : 'Plan created');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to save plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Edit Plan' : 'New Plan'} size="md">
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="e.g. 4GB Elite" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Memory (MB)</label>
            <input className="input" type="number" min={1} value={memory} onChange={(e) => setMemory(e.target.value)} />
          </div>
          <div>
            <label className="label">Disk (MB)</label>
            <input className="input" type="number" min={1} value={disk} onChange={(e) => setDisk(e.target.value)} />
          </div>
          <div>
            <label className="label">Swap (MB)</label>
            <input className="input" type="number" value={swap} onChange={(e) => setSwap(e.target.value)} />
          </div>
          <div>
            <label className="label">CPU % (0 = unlimited)</label>
            <input className="input" type="number" min={0} value={cpu} onChange={(e) => setCpu(e.target.value)} />
          </div>
          <div>
            <label className="label">Block I/O weight</label>
            <input className="input" type="number" value={io} onChange={(e) => setIo(e.target.value)} />
          </div>
          <div>
            <label className="label">Databases</label>
            <input className="input" type="number" min={0} value={databaseLimit} onChange={(e) => setDatabaseLimit(e.target.value)} />
          </div>
          <div>
            <label className="label">Allocations</label>
            <input className="input" type="number" min={0} value={allocationLimit} onChange={(e) => setAllocationLimit(e.target.value)} />
          </div>
          <div>
            <label className="label">Backups</label>
            <input className="input" type="number" min={0} value={backupLimit} onChange={(e) => setBackupLimit(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>
            {loading ? <Spinner size="sm" /> : existing ? 'Save Changes' : 'Create Plan'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
