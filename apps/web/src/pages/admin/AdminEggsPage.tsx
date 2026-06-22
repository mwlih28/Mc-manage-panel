import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Pencil, Trash2, Zap } from 'lucide-react';
import api from '@/lib/axios';
import { Egg } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

const MINECRAFT_PAPER_TEMPLATE = {
  nestName: 'Minecraft',
  name: 'Paper',
  description: 'High performance Minecraft server with plugin support.',
  dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
  startup: 'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}} --nogui',
  configStop: 'stop',
  scriptInstall: `#!/bin/bash
set -e
cd /mnt/server

PAPER_VERSION=\${MC_VERSION:-latest}
if [ "\$PAPER_VERSION" = "latest" ]; then
  PAPER_VERSION=$(curl -s "https://api.papermc.io/v2/projects/paper" | grep -oE '"[0-9]+\\.[0-9]+(\\.[0-9]+)?"' | tr -d '"' | tail -1)
fi
echo "Paper version: \${PAPER_VERSION}"

BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/\${PAPER_VERSION}/builds" | grep -oE '"build":[0-9]+' | tail -1 | grep -oE '[0-9]+$')
echo "Build: \${BUILD}"

JAR="paper-\${PAPER_VERSION}-\${BUILD}.jar"
TARGET=\${SERVER_JARFILE:-server.jar}
curl -fsSL -o "\${TARGET}" "https://api.papermc.io/v2/projects/paper/versions/\${PAPER_VERSION}/builds/\${BUILD}/downloads/\${JAR}"
echo "Downloaded: \${TARGET}"`,
  variables: [
    { name: 'Server Jar File', envVariable: 'SERVER_JARFILE', defaultValue: 'server.jar', description: 'The jar file to run', userViewable: true, userEditable: false },
    { name: 'Minecraft Version', envVariable: 'MC_VERSION', defaultValue: 'latest', description: 'Paper version to install', userViewable: true, userEditable: true },
  ],
};

