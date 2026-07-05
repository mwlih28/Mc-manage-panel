import { useState, useEffect } from 'react';
import { Save, Globe, Image, Type, FileText, Mail, Send, Eye, EyeOff, Zap, Sparkles, Mountain, Paintbrush, UploadCloud, PlugZap, Bot } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQueryClient } from '@tanstack/react-query';

// Resend's official icon mark, used with their written permission (not an
// official or approved integration — see their reply: "you can use these as
// long as it's not presented as an official or approved integration").
// Asset from resend.com/brand, served from apps/web/public/brand/.
function ResendMark({ className }: { className?: string }) {
  return <img src="/brand/resend-icon-white.svg" alt="Resend" className={className} />;
}

type AiProvider = 'openai' | 'gemini' | 'anthropic';

const AI_PROVIDERS: { id: AiProvider; label: string; logo: string; supportsImages: boolean }[] = [
  { id: 'openai', label: 'OpenAI', logo: '/brand/openai.svg', supportsImages: true },
  { id: 'gemini', label: 'Gemini', logo: '/brand/gemini.svg', supportsImages: true },
  { id: 'anthropic', label: 'Anthropic', logo: '/brand/anthropic.svg', supportsImages: false },
];

type StorageProvider = 'none' | 's3' | 'sftp' | 'gdrive';

const STORAGE_PROVIDERS: { id: StorageProvider; label: string }[] = [
  { id: 'none', label: 'None (local only)' },
  { id: 's3', label: 'S3-Compatible' },
  { id: 'sftp', label: 'SFTP' },
  { id: 'gdrive', label: 'Google Drive' },
];

