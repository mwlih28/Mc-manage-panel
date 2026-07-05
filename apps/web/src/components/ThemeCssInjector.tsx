import { useSettings } from '@/hooks/useSettings';

// Mounted once at the app root, outside auth-gated routes, so an admin's
// custom CSS also applies to the public /login and /status/:slug pages.
export function ThemeCssInjector() {
  const { data: settings } = useSettings();
  const css = settings?.['theme.customCss'];
  if (!css) return null;
  return <style>{css}</style>;
}
