import type { ReactNode } from 'react';
import { buildSchedule, resetPlan, summarize } from '../lib/engine';
import { formatDateLong } from '../lib/dates';
import { MODE_LABEL } from '../lib/csv';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, DateBadge, EmptyState, Pill, ProgressBar } from '../components/ui';
import { FileIcon, Icon, type IconName } from '../components/Icon';
import { Money } from '../components/Money';
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
      <Card className="p-4 sm:p-5 no-print">
        <div className="flex flex-wrap items-center gap-2 justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-extrabold text-[20px] truncate">{plan.name}</h1>
            <Pill tone="violet">{MODE_LABEL[plan.mode]}</Pill>
            {s.completed && <Pill tone="teal"><Icon name="check" size={13} />مسددة بالكامل</Pill>}
          </div>
          {plans.length > 1 && (
            <select aria-label="اختيار الخطة المعروضة" className="field !w-auto !min-h-10 !py-1.5 text-[14px] font-bold max-w-56"
              value={plan.id} onChange={(e) => updateSettings({ activePlanId: e.target.value })}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-[14px] font-bold text-muted">نسبة السداد</span>
          <span className="num font-extrabold text-[18px]">{s.progress.toFixed(1)}%</span>
        </div>
        <ProgressBar value={s.progress} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4">
          <Kpi icon="wallet" label="المبلغ الأصلي" value={<Money value={s.principal} bold />} />
          <Kpi icon="check" label="إجمالي المدفوع" value={<Money value={s.totalPaid} bold />} tone="teal" />
          <Kpi icon="coins" label="الرصيد المتبقي" value={<Money value={s.outstanding} bold />} tone="saffron" />
          <Kpi icon="receipt" label="القسط الشهري الحالي" value={<Money value={s.currentInstallment} bold />} />
          <Kpi icon="check" label="أقساط مدفوعة" value={<span className="num">{s.paidCount}</span>} />
          <Kpi icon="clock" label="أقساط متبقية" value={<span className="num">{s.remainingCount}</span>}
            extra={s.overdueCount > 0 ? <Pill tone="rose">{s.overdueCount} متأخر</Pill> : null} />
          <Kpi icon="flag" label="تاريخ السداد المتوقع" value={s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'} className="col-span-2" />
        </div>
      </Card>

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
                  className={`w-full flex items-center gap-3 rounded-xl border p-2.5 text-right hover:bg-card-2 ${e.isCurrentMonth ? 'border-saffron-strong bg-saffron-bg/40' : 'border-line'}`}>
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
                    <div className="text-[12px] text-teal font-bold">تسجيل دفعة</div>
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

function Kpi({ icon, label, value, tone, extra, className = '' }: { icon: IconName; label: string; value: ReactNode; tone?: 'teal' | 'saffron'; extra?: ReactNode; className?: string }) {
  const t = tone === 'teal' ? 'bg-teal-bg/60' : tone === 'saffron' ? 'bg-saffron-bg/60' : 'bg-card-2';
  return (
    <div className={`rounded-xl border border-line p-3 ${t} ${className}`}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-muted"><Icon name={icon} size={15} />{label}{extra && <span className="ms-auto">{extra}</span>}</div>
      <div className="font-extrabold text-[18px] sm:text-[20px] mt-1">{value}</div>
    </div>
  );
}

function Action({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className={`min-h-[72px] rounded-2xl border p-3 flex flex-col items-center justify-center gap-1.5 text-center text-[13.5px] font-bold leading-tight ${primary ? 'bg-btn text-btn-fg border-btn col-span-2 sm:col-span-1' : 'bg-card border-line hover:bg-card-2'}`}>
      {icon}{label}
    </button>
  );
}