// A Discord bot token is `<base64url(bot user id)>.<random>.<random>` — the
// bot's user id doubles as its application id for the OAuth invite link, so
// this avoids making the admin go dig it up separately.
function extractDiscordBotId(token: string): string | null {
  const first = token.split('.')[0];
  if (!first) return null;
  try {
    const id = atob(first.replace(/-/g, '+').replace(/_/g, '/'));
    return /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testingStorage, setTestingStorage] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [form, setForm] = useState({
    'app.name': '',
    'app.title': '',
    'app.logo': '',
    'app.description': '',
    'smtp.host': '',
    'smtp.port': '587',
    'smtp.user': '',
    'smtp.pass': '',
    'smtp.from': '',
    'features.aiTools': 'true',
    'ai.provider': 'openai',
    'ai.openaiKey': '',
    'ai.geminiKey': '',
    'ai.anthropicKey': '',
    'curseforge.apiKey': '',
    'theme.customCss': '',
    'whitelabel.hidePoweredBy': 'false',
    'storage.provider': 'none' as StorageProvider,
    'storage.deleteLocalAfterUpload': 'false',
    'storage.s3.endpoint': '',
    'storage.s3.region': '',
    'storage.s3.bucket': '',
    'storage.s3.accessKeyId': '',
    'storage.s3.secretAccessKey': '',
    'storage.s3.forcePathStyle': 'false',
    'storage.s3.prefix': '',
    'storage.sftp.host': '',
    'storage.sftp.port': '22',
    'storage.sftp.username': '',
    'storage.sftp.password': '',
    'storage.sftp.privateKey': '',
    'storage.sftp.basePath': '',
    'storage.gdrive.serviceAccountJson': '',
    'storage.gdrive.folderId': '',
    'discord.botToken': '',
    'discord.oauth.enabled': 'false',
    'discord.oauth.clientId': '',
    'discord.oauth.clientSecret': '',
  });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setForm({
        'app.name':         data['app.name']         || '',
        'app.title':        data['app.title']         || '',
        'app.logo':         data['app.logo']          || '',
        'app.description':  data['app.description']   || '',
        'smtp.host':        data['smtp.host']         || '',
        'smtp.port':        data['smtp.port']         || '587',
        'smtp.user':        data['smtp.user']         || '',
        'smtp.pass':        data['smtp.pass']         || '',
        'smtp.from':        data['smtp.from']         || '',
        'features.aiTools': data['features.aiTools']  || 'true',
        'ai.provider':      data['ai.provider']        || 'openai',
        'ai.openaiKey':     data['ai.openaiKey']       || '',
        'ai.geminiKey':     data['ai.geminiKey']       || '',
        'ai.anthropicKey':  data['ai.anthropicKey']    || '',
        'curseforge.apiKey': data['curseforge.apiKey'] || '',
        'theme.customCss': data['theme.customCss'] || '',
        'whitelabel.hidePoweredBy': data['whitelabel.hidePoweredBy'] || 'false',
        'storage.provider': (data['storage.provider'] || 'none') as StorageProvider,
        'storage.deleteLocalAfterUpload': data['storage.deleteLocalAfterUpload'] || 'false',
        'storage.s3.endpoint': data['storage.s3.endpoint'] || '',
        'storage.s3.region': data['storage.s3.region'] || '',
        'storage.s3.bucket': data['storage.s3.bucket'] || '',
        'storage.s3.accessKeyId': data['storage.s3.accessKeyId'] || '',
        'storage.s3.secretAccessKey': data['storage.s3.secretAccessKey'] || '',
        'storage.s3.forcePathStyle': data['storage.s3.forcePathStyle'] || 'false',
        'storage.s3.prefix': data['storage.s3.prefix'] || '',
        'storage.sftp.host': data['storage.sftp.host'] || '',
        'storage.sftp.port': data['storage.sftp.port'] || '22',
        'storage.sftp.username': data['storage.sftp.username'] || '',
        'storage.sftp.password': data['storage.sftp.password'] || '',
        'storage.sftp.privateKey': data['storage.sftp.privateKey'] || '',
        'storage.sftp.basePath': data['storage.sftp.basePath'] || '',
        'storage.gdrive.serviceAccountJson': data['storage.gdrive.serviceAccountJson'] || '',
        'storage.gdrive.folderId': data['storage.gdrive.folderId'] || '',
        'discord.botToken': data['discord.botToken'] || '',
        'discord.oauth.enabled': data['discord.oauth.enabled'] || 'false',
        'discord.oauth.clientId': data['discord.oauth.clientId'] || '',
        'discord.oauth.clientSecret': data['discord.oauth.clientSecret'] || '',
      });
    }).finally(() => setLoading(false));
  }, []);

  // Update browser tab title dynamically
  useEffect(() => {
    if (form['app.title']) document.title = form['app.title'];
  }, [form]);

  const testSmtp = async () => {
    setTestingSmtp(true);
    try {
      await api.post('/installer/test-smtp');
      toast.success('SMTP test email sent — check your inbox');
    } catch {
      toast.error('SMTP test failed — check your settings');
    } finally {
      setTestingSmtp(false);
    }
  };

  const testStorage = async () => {
    setTestingStorage(true);
    try {
      await api.post('/storage/test');
      toast.success('Connection succeeded');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Connection failed');
    } finally {
      setTestingStorage(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', form);
      // Update tab title immediately
      if (form['app.title']) document.title = form['app.title'];
      // Invalidate cached settings so sidebar/login refresh
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-white">Site Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Customize your panel's branding and appearance.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Globe size={14} />Branding</h2>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="label flex items-center gap-1.5"><Type size={12} />Site Name</label>
            <input
              className="input"
              value={form['app.name']}
              onChange={e => setForm(f => ({ ...f, 'app.name': e.target.value }))}
              placeholder="Kretase"
            />
            <p className="text-xs text-zinc-600 mt-1">Shown in the sidebar and login page.</p>
          </div>

          <div>
            <label className="label flex items-center gap-1.5"><FileText size={12} />Browser Tab Title</label>
            <input
              className="input"
              value={form['app.title']}
              onChange={e => setForm(f => ({ ...f, 'app.title': e.target.value }))}
              placeholder="Kretase"
            />
            <p className="text-xs text-zinc-600 mt-1">The text shown in the browser tab.</p>
          </div>

          <div>
            <label className="label flex items-center gap-1.5"><FileText size={12} />Tagline / Description</label>
            <input
              className="input"
              value={form['app.description']}
              onChange={e => setForm(f => ({ ...f, 'app.description': e.target.value }))}
              placeholder="Game server management"
            />
          </div>

          <div>
            <label className="label flex items-center gap-1.5"><Image size={12} />Logo URL</label>
            <div className="flex gap-3 items-start">
              <input
                className="input"
                value={form['app.logo']}
                onChange={e => setForm(f => ({ ...f, 'app.logo': e.target.value }))}
                placeholder="https://example.com/logo.png"
              />
              {form['app.logo'] && (
                <img
                  src={form['app.logo']}
                  alt="preview"
                  className="h-10 w-10 rounded-lg object-contain bg-zinc-900 border border-zinc-800 shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
            <p className="text-xs text-zinc-600 mt-1">URL of your logo image. Shown in the sidebar and login page.</p>
          </div>
        </div>
      </div>

      {/* Theme / White-label */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Paintbrush size={14} />Theme</h2>
          <p className="text-xs text-zinc-500 mt-0.5">White-label the panel's look — applies to the whole app, including the login page.</p>
        </div>
        <div className="p-6 space-y-5">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-zinc-200">Hide "Powered by Kretase"</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Removes the attribution line from public server status pages.
              </p>
            </div>
            <input
              type="checkbox"
              checked={form['whitelabel.hidePoweredBy'] === 'true'}
              onChange={e => setForm(f => ({ ...f, 'whitelabel.hidePoweredBy': e.target.checked ? 'true' : 'false' }))}
              className="shrink-0 w-9 h-5 accent-panel-500"
            />
          </label>

          <div>
            <label className="label">Custom CSS</label>
            <textarea
              className="input font-mono text-xs min-h-[160px] resize-y"
              value={form['theme.customCss']}
              onChange={e => setForm(f => ({ ...f, 'theme.customCss': e.target.value }))}
              placeholder={'.btn-primary {\n  background: #ff6b00;\n}'}
              spellCheck={false}
            />
            <p className="text-xs text-zinc-600 mt-1">
              Injected as a raw {'<style>'} tag across the whole panel and login page. Use it to override colors, fonts,
              or any other visual detail to match your brand. Up to 20,000 characters.
            </p>
          </div>
        </div>
      </div>

      {/* AI Tools */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Sparkles size={14} />AI Tools</h2>
          <p className="text-xs text-zinc-500 mt-0.5">MOTD Generator and Logo Generator, available to all panel users.</p>
        </div>
        <div className="p-6 space-y-5">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-zinc-200">Enable AI Tools</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Turn off to hide the MOTD and Logo generators from the sidebar for everyone — useful if you want to offer them as a paid add-on.
              </p>
            </div>
            <input
              type="checkbox"
              checked={form['features.aiTools'] === 'true'}
              onChange={e => setForm(f => ({ ...f, 'features.aiTools': e.target.checked ? 'true' : 'false' }))}
              className="shrink-0 w-9 h-5 accent-panel-500"
            />
          </label>

          <div>
            <label className="label">AI Provider</label>
            <div className="grid grid-cols-3 gap-3">
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, 'ai.provider': p.id }))}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                    form['ai.provider'] === p.id
                      ? 'border-panel-500 bg-panel-500/10'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <span className="h-7 w-7 rounded-md bg-zinc-950 flex items-center justify-center">
                    <img src={p.logo} alt={p.label} className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-medium text-zinc-200">{p.label}</span>
                  {!p.supportsImages && <span className="text-[10px] text-zinc-600">Text only</span>}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              Without a matching key below, MOTD/Logo generation uses a free built-in algorithm. With a key,
              users also get a "Generate with AI" option that calls the selected provider directly — billed to
              your own account.
            </p>
          </div>

          {AI_PROVIDERS.map((p) => {
            const settingKey = `ai.${p.id}Key` as 'ai.openaiKey' | 'ai.geminiKey' | 'ai.anthropicKey';
            return (
              <div key={p.id}>
                <label className="label">{p.label} API Key</label>
                <div className="relative">
                  <input
                    type={showKey[p.id] ? 'text' : 'password'}
                    className="input pr-10"
                    value={form[settingKey]}
                    onChange={e => setForm(f => ({ ...f, [settingKey]: e.target.value }))}
                    placeholder={p.id === 'openai' ? 'sk-...' : p.id === 'anthropic' ? 'sk-ant-...' : 'AIza...'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(s => ({ ...s, [p.id]: !s[p.id] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {showKey[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* World Manager / CurseForge */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Mountain size={14} />World Manager</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Lets users browse and install premade worlds (castles, mansions, and more) from CurseForge.</p>
        </div>
        <div className="p-6 space-y-3">
          <label className="label">CurseForge API Key</label>
          <div className="relative">
            <input
              type={showKey['curseforge'] ? 'text' : 'password'}
              className="input pr-10"
              value={form['curseforge.apiKey']}
              onChange={e => setForm(f => ({ ...f, 'curseforge.apiKey': e.target.value }))}
              placeholder="$2a$10$..."
            />
            <button
              type="button"
              onClick={() => setShowKey(s => ({ ...s, curseforge: !s.curseforge }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              {showKey['curseforge'] ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-zinc-600">
            Get a free key at{' '}
            <a href="https://console.curseforge.com/?#/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              console.curseforge.com
            </a>
            . Without a key, users can still switch, back up, and delete their existing worlds, but the premade world browser stays hidden.
          </p>
        </div>
      </div>

      {/* Cloud Backups */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><UploadCloud size={14} />Cloud Backups</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Upload new backups to an off-site destination in addition to the local copy on each node.</p>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="label">Destination</label>
            <div className="grid grid-cols-4 gap-3">
              {STORAGE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, 'storage.provider': p.id }))}
                  className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border text-center transition-colors ${
                    form['storage.provider'] === p.id
                      ? 'border-panel-500 bg-panel-500/10'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-xs font-medium text-zinc-200">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-2">
              S3-Compatible covers AWS S3, Backblaze B2, Cloudflare R2, Wasabi, DigitalOcean Spaces, and MinIO — they all speak the same API.
            </p>
          </div>

          {form['storage.provider'] === 's3' && (
            <div className="space-y-4 rounded-lg border border-zinc-800 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Endpoint (blank for AWS)</label>
                  <input
                    className="input font-mono text-sm"
                    value={form['storage.s3.endpoint']}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.endpoint': e.target.value }))}
                    placeholder="https://s3.us-west-002.backblazeb2.com"
                  />
                </div>
                <div>
                  <label className="label">Region</label>
                  <input
                    className="input"
                    value={form['storage.s3.region']}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.region': e.target.value }))}
                    placeholder="us-east-1"
                  />
                </div>
                <div>
                  <label className="label">Bucket</label>
                  <input
                    className="input"
                    value={form['storage.s3.bucket']}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.bucket': e.target.value }))}
                    placeholder="kretase-backups"
                  />
                </div>
              </div>
              <div>
                <label className="label">Access Key ID</label>
                <input
                  className="input font-mono text-sm"
                  value={form['storage.s3.accessKeyId']}
                  onChange={e => setForm(f => ({ ...f, 'storage.s3.accessKeyId': e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Secret Access Key</label>
                <div className="relative">
                  <input
                    type={showKey['s3secret'] ? 'text' : 'password'}
                    className="input font-mono text-sm pr-10"
                    value={form['storage.s3.secretAccessKey']}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.secretAccessKey': e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(s => ({ ...s, s3secret: !s.s3secret }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {showKey['s3secret'] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Key Prefix (optional)</label>
                  <input
                    className="input font-mono text-sm"
                    value={form['storage.s3.prefix']}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.prefix': e.target.value }))}
                    placeholder="backups/"
                  />
                </div>
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form['storage.s3.forcePathStyle'] === 'true'}
                    onChange={e => setForm(f => ({ ...f, 'storage.s3.forcePathStyle': e.target.checked ? 'true' : 'false' }))}
                    className="accent-panel-500"
                  />
                  <span className="text-xs text-zinc-400">Force path-style (needed for MinIO)</span>
                </label>
              </div>
            </div>
          )}

          {form['storage.provider'] === 'sftp' && (
            <div className="space-y-4 rounded-lg border border-zinc-800 p-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="label">Host</label>
                  <input
                    className="input"
                    value={form['storage.sftp.host']}
                    onChange={e => setForm(f => ({ ...f, 'storage.sftp.host': e.target.value }))}
                    placeholder="backups.example.com"
                  />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input
                    className="input"
                    value={form['storage.sftp.port']}
                    onChange={e => setForm(f => ({ ...f, 'storage.sftp.port': e.target.value }))}
                    placeholder="22"
                  />
                </div>
              </div>
              <div>
                <label className="label">Username</label>
                <input
                  className="input"
                  value={form['storage.sftp.username']}
                  onChange={e => setForm(f => ({ ...f, 'storage.sftp.username': e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showKey['sftppass'] ? 'text' : 'password'}
                    className="input pr-10"
                    value={form['storage.sftp.password']}
                    onChange={e => setForm(f => ({ ...f, 'storage.sftp.password': e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(s => ({ ...s, sftppass: !s.sftppass }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {showKey['sftppass'] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-xs text-zinc-600 mt-1">Or provide a private key below instead.</p>
              </div>
              <div>
                <label className="label">Private Key (optional)</label>
                <textarea
                  className="input font-mono text-xs min-h-[100px] resize-y"
                  value={form['storage.sftp.privateKey']}
                  onChange={e => setForm(f => ({ ...f, 'storage.sftp.privateKey': e.target.value }))}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="label">Base Path (optional)</label>
                <input
                  className="input font-mono text-sm"
                  value={form['storage.sftp.basePath']}
                  onChange={e => setForm(f => ({ ...f, 'storage.sftp.basePath': e.target.value }))}
                  placeholder="/home/backups/kretase"
                />
              </div>
            </div>
          )}

          {form['storage.provider'] === 'gdrive' && (
            <div className="space-y-4 rounded-lg border border-zinc-800 p-4">
              <div>
                <label className="label">Service Account JSON</label>
                <textarea
                  className="input font-mono text-xs min-h-[140px] resize-y"
                  value={form['storage.gdrive.serviceAccountJson']}
                  onChange={e => setForm(f => ({ ...f, 'storage.gdrive.serviceAccountJson': e.target.value }))}
                  placeholder='{"type": "service_account", "client_email": "...", "private_key": "..."}'
                  spellCheck={false}
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Create a service account in{' '}
                  <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    Google Cloud Console
                  </a>
                  , download its JSON key, then share your Drive folder with the service account's email address.
                </p>
              </div>
              <div>
                <label className="label">Drive Folder ID</label>
                <input
                  className="input font-mono text-sm"
                  value={form['storage.gdrive.folderId']}
                  onChange={e => setForm(f => ({ ...f, 'storage.gdrive.folderId': e.target.value }))}
                  placeholder="1a2B3cD4eFgHiJkLmNoPqRsTuVwXyZ"
                />
                <p className="text-xs text-zinc-600 mt-1">The id from the folder's share URL.</p>
              </div>
            </div>
          )}

          {form['storage.provider'] !== 'none' && (
            <>
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Delete local copy after successful upload</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Off by default — keeps both the local and cloud copy. Only deletes the node-local file once the cloud upload has confirmed success.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={form['storage.deleteLocalAfterUpload'] === 'true'}
                  onChange={e => setForm(f => ({ ...f, 'storage.deleteLocalAfterUpload': e.target.checked ? 'true' : 'false' }))}
                  className="shrink-0 w-9 h-5 accent-panel-500"
                />
              </label>
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-zinc-600">Save your changes first, then test the connection.</p>
                <button type="button" className="btn-secondary text-xs py-1.5 px-3 shrink-0" onClick={testStorage} disabled={testingStorage}>
                  {testingStorage ? <><Spinner size="sm" />Testing...</> : <><PlugZap size={13} />Test Connection</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Discord Bot */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Bot size={14} />Discord Bot</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Lets server owners run /start, /stop, /restart, and /status from a Discord channel.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="label">Bot Token</label>
            <div className="relative">
              <input
                type={showKey['discordToken'] ? 'text' : 'password'}
                className="input font-mono text-sm pr-10"
                value={form['discord.botToken']}
                onChange={e => setForm(f => ({ ...f, 'discord.botToken': e.target.value }))}
                placeholder="MTA1Nz...GaBcD.eXaMpLe.tOkEn"
              />
              <button
                type="button"
                onClick={() => setShowKey(s => ({ ...s, discordToken: !s.discordToken }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                {showKey['discordToken'] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Create an application and bot at{' '}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                discord.com/developers/applications
              </a>
              , then copy its token here.
            </p>
          </div>

          {form['discord.botToken'] && extractDiscordBotId(form['discord.botToken']) && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="text-sm font-medium text-blue-300">Invite the bot to your server</p>
              <p className="text-xs text-zinc-500 mt-1">
                Save your changes first, then use this link to add the bot to a Discord server with the permissions it needs.
              </p>
              <a
                // 3072 = View Channel (1024) + Send Messages (2048) — the
                // only permissions the bot actually needs; slash commands
                // themselves come from the applications.commands scope, not
                // a permission bit.
                href={`https://discord.com/oauth2/authorize?client_id=${extractDiscordBotId(form['discord.botToken'])}&scope=bot%20applications.commands&permissions=3072`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 btn-secondary text-xs py-1.5 px-3"
              >
                Get Invite Link
              </a>
            </div>
          )}

          <div className="text-xs text-zinc-600 space-y-1">
            <p>Once invited, a server owner (or admin) generates a bind code from a server's Settings tab in Kretase, then runs:</p>
            <code className="block bg-zinc-950 rounded px-2 py-1 text-zinc-400">/bind &lt;code&gt;</code>
            <p>in the Discord channel that should control that server. <code className="text-zinc-400">/unbind</code> removes the link.</p>
          </div>
        </div>
      </div>

      {/* Discord Login (SSO) */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Bot size={14} />Discord Login (SSO)</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Lets users sign in with Discord instead of (or alongside) email/password. Separate from the bot above — this is a different application entry.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-zinc-200">Enable Discord login</p>
              <p className="text-xs text-zinc-500 mt-0.5">Shows a "Continue with Discord" button on the login page.</p>
            </div>
            <input
              type="checkbox"
              checked={form['discord.oauth.enabled'] === 'true'}
              onChange={e => setForm(f => ({ ...f, 'discord.oauth.enabled': e.target.checked ? 'true' : 'false' }))}
              className="shrink-0 w-9 h-5 accent-panel-500"
            />
          </label>

          <div>
            <label className="label">Client ID</label>
            <input
              className="input font-mono text-sm"
              value={form['discord.oauth.clientId']}
              onChange={e => setForm(f => ({ ...f, 'discord.oauth.clientId': e.target.value }))}
              placeholder="1234567890123456789"
            />
          </div>

          <div>
            <label className="label">Client Secret</label>
            <div className="relative">
              <input
                type={showKey['discordOauthSecret'] ? 'text' : 'password'}
                className="input font-mono text-sm pr-10"
                value={form['discord.oauth.clientSecret']}
                onChange={e => setForm(f => ({ ...f, 'discord.oauth.clientSecret': e.target.value }))}
                placeholder="••••••••••••••••••••••••"
              />
              <button
                type="button"
                onClick={() => setShowKey(s => ({ ...s, discordOauthSecret: !s.discordOauthSecret }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                {showKey['discordOauthSecret'] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 p-4 space-y-1.5">
            <p className="text-xs font-medium text-zinc-300">Setup</p>
            <p className="text-xs text-zinc-500">
              Create an application at{' '}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                discord.com/developers/applications
              </a>
              , open OAuth2 → General, copy the Client ID and Client Secret above, and add this exact Redirect URI there:
            </p>
            <code className="block bg-zinc-950 rounded px-2 py-1 text-zinc-400 text-xs mt-2 break-all">
              {`${window.location.origin}/api/v1/auth/discord/callback`}
            </code>
          </div>
        </div>
      </div>

      {/* SMTP Settings */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Mail size={14} />Email / SMTP</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Used for password reset emails and other panel notifications.</p>
        </div>
        <div className="p-6 space-y-5">
          {/* Resend quick-setup */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-300 flex items-center gap-2">
                  <ResendMark className="h-4 w-4 shrink-0" />
                  Quick Setup with Resend
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Free up to 3,000 emails/month. Get your API key at{' '}
                  <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">resend.com</a>
                  , then paste it below and click this button.
                </p>
                <p className="text-[10px] text-zinc-600 mt-1.5">Not an official Resend integration.</p>
              </div>
              <button
                type="button"
                className="shrink-0 btn-secondary text-xs py-1.5 px-3"
                onClick={() => setForm(f => ({
                  ...f,
                  'smtp.host': 'smtp.resend.com',
                  'smtp.port': '465',
                  'smtp.user': 'resend',
                }))}
              >
                Fill Resend SMTP
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="label">SMTP Host</label>
              <input
                className="input"
                value={form['smtp.host']}
                onChange={e => setForm(f => ({ ...f, 'smtp.host': e.target.value }))}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="label">Port</label>
              <input
                className="input"
                value={form['smtp.port']}
                onChange={e => setForm(f => ({ ...f, 'smtp.port': e.target.value }))}
                placeholder="587"
              />
            </div>
          </div>
          <div>
            <label className="label">SMTP Username</label>
            <input
              className="input"
              value={form['smtp.user']}
              onChange={e => setForm(f => ({ ...f, 'smtp.user': e.target.value }))}
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="label">SMTP Password / App Password / Resend API Key</label>
            <div className="relative">
              <input
                type={showSmtpPass ? 'text' : 'password'}
                className="input pr-10"
                value={form['smtp.pass']}
                onChange={e => setForm(f => ({ ...f, 'smtp.pass': e.target.value }))}
                placeholder="••••••••••••"
              />
              <button
                type="button"
                onClick={() => setShowSmtpPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                {showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">From Address</label>
            <input
              className="input"
              value={form['smtp.from']}
              onChange={e => setForm(f => ({ ...f, 'smtp.from': e.target.value }))}
              placeholder="Kretase <noreply@kretase.com>"
            />
            <p className="text-xs text-zinc-600 mt-1">Shown in the "From" field of outgoing emails.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button className="btn-secondary" onClick={testSmtp} disabled={testingSmtp || !form['smtp.host']}>
          {testingSmtp ? <><Spinner size="sm" />Testing...</> : <><Send size={13} />Send Test Email</>}
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <><Spinner size="sm" />Saving...</> : <><Save size={14} />Save Changes</>}
        </button>
      </div>
    </div>
  );
}
