import { AppProvider, useApp } from './store';
import { go, useRoute, type Route } from './router';
import { Icon, type IconName } from './components/Icon';
import { AppMark } from './components/AppIcon';
import { ConfirmHost, Notice, Pill, Toasts } from './components/ui';
import { Dashboard } from './screens/Dashboard';
import { NewPlan } from './screens/NewPlan';
import { PlanDetails } from './screens/PlanDetails';
import { Payments } from './screens/Payments';
import { Plans } from './screens/Plans';
import { Backup } from './screens/Backup';
import { SettingsScreen } from './screens/Settings';

const NAV: { name: Route['name']; path: string; label: string; icon: IconName }[] = [
  { name: 'dashboard', path: '/', label: 'الرئيسية', icon: 'home' },
  { name: 'plans', path: '/plans', label: 'الخطط', icon: 'list' },
  { name: 'new', path: '/new', label: 'خطة جديدة', icon: 'plus' },
  { name: 'backup', path: '/backup', label: 'النسخ', icon: 'cloud' },
  { name: 'settings', path: '/settings', label: 'الإعدادات', icon: 'settings' },
];

function Shell() {
  const route = useRoute();
  const { loaded, settings, online, dbError } = useApp();
  const active = route.name === 'plan' || route.name === 'payments' ? 'plans' : route.name;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="no-print sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-line" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <a href="#/" className="flex items-center gap-2.5 min-w-0" aria-label="الرئيسية">
            <AppMark size={38} />
            <span className="font-extrabold text-[18px] sm:text-[20px] leading-tight truncate">{settings.appTitle}</span>
          </a>
          {!online && <Pill tone="saffron" className="shrink-0"><Icon name="offline" size={13} />غير متصل</Pill>}
          <nav className="hidden md:flex items-center gap-1 ms-auto" aria-label="القائمة الرئيسية">
            {NAV.map((n) => (
              <a key={n.name} href={`#${n.path}`} aria-current={active === n.name ? 'page' : undefined}
                className={`h-10 px-3 rounded-xl flex items-center gap-1.5 font-bold text-[14px] ${active === n.name ? 'bg-btn text-btn-fg' : 'text-ink-2 hover:bg-card'}`}>
                <Icon name={n.icon} size={17} />{n.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-4 md:py-6 pb-28 md:pb-10">
        {dbError && <div className="mb-4 no-print"><Notice tone="rose">{dbError}</Notice></div>}
        {!loaded ? (
          <div className="py-24 text-center text-muted font-semibold" role="status">جارٍ تحميل البيانات المحفوظة…</div>
        ) : (
          <Screen route={route} />
        )}
      </main>

      <footer className="no-print hidden md:block text-center text-[12px] text-muted pb-6">
        Prepared by: Hani Al Ghatrifi
      </footer>

      <nav className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-line grid grid-cols-5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="القائمة الرئيسية">
        {NAV.map((n) => (
          <a key={n.name} href={`#${n.path}`} aria-current={active === n.name ? 'page' : undefined}
            className={`h-16 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${active === n.name ? 'text-ink' : 'text-muted'}`}>
            <span className={`h-7 w-12 grid place-items-center rounded-full ${active === n.name ? 'bg-saffron-bg text-saffron' : ''} ${n.name === 'new' ? 'bg-btn !text-btn-fg' : ''}`}>
              <Icon name={n.icon} size={19} />
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <Toasts />
      <ConfirmHost />
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'new': return <NewPlan />;
    case 'plans': return <Plans />;
    case 'plan': return <PlanDetails id={route.id} />;
    case 'payments': return <Payments id={route.id} installmentId={route.installmentId} />;
    case 'backup': return <Backup />;
    case 'settings': return <SettingsScreen />;
    default: return <Dashboard />;
  }
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

export { go };
