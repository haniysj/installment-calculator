import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useApp } from '../store';
import { monthName, parseISO, type ISODate } from '../lib/dates';
import { parseRial, toInputValue } from '../lib/money';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }:
  { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v: Record<Variant, string> = {
    primary: 'shimmer bg-btn text-btn-fg border-btn hover:opacity-90 shadow-[0_6px_18px_-8px_var(--brand)]',
    secondary: 'bg-card text-ink border-line hover:bg-card-2',
    ghost: 'bg-transparent text-ink border-transparent hover:bg-card-2',
    danger: 'bg-rose text-white border-rose hover:opacity-90 dark:text-[#1a0b09]',
    success: 'bg-teal text-white border-teal hover:opacity-90 dark:text-[#06201c]',
  };
  const s = size === 'sm' ? 'h-9 px-3 text-sm gap-1.5' : 'h-11 px-4 gap-2';
  return (
    <button type="button" className={`inline-flex items-center justify-center rounded-full border font-bold whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none ${v[variant]} ${s} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-card border border-line rounded-3xl card-shadow ${className}`}>{children}</section>;
}

export function CardTitle({ icon, children, actions }: { icon?: IconName; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="flex items-center gap-2 font-bold text-[17px] leading-tight min-w-0">
        {icon && <Icon name={icon} size={19} className="text-muted shrink-0" />}
        <span className="truncate">{children}</span>
      </h2>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

export type Tone = 'teal' | 'rose' | 'saffron' | 'violet' | 'blue' | 'gray' | 'ink';
const TONES: Record<Tone, string> = {
  teal: 'bg-teal-bg text-teal',
  rose: 'bg-rose-bg text-rose',
  saffron: 'bg-saffron-bg text-saffron',
  violet: 'bg-violet-bg text-violet',
  blue: 'bg-blue-bg text-blue',
  gray: 'bg-card-2 text-muted border border-line',
  ink: 'bg-brand-bg text-brand',
};

export function Pill({ tone = 'gray', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
}

export function DateBadge({ date, tone = 'default' }: { date: ISODate; tone?: 'default' | 'cream' | 'rose' | 'teal' | 'saffron' }) {
  const { y, m, d } = parseISO(date);
  const cls = {
    default: 'bg-card-2 border-line text-ink',
    cream: 'bg-cream border-transparent text-ink',
    rose: 'bg-rose-bg border-transparent text-rose',
    teal: 'bg-teal-bg border-transparent text-teal',
    saffron: 'bg-saffron-bg border-transparent text-saffron',
  }[tone];
  return (
    <div className={`w-[52px] shrink-0 rounded-xl border text-center leading-none py-1.5 ${cls}`} aria-label={`${d} ${monthName(m)} ${y}`}>
      <div className="text-[20px] font-extrabold num block">{d}</div>
      <div className="text-[10.5px] font-bold mt-1">{monthName(m)}</div>
      <div className="text-[9.5px] opacity-70 num block mt-0.5">{y}</div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label ?? 'نسبة السداد'}
      className="h-3 rounded-full bg-card-2 border border-line overflow-hidden">
      <div className="h-full rounded-full bg-linear-to-l from-brand to-brand-2 transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-bold text-ink-2">{label}</label>
      {children}
      {error ? <p className="text-[13px] text-rose font-semibold" role="alert">{error}</p>
        : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** Money input in rial; reports baisa (or null when empty/invalid). */
export function MoneyInput({ value, onChange, id, placeholder, invalid, autoFocus, onEnter }:
  { value: number | null; onChange: (v: number | null, raw: string) => void; id?: string; placeholder?: string; invalid?: boolean; autoFocus?: boolean; onEnter?: () => void }) {
  const [raw, setRaw] = useState(toInputValue(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      if (parseRial(raw) !== value) setRaw(toInputValue(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <input id={id} inputMode="decimal" dir="ltr" autoComplete="off" autoFocus={autoFocus}
        className="field num text-left pl-14 font-bold text-[16px]" placeholder={placeholder ?? '0'}
        aria-invalid={invalid || undefined} value={raw}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        onChange={(e) => { setRaw(e.target.value); const v = parseRial(e.target.value); last.current = v; onChange(v, e.target.value); }} />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[13px] font-bold pointer-events-none">ر.ع.</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }:
  { value: T; options: { value: T; label: ReactNode; icon?: IconName }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid gap-1 p-1 rounded-xl bg-card-2 border border-line" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-10 px-2 rounded-lg text-[13.5px] font-bold flex items-center justify-center gap-1.5 text-center leading-tight transition ${value === o.value ? 'bg-card text-brand shadow-[0_2px_10px_-4px_var(--brand)] ring-1 ring-brand/30' : 'text-ink-2 hover:bg-card'}`}>
          {o.icon && <Icon name={o.icon} size={16} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide = false }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[autofocus],input,button')?.focus(), 30);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center no-print" role="presentation">
      <div className="absolute inset-0 bg-[#0b1724]/55" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92dvh] flex flex-col bg-card border border-line rounded-t-3xl sm:rounded-3xl shadow-2xl`}>
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-line">
          <h2 id={titleId} className="font-bold text-[17px] leading-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="size-9 grid place-items-center rounded-lg hover:bg-card-2 text-muted"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 justify-end" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const { confirmReq, closeConfirm } = useApp();
  return (
    <Modal open={!!confirmReq} onClose={() => closeConfirm(false)} title={confirmReq?.title}
      footer={<>
        <Button onClick={() => closeConfirm(false)}>إلغاء</Button>
        <Button variant={confirmReq?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)} autoFocus>
          {confirmReq?.confirmText ?? 'تأكيد'}
        </Button>
      </>}>
      <p className="text-ink-2 leading-relaxed">{confirmReq?.body}</p>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed z-[60] inset-x-3 bottom-[84px] md:bottom-6 md:left-6 md:right-auto md:w-[380px] flex flex-col gap-2 no-print" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
          className={`toast-in flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-lg border text-[14px] font-semibold ${
            t.kind === 'error' ? 'bg-rose-bg text-rose border-rose/30' : t.kind === 'info' ? 'bg-blue-bg text-blue border-blue/30' : 'bg-card text-ink border-line'}`}>
          <Icon name={t.kind === 'error' ? 'info' : 'check'} size={18} className={`mt-0.5 shrink-0 ${t.kind === 'success' ? 'text-teal' : ''}`} />
          <span className="flex-1 leading-relaxed">{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="إغلاق التنبيه" className="opacity-60 hover:opacity-100"><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10 px-4">
      <div className="size-16 rounded-2xl bg-card-2 border border-line grid place-items-center text-muted"><Icon name={icon} size={30} /></div>
      <h3 className="font-bold text-[18px]">{title}</h3>
      {body && <p className="text-muted max-w-sm leading-relaxed">{body}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'blue', icon = 'info', children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] font-semibold leading-relaxed ${TONES[tone]}`}>
      <Icon name={icon} size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** Circular progress ring */
export function ProgressRing({ value, size = 104, stroke = 10, light = false }: { value: number; size?: number; stroke?: number; light?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label="نسبة السداد">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={light ? 'rgb(255 255 255 / 0.22)' : 'var(--line)'} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke={light ? '#fff' : 'var(--brand)'} strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div><div className="num font-extrabold text-[20px]">{Math.round(v)}%</div><div className="text-[10.5px] font-bold opacity-80 mt-1">مسدَّد</div></div>
      </div>
    </div>
  );
}
