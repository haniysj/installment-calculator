import type { ReactNode } from 'react';
import { buildSchedule, resetPlan, summarize } from '../lib/engine';
import { formatDateLong, formatDateShort } from '../lib/dates';
import { MODE_LABEL } from '../lib/csv';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, DateBadge, EmptyState, Pill, ProgressRing } from '../components/ui';
import { FileIcon, Icon, type IconName } from '../components/Icon';
import { AnimatedMoney, Money } from '../components/Money';
import { StatusPill } from '../components/Status';
import { PrintView, exportCSV } from '../components/PrintView';

export function Dashboard() {
  const { plans, activePlan: plan, settings, updateSettings, confirm, apply, unit } = useApp();

  if (!plan) {
    return (
      <Card className="p-4">
        <EmptyState icon="calendar" title="لا توجد خطط تقسيط بعد"
          body="أنشئ خطتك الأولى: أدخل المبلغ والقسط الشهري، وسيحسب التطبيق المدة وتاريخ آخر قسط ويحفظ كل شيء على جهازك."
          action={<Button variant="primary" icon={<Icon name="plus" size={18} />} onClick={() => go('/new')}>إنشاء خطة تقسيط جديدة</Button>} />
      </Card>
    );
  }

  const s = summarize(plan);
  const upcoming = buildSchedule(plan).filter((e) => e.type === 'installment' && ['overdue', 'current', 'upcoming', 'partial'].includes(e.status)).slice(0, 4);

  async function reset() {
    if (!plan) return;
    const ok1 = await confirm({ title: 'إعادة تعيين الخطة؟', body: `سيُعاد بناء جدول «${plan.name}» من إعداداته الأصلية وتُحذف جميع الدفعات المسجّلة (${plan.payments.length}).`, confirmText: 'متابعة', danger: true });
    if (!ok1) return;
    const ok2 = await confirm({ title: 'تأكيد نهائي', body: 'لا يمكن التراجع عن هذا الإجراء. ننصح بتصدير نسخة احتياطية أولاً.', confirmText: 'إعادة التعيين', danger: true });
    if (ok2) apply(resetPlan(plan, unit));
  }

  return (
    <div className="grid gap-4">
      <PrintView plan={plan} />
      <section className="hero-card p-5 sm:p-6 no-print">
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-extrabold text-[19px] truncate">{plan.name}</h1>
            <span className="glass-chip rounded-full px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap">{MODE_LABEL[plan.mode]}</span>
          </div>
          {plans.length > 1 && (
            <select aria-label="اختيار الخطة المعروضة" className="glass-chip rounded-full h-9 px-3 text-[13px] font-bold text-white max-w-44 [&>option]:text-black"
              value={plan.id} onChange={(e) => updateSettings({ activePlanId: e.target.value })}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold opacity-80">الرصيد المتبقي</div>
            <div className="font-extrabold text-[30px] sm:text-[36px] leading-tight mt-0.5"><AnimatedMoney value={s.outstanding} bold /></div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="glass-chip rounded-full px-2.5 py-1 text-[12px] font-bold">المدفوع <Money value={s.totalPaid} /></span>
              <span className="glass-chip rounded-full px-2.5 py-1 text-[12px] font-bold">من <Money value={s.principal} /></span>
              {s.completed && <span className="rounded-full px-2.5 py-1 text-[12px] font-bold bg-white text-[#0b8a5f]">✓ مسددة بالكامل</span>}
            </div>
          </div>
          <ProgressRing value={s.progress} light />
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 no-print">
        <Kpi icon="receipt" label="القسط الشهري الحالي" value={<AnimatedMoney value={s.currentInstallment} bold />} tone="brand" className="col-span-2 lg:col-span-1"
          extra={s.currentInstallmentDate ? <span className="num text-[11.5px]">{formatDateShort(s.currentInstallmentDate)}</span> : null} />
        <Kpi icon="check" label="أقساط مدفوعة" value={<span className="num">{s.paidCount}</span>} tone="teal" />
        <Kpi icon="clock" label="أقساط متبقية" value={<span className="num">{s.remainingCount}</span>}
          extra={s.overdueCount > 0 ? <Pill tone="rose">{s.overdueCount} متأخر</Pill> : null} />
        <Kpi icon="flag" label="تاريخ السداد المتوقع" value={s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 no-print">
        <Action icon={<Icon name="plus" />} label="إنشاء خطة تقسيط جديدة" onClick={() => go('/new')} primary />
        <Action icon={<Icon name="list" />} label="خطط التقسيط المحفوظة" onClick={() => go('/plans')} />
        <Action icon={<FileIcon type="csv" size={22} />} label="تصدير الجدول" onClick={() => exportCSV(plan, settings.decimals)} />
        <Action icon={<Icon name="print" />} label="طباعة الخطة" onClick={() => window.print()} />
        <Action icon={<Icon name="refresh" className="text-rose" />} label="إعادة تعيين الخطة" onClick={reset} />
      </div>

      <Card className="p-4 sm:p-5 no-print">
        <CardTitle icon="calendar" actions={<Button size="sm" onClick={() => go(`/plan/${plan.id}`)}>الجدول الكامل<Icon name="chevron" size={16} /></Button>}>الأقساط القادمة</CardTitle>
        {upcoming.length === 0 ? (
          <p className="text-muted">لا توجد أقساط قادمة — {s.completed ? 'تم سداد الخطة بالكامل.' : 'سجّل الدفعات من جدول الخطة.'}</p>
        ) : (
          <ul className="grid gap-2">
            {upcoming.map((e) => (
              <li key={e.key}>
                <button onClick={() => go(`/plan/${plan.id}/payments?row=${e.id}`)}
                  className={`w-full flex items-center gap-3 rounded-2xl border p-2.5 text-right bg-card hover:bg-card-2 ${e.isCurrentMonth ? 'glow-border' : 'border-line'}`}>
                  <DateBadge date={e.date} tone={e.status === 'overdue' ? 'rose' : e.isCurrentMonth ? 'saffron' : 'default'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold">القسط <span className="num">{e.no}</span></span>
                      <StatusPill entry={e} />
                    </div>
                    <div className="text-[13px] text-muted mt-0.5">الرصيد بعده: <Money value={e.balanceAfter} /></div>
                  </div>
                  <div className="text-left">
                    <div className="font-extrabold text-[17px]"><Money value={(e.planned ?? 0) - e.actual} /></div>
                    <div className="text-[12px] text-brand font-bold">تسجيل دفعة ←</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, tone, extra, className = '' }: { icon: IconName; label: string; value: ReactNode; tone?: 'teal' | 'saffron' | 'brand'; extra?: ReactNode; className?: string }) {
  const ic = tone === 'teal' ? 'bg-teal-bg text-teal' : tone === 'saffron' ? 'bg-saffron-bg text-saffron' : tone === 'brand' ? 'bg-brand-bg text-brand' : 'bg-card-2 text-muted';
  return (
    <div className={`rounded-2xl border border-line bg-card card-shadow p-3.5 ${className}`}>
      <div className="flex items-center gap-2 text-[12.5px] font-bold text-muted">
        <span className={`size-7 rounded-lg grid place-items-center ${ic}`}><Icon name={icon} size={15} /></span>{label}{extra && <span className="ms-auto">{extra}</span>}
      </div>
      <div className="font-extrabold text-[18px] sm:text-[20px] mt-1">{value}</div>
    </div>
  );
}

function Action({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className={`min-h-[76px] rounded-2xl border p-3 flex flex-col items-center justify-center gap-1.5 text-center text-[13.5px] font-bold leading-tight card-shadow transition hover:-translate-y-0.5 ${primary ? 'shimmer bg-btn text-btn-fg border-btn col-span-2 sm:col-span-1' : 'bg-card border-line hover:border-brand/40'}`}>
      {icon}{label}
    </button>
  );
}
