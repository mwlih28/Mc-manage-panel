import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { User, Lock, Key } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components/ui/Spinner';
import toast from 'react-hot-toast';

export function AccountPage() {
  const { user, setUser } = useAuthStore();
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    language: user?.language || 'en',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const profileMutation = useMutation({
    mutationFn: (data: typeof profileForm) => api.patch('/users/profile/me', data),
    onSuccess: ({ data }) => {
      setUser(data.data);
      toast.success('Profile updated');
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.patch('/users/profile/me', data),
    onSuccess: () => {
      toast.success('Password updated');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to update password');
    },
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    passwordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Account Settings</h1>
        <p className="text-slate-400 text-sm mt-1">Manage your account preferences</p>
      </div>

      {/* Profile info */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <User size={16} className="text-panel-400" />
          <h2 className="text-sm font-semibold text-slate-100">Profile Information</h2>
        </div>
        <div className="card-body">
          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-panel-400 to-panel-600 flex items-center justify-center text-white text-2xl font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div>
              <p className="font-semibold text-slate-100">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
              <p className="text-xs text-slate-500">@{user?.username}</p>
            </div>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); profileMutation.mutate(profileForm); }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name</label>
                <input
                  className="input"
                  value={profileForm.firstName}
                  onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Last Name</label>
                <input
                  className="input"
                  value={profileForm.lastName}
                  onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Language</label>
              <select
                className="input"
                value={profileForm.language}
                onChange={(e) => setProfileForm({ ...profileForm, language: e.target.value })}
              >
                <option value="en">English</option>
                <option value="tr">Turkish</option>
                <option value="de">German</option>
                <option value="fr">French</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={profileMutation.isPending}
            >
              {profileMutation.isPending ? <Spinner size="sm" /> : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>

      {/* Password */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Lock size={16} className="text-panel-400" />
          <h2 className="text-sm font-semibold text-slate-100">Change Password</h2>
        </div>
        <div className="card-body">
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                className="input"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="label">Confirm New Password</label>
              <input
                type="password"
                className="input"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={passwordMutation.isPending}
            >
              {passwordMutation.isPending ? <Spinner size="sm" /> : 'Update Password'}
            </button>
          </form>
        </div>
      </div>

      {/* API Key section */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Key size={16} className="text-panel-400" />
          <h2 className="text-sm font-semibold text-slate-100">API Keys</h2>
        </div>
        <div className="card-body">
          <p className="text-sm text-slate-400 mb-3">
            API keys allow external applications to interact with the panel.
          </p>
          <button className="btn-secondary btn-sm">
            <Key size={14} /> Create API Key
          </button>
        </div>
      </div>
    </div>
  );
}
