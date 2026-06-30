import { useState, useEffect } from 'react';
import { Save, Globe, Image, Type, FileText, Mail, Send, Eye, EyeOff, Zap, Sparkles } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQueryClient } from '@tanstack/react-query';

export function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
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
    'smtp.owner_email': '',
    'features.aiTools': 'true',
  });
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
        'smtp.owner_email': data['smtp.owner_email']  || '',
        'features.aiTools': data['features.aiTools']  || 'true',
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

      {/* AI Tools */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Sparkles size={14} />AI Tools</h2>
          <p className="text-xs text-zinc-500 mt-0.5">MOTD Generator and Logo Generator, available to all panel users.</p>
        </div>
        <div className="p-6">
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
        </div>
      </div>

      {/* SMTP Settings */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Mail size={14} />Email / SMTP</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Used to send thank-you and update notification emails to panel installers.</p>
        </div>
        <div className="p-6 space-y-5">
          {/* Resend quick-setup */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-300 flex items-center gap-1.5"><Zap size={13} />Quick Setup with Resend</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Free up to 3,000 emails/month. Get your API key at{' '}
                  <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">resend.com</a>
                  , then paste it below and click this button.
                </p>
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
          <div>
            <label className="label">Your Notification Email</label>
            <input
              className="input"
              value={form['smtp.owner_email']}
              onChange={e => setForm(f => ({ ...f, 'smtp.owner_email': e.target.value }))}
              placeholder="you@yourdomain.com"
            />
            <p className="text-xs text-zinc-600 mt-1">You'll get a notification here whenever someone installs the panel.</p>
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
