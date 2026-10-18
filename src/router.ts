import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'new' }
  | { name: 'plans' }
  | { name: 'plan'; id: string }
  | { name: 'payments'; id: string; installmentId?: string }
  | { name: 'backup' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'plans') return { name: 'plans' };
  if (parts[0] === 'backup') return { name: 'backup' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'plan' && parts[1]) {
    if (parts[2] === 'payments') return { name: 'payments', id: parts[1], installmentId: q.get('row') ?? undefined };
    return { name: 'plan', id: parts[1] };
  }
  return { name: 'dashboard' };
}

export function go(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const f = () => { setRoute(parseHash(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}
