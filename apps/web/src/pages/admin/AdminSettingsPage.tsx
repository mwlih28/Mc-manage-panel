import { useState, useEffect } from 'react';
import { Save, Globe, Image, Type, FileText } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQueryClient } from '@tanstack/react-query';

export function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    'app.name': '',
    'app.title': '',
    'app.logo': '',
    'app.description': '',
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setForm({
        'app.name':        data['app.name']        || '',
        'app.title':       data['app.title']        || '',
        'app.logo':        data['app.logo']         || '',
        'app.description': data['app.description']  || '',
      });
    }).finally(() => setLoading(false));
  }, []);

  // Update browser tab title dynamically
  useEffect(() => {
    if (form['app.title']) document.title = form['app.title'];
  }, [form]);

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
              placeholder="MC Manage Panel"
            />
            <p className="text-xs text-zinc-600 mt-1">Shown in the sidebar and login page.</p>
          </div>

          <div>
            <label className="label flex items-center gap-1.5"><FileText size={12} />Browser Tab Title</label>
            <input
              className="input"
              value={form['app.title']}
              onChange={e => setForm(f => ({ ...f, 'app.title': e.target.value }))}
              placeholder="MC Manage Panel"
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

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <><Spinner size="sm" />Saving...</> : <><Save size={14} />Save Changes</>}
        </button>
      </div>
    </div>
  );
}