export function AdminEggsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editEgg, setEditEgg] = useState<Egg | null>(null);
  const [deleteEgg, setDeleteEgg] = useState<Egg | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-eggs'],
    queryFn: () => api.get('/eggs').then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/eggs/${id}`),
    onSuccess: () => {
      toast.success('Egg deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-eggs'] });
      setDeleteEgg(null);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to delete egg');
    },
  });

  const eggs: Egg[] = data || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Eggs</h1>
          <p className="text-slate-400 text-sm mt-1">Server configuration templates</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Egg
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : eggs.length === 0 ? (
        <div className="card p-12 text-center">
          <Package size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">No eggs configured</p>
          <p className="text-slate-500 text-sm mt-2">Add a Minecraft Paper egg to get started</p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create First Egg
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {eggs.map((egg) => (
            <div key={egg.id} className="card p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2.5 rounded-lg bg-brand-500/20">
                  <Package size={18} className="text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-100">{egg.name}</p>
                  <p className="text-xs text-slate-500">{egg.nest?.name}</p>
                </div>
                {egg._count && (
                  <span className="badge badge-blue">{egg._count.servers} servers</span>
                )}
              </div>

              {egg.description && (
                <p className="text-xs text-slate-400 mb-3">{egg.description}</p>
              )}

              <div className="space-y-1 mb-3">
                <p className="text-xs text-slate-500 font-medium">Docker Image</p>
                <p className="text-xs font-mono text-slate-400 bg-dark-950/60 px-2 py-1 rounded break-all">
                  {egg.dockerImage}
                </p>
              </div>

              {egg.variables && egg.variables.length > 0 && (
                <div className="pt-2 border-t border-dark-800 mb-3">
                  <p className="text-xs text-slate-500 mb-2">{egg.variables.length} variables</p>
                  <div className="flex flex-wrap gap-1">
                    {egg.variables.slice(0, 3).map((v) => (
                      <span key={v.id} className="text-[10px] font-mono bg-dark-950/60 px-1.5 py-0.5 rounded text-slate-400">
                        {v.envVariable}
                      </span>
                    ))}
                    {egg.variables.length > 3 && (
                      <span className="text-[10px] text-slate-500">+{egg.variables.length - 3} more</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  className="btn-secondary btn-sm flex-1"
                  onClick={() => setEditEgg(egg)}
                >
                  <Pencil size={13} /> Edit
                </button>
                <button
                  className="btn-danger btn-sm flex-1"
                  onClick={() => setDeleteEgg(egg)}
                  disabled={(egg._count?.servers || 0) > 0}
                  title={(egg._count?.servers || 0) > 0 ? 'Cannot delete egg with active servers' : 'Delete egg'}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateEggModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['admin-eggs'] });
          }}
        />
      )}

      {editEgg && (
        <EditEggModal
          egg={editEgg}
          onClose={() => setEditEgg(null)}
          onSuccess={() => {
            setEditEgg(null);
            queryClient.invalidateQueries({ queryKey: ['admin-eggs'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteEgg}
        onClose={() => setDeleteEgg(null)}
        onConfirm={() => deleteEgg && deleteMutation.mutate(deleteEgg.id)}
        title="Delete Egg"
        message={`Delete egg "${deleteEgg?.name}"? This cannot be undone.`}
        confirmLabel="Delete Egg"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function CreateEggModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    nestName: '',
    name: '',
    description: '',
    dockerImage: '',
    startup: '',
    configStop: '^C',
    scriptInstall: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  const applyTemplate = () => {
    setForm({
      nestName: MINECRAFT_PAPER_TEMPLATE.nestName,
      name: MINECRAFT_PAPER_TEMPLATE.name,
      description: MINECRAFT_PAPER_TEMPLATE.description,
      dockerImage: MINECRAFT_PAPER_TEMPLATE.dockerImage,
      startup: MINECRAFT_PAPER_TEMPLATE.startup,
      configStop: MINECRAFT_PAPER_TEMPLATE.configStop,
      scriptInstall: MINECRAFT_PAPER_TEMPLATE.scriptInstall,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const isMinecraft = form.nestName === 'Minecraft' && form.name === 'Paper';
      await api.post('/eggs', {
        ...form,
        variables: isMinecraft ? MINECRAFT_PAPER_TEMPLATE.variables : [],
      });
      toast.success('Egg created');
      onSuccess();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to create egg');
    } finally {
      setIsLoading(false);
    }
  };

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal isOpen onClose={onClose} title="Create Egg" size="lg">
      <div className="mb-4">
        <button
          type="button"
          onClick={applyTemplate}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 transition-colors text-sm font-medium"
        >
          <Zap size={15} />
          Use Minecraft Paper Template
        </button>
      </div>

      <div className="relative flex items-center mb-4">
        <div className="flex-1 border-t border-slate-700/50" />
        <span className="mx-3 text-xs text-slate-500">or fill manually</span>
        <div className="flex-1 border-t border-slate-700/50" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nest (Category)</label>
            <input className="input" placeholder="Minecraft" value={form.nestName} onChange={f('nestName')} required />
          </div>
          <div>
            <label className="label">Egg Name</label>
            <input className="input" placeholder="Paper" value={form.name} onChange={f('name')} required />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" placeholder="Optional description" value={form.description} onChange={f('description')} />
        </div>
        <div>
          <label className="label">Docker Image</label>
          <input className="input font-mono" placeholder="ghcr.io/pterodactyl/yolks:java_17" value={form.dockerImage} onChange={f('dockerImage')} required />
        </div>
        <div>
          <label className="label">Startup Command</label>
          <input className="input font-mono text-sm" placeholder="java -jar {{SERVER_JARFILE}} --nogui" value={form.startup} onChange={f('startup')} required />
        </div>
        <div>
          <label className="label">Stop Command</label>
          <input className="input font-mono" placeholder="^C" value={form.configStop} onChange={f('configStop')} />
        </div>
        <div>
          <label className="label">Install Script <span className="text-slate-500 font-normal">(optional)</span></label>
          <textarea
            className="input font-mono text-xs min-h-[80px] resize-y"
            placeholder="#!/bin/bash&#10;# download server files..."
            value={form.scriptInstall}
            onChange={f('scriptInstall')}
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
            {isLoading ? <Spinner size="sm" /> : 'Create Egg'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditEggModal({ egg, onClose, onSuccess }: { egg: Egg; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: egg.name,
    description: egg.description || '',
    dockerImage: egg.dockerImage,
    startup: egg.startup,
    configStop: egg.configStop || '^C',
    scriptInstall: egg.scriptInstall || '',
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.put(`/eggs/${egg.id}`, form);
      toast.success('Egg updated');
      onSuccess();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to update egg');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFixedScript = () => {
    setForm(f => ({ ...f, scriptInstall: MINECRAFT_PAPER_TEMPLATE.scriptInstall }));
    toast.success('Applied fixed install script');
  };

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal isOpen onClose={onClose} title={`Edit Egg: ${egg.name}`} size="lg">
      {egg.scriptInstall?.includes('python3') && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm">
          <p className="font-medium mb-1">Install script uses python3</p>
          <p className="text-xs text-yellow-400 mb-2">The yolks:java_17 image doesn't have python3. Use the fixed bash-only version.</p>
          <button
            type="button"
            onClick={applyFixedScript}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 text-xs font-medium transition-colors"
          >
            <Zap size={12} /> Apply Fixed Script (no python3)
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Egg Name</label>
          <input className="input" value={form.name} onChange={f('name')} required />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={f('description')} />
        </div>
        <div>
          <label className="label">Docker Image</label>
          <input className="input font-mono" value={form.dockerImage} onChange={f('dockerImage')} required />
        </div>
        <div>
          <label className="label">Startup Command</label>
          <input className="input font-mono text-sm" value={form.startup} onChange={f('startup')} required />
        </div>
        <div>
          <label className="label">Stop Command</label>
          <input className="input font-mono" value={form.configStop} onChange={f('configStop')} />
        </div>
        <div>
          <label className="label">Install Script</label>
          <textarea
            className="input font-mono text-xs min-h-[120px] resize-y"
            value={form.scriptInstall}
            onChange={f('scriptInstall')}
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
            {isLoading ? <Spinner size="sm" /> : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
