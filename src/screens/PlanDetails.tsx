import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  addInstallment, buildSchedule, changeFirstDate, markPastInstallmentsPaid, changeFixedAmount, changePrincipal, changeInstallmentDate, editInstallment, firstOpenIndex,
  recalc, restoreDefault, resetPlan, summarize, uid, type ScheduleEntry,
} from '../lib/engine';
import { formatDateLong, formatDateShort, todayISO } from '../lib/dates';
import { MODE_LABEL } from '../lib/csv';
import { formatAmount, parseRial, toInputValue } from '../lib/money';
import type { Plan, Strategy } from '../lib/types';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, DateBadge, EmptyState, Field, Modal, MoneyInput, Notice, Pill, ProgressRing, Segmented } from '../components/ui';
import { FileIcon, Icon } from '../components/Icon';
import { AnimatedMoney, Money } from '../components/Money';
import { FinalPill, StatusPill } from '../components/Status';
import { PrintView, exportCSV } from '../components/PrintView';
import { PaymentEditor } from './PaymentEditor';
import { RowEditor } from './RowEditor';


export function PlanDetails({ id }: { id: string }) {
  const app = useApp();
  const { getPlan, settings, apply, unit, confirm, upsertPlan, removePlan, toast, updateSettings } = app;
  const plan = getPlan(id);
  const [asc, setAsc] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingPay, setEditingPay] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number>();

  useEffect(() => {
    if (plan && settings.activePlanId !== plan.id) updateSettings({ activePlanId: plan.id });
  }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = useMemo(() => (plan ? buildSchedule(plan) : []), [plan]);
  // always chronological (installments and extra payments together): previous → current month → upcoming
  const sorted = useMemo(() => (asc ? entries : entries.slice().reverse()), [entries, asc]);

  if (!plan) {
    return <Card className="p-4"><EmptyState icon="info" title="الخطة غير موجودة" body="ربما حُذفت. ارجع إلى قائمة الخطط."
      action={<Button onClick={() => go('/plans')}>الخطط المحفوظة</Button>} /></Card>;
  }
  const s = summarize(plan);

  async function run(r: Parameters<typeof apply>[0], showNotice = true) {
    const ok = await apply(r);
    if (ok && r.ok && r.message && showNotice && /إعادة|أُعيد|رُحّل|توزيع|خُصمت/.test(r.message)) {
      setNotice(r.message);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 9000);
    }
    return ok;
  }

  async function duplicate() {
    setMenu(false);
    const p = plan!;
    const map = new Map(p.installments.map((r) => [r.id, uid('ins')]));
    const stamp = new Date().toISOString();
    const copy: Plan = {
      ...structuredClone(p), id: uid('plan'), name: `${p.name} (نسخة)`, createdAt: stamp, updatedAt: stamp,
      installments: p.installments.map((r) => ({ ...r, id: map.get(r.id)! })),
      payments: p.payments.map((x) => ({ ...x, id: uid('pay'), installmentId: x.installmentId ? map.get(x.installmentId) ?? null : null })),
    };
    if (await upsertPlan(copy)) { toast('تم إنشاء نسخة من الخطة.'); go(`/plan/${copy.id}`); }
  }
  async function del() {
    setMenu(false);
    if (await confirm({ title: 'حذف الخطة نهائياً؟', body: `سيتم حذف «${plan!.name}» وجميع دفعاتها من هذا الجهاز ولا يمكن استعادتها إلا من نسخة احتياطية.`, confirmText: 'حذف نهائي', danger: true })) {
      await removePlan(plan!.id);
      toast('تم حذف الخطة.');
      go('/plans');
    }
  }
  async function restore() {
    setMenu(false);
    if (await confirm({ title: 'استعادة الجدول الافتراضي؟', body: 'ستُعاد الأقساط غير المدفوعة إلى الإعداد الأصلي للخطة. الدفعات المسجّلة تبقى كما هي.', confirmText: 'استعادة' }))
      run(restoreDefault(plan!, unit));
  }
  async function reset() {
    setMenu(false);
    if (!(await confirm({ title: 'إعادة تعيين الخطة؟', body: `سيُعاد بناء الجدول من البداية وتُحذف جميع الدفعات المسجّلة (${plan!.payments.length}).`, confirmText: 'متابعة', danger: true }))) return;
    if (await confirm({ title: 'تأكيد نهائي', body: 'لا يمكن التراجع. ننصح بتصدير نسخة احتياطية أولاً.', confirmText: 'إعادة التعيين', danger: true }))
      run(resetPlan(plan!, unit), false);
  }
  function setStrategy(st: Strategy) {
    const p = { ...plan!, strategy: st, fixedAmount: st === 'fixed' ? plan!.fixedAmount ?? s.regular : plan!.fixedAmount };
    const r = recalc(p, firstOpenIndex(p), { strategy: st, fixedAmount: p.fixedAmount ?? undefined, unit });
    run({ ok: true, value: { ...r, updatedAt: new Date().toISOString() }, message: st === 'fixed' ? 'تم تثبيت القسط وإعادة حساب المدة.' : 'تمت إعادة توزيع المتبقي بالتساوي مع تثبيت تاريخ الانتهاء.' });
  }

  const editingRow = editing ? plan.installments.find((r) => r.id === editing) : undefined;
  const today = todayISO();
  const pastOpen = plan.installments.filter((r) => !r.closed && !r.skipped && !r.cancelled && r.dueDate < today).length;
  async function markPast() {
    if (await confirm({ title: 'تسجيل الأقساط السابقة كمدفوعة؟', body: `سيُسجَّل ${pastOpen} ${pastOpen === 1 ? 'قسط' : 'أقساط'} كمدفوعة بمبالغها المخططة وبتاريخ استحقاق كل منها. يمكنك تعديل أي دفعة بعدها.`, confirmText: 'تسجيل' }))
      run(markPastInstallmentsPaid(plan!, { today }, unit), false);
  }

  return (
    <div className="grid gap-4">
      <PrintView plan={plan} />

      {/* header */}
      <section className="hero-card p-5 sm:p-6 no-print">
        <div className="flex items-start gap-2 justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-extrabold text-[20px] sm:text-[22px] leading-tight">{plan.name}</h1>
              <button onClick={() => setRenaming(true)} aria-label="إعادة تسمية الخطة" className="size-8 grid place-items-center rounded-full glass-chip"><Icon name="edit" size={17} /></button>
            </div>
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              <span className="glass-chip rounded-full px-2.5 py-0.5 text-[11.5px] font-bold">{MODE_LABEL[plan.mode]}</span>
              <span className="glass-chip rounded-full px-2.5 py-0.5 text-[11.5px] font-bold">{plan.strategy === 'fixed' ? 'قسط ثابت' : plan.strategy === 'equal' ? 'توزيع متساوٍ' : 'تسوية في القسط الأخير'}</span>
              {s.completed ? <Pill tone="teal" className="!bg-white"><Icon name="check" size={13} />مسددة بالكامل</Pill>
                : s.overdueCount > 0 && <Pill tone="rose" className="!bg-white">{s.overdueCount} متأخر</Pill>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 relative">
            <Button size="sm" variant="secondary" className="!bg-white !text-[#4b22c9] !border-white" icon={<Icon name="wallet" size={16} />} onClick={() => go(`/plan/${plan.id}/payments`)} disabled={s.completed}>
              <span className="hidden sm:inline">تسجيل دفعة</span><span className="sm:hidden">دفعة</span>
            </Button>
            <Button size="sm" variant="secondary" className="!bg-white/15 !border-white/30 !text-white" onClick={() => setMenu((m) => !m)} aria-label="المزيد من الإجراءات" aria-expanded={menu} icon={<Icon name="more" size={18} />} />
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div className="absolute top-11 left-0 z-40 w-60 bg-card text-ink border border-line rounded-2xl shadow-xl p-1.5 grid" role="menu">
                  <MenuItem icon={<FileIcon type="csv" size={18} />} onClick={() => { setMenu(false); exportCSV(plan, settings.decimals); toast('تم تصدير الجدول (CSV) — يفتح في Excel.'); }}>تصدير الجدول CSV</MenuItem>
                  <MenuItem icon={<Icon name="print" size={18} />} onClick={() => { setMenu(false); setTimeout(() => window.print(), 50); }}>طباعة الخطة</MenuItem>
                  <MenuItem icon={<FileIcon type="pdf" size={18} />} onClick={() => { setMenu(false); toast('اختر «حفظ بصيغة PDF» من نافذة الطباعة.', 'info'); setTimeout(() => window.print(), 400); }}>حفظ PDF</MenuItem>
                  <hr className="border-line my-1" />
                  <MenuItem icon={<Icon name="copy" size={18} />} onClick={duplicate}>تكرار الخطة</MenuItem>
                  <MenuItem icon={<Icon name="refresh" size={18} />} onClick={restore}>استعادة الجدول الافتراضي</MenuItem>
                  <MenuItem icon={<Icon name="refresh" size={18} className="text-rose" />} onClick={reset}>إعادة تعيين الخطة</MenuItem>
                  <MenuItem icon={<Icon name="trash" size={18} className="text-rose" />} onClick={del} danger>حذف الخطة</MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold opacity-80">الرصيد المتبقي</div>
            <div className="font-extrabold text-[28px] sm:text-[34px] leading-tight"><AnimatedMoney value={s.outstanding} bold /></div>
            <div className="flex flex-wrap gap-1.5 mt-2.5 text-[12px] font-bold">
              <span className="glass-chip rounded-full px-2.5 py-1">المدفوع <Money value={s.totalPaid} /></span>
              <span className="glass-chip rounded-full px-2.5 py-1">من <Money value={plan.principal} /></span>
              <span className="glass-chip rounded-full px-2.5 py-1">آخر قسط {s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'}</span>
            </div>
          </div>
          <ProgressRing value={s.progress} light size={96} />
        </div>
      </section>

      {/* plan settings / fixed installment */}
      <div className="grid lg:grid-cols-2 gap-4 no-print">
        <PlanControls plan={plan} onRun={run} onStrategy={setStrategy} />
        {plan.mode === 'fixed' || plan.strategy === 'fixed' ? <FixedSummary plan={plan} /> : (
          <Card className="p-4 sm:p-5">
            <CardTitle icon="info">ملخص الجدول</CardTitle>
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <Mini label="عدد الأقساط" value={<span className="num">{s.durationMonths}</span>} />
              <Mini label="القسط الأخير" value={<Money value={s.finalAmount} />} tone="violet" />
              <Mini label="أقساط مدفوعة" value={<span className="num">{s.paidCount}</span>} />
              <Mini label="أقساط متبقية" value={<span className="num">{s.remainingCount}</span>} />
            </dl>
            {plan.mode === 'flexible' && <p className="text-[12.5px] text-muted mt-3 leading-relaxed">عدّل أي قسط من الجدول؛ الأقساط السابقة تبقى كما هي، والمتبقي يُوزَّع على الأشهر اللاحقة.</p>}
            {plan.mode === 'custom' && <p className="text-[12.5px] text-muted mt-3 leading-relaxed">حدّد مبلغ كل شهر يدوياً؛ القسط الأخير يسوّي الفرق تلقائياً حتى يتطابق المجموع مع المبلغ.</p>}
          </Card>
        )}
      </div>

      {/* schedule */}
      <Card className="p-3 sm:p-5 no-print">
        <CardTitle icon="calendar" actions={
          <>
<span className="text-[12.5px] font-bold text-muted hidden sm:inline">حسب التاريخ</span>
            <button onClick={() => setAsc((a) => !a)} aria-label={asc ? 'عرض الأحدث أولاً' : 'عرض الأقدم أولاً'} className="size-9 grid place-items-center rounded-lg border border-line hover:bg-card-2">
              <Icon name="sort" size={17} className={asc ? '' : 'rotate-180'} />
            </button>
          </>
        }>جدول الأقساط</CardTitle>

        {notice && <div className="mb-3"><Notice tone="saffron" icon="refresh">{notice}</Notice></div>}
        {pastOpen > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card-2 p-3">
            <Icon name="clock" size={18} className="text-saffron shrink-0" />
            <span className="flex-1 min-w-48 text-[13.5px] font-semibold text-ink-2">
              يوجد <span className="num font-extrabold">{pastOpen}</span> {pastOpen === 1 ? 'قسط' : 'أقساط'} حلّ موعدها ولم تُسجَّل. إذا كنت قد دفعتها قبل إدخال الخطة سجّلها دفعة واحدة.
            </span>
            <Button size="sm" variant="success" icon={<Icon name="check" size={16} />} onClick={markPast}>تسجيلها كمدفوعة</Button>
          </div>
        )}

        {/* desktop table */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13.5px]">
            <thead className="bg-card-2 text-muted text-[12.5px]">
              <tr>
                <th className="p-2.5 text-right w-12">الرقم</th>
                <th className="p-2.5 text-right">تاريخ الدفع</th>
                <th className="p-2.5 text-left">القسط المخطط</th>
                <th className="p-2.5 text-left">المدفوع فعلياً</th>
                <th className="p-2.5 text-left">الرصيد المتبقي</th>
                <th className="p-2.5 text-right">الحالة</th>
                <th className="p-2.5 w-24"><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, k) => (
                <Fragment key={e.key}>
                  {(k === 0 || sorted[k - 1].period !== e.period) && (
                    <tr><td colSpan={7} className="px-3 pt-3 pb-1.5 bg-card"><PeriodLabel period={e.period} /></td></tr>
                  )}
                  <DesktopRow plan={plan} e={e} onRun={run} onOpen={() => (e.type === 'installment' ? setEditing(e.id) : setEditingPay(e.id))} />
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-card-2 font-extrabold border-t-2 border-line">
                <td className="p-2.5" colSpan={2}>الإجمالي</td>
                <td className="p-2.5 text-left"><Money value={s.totalPlanned} /></td>
                <td className="p-2.5 text-left text-teal"><Money value={s.totalPaid} /></td>
                <td className="p-2.5 text-left text-saffron"><Money value={s.outstanding} /></td>
                <td className="p-2.5 text-[12px] text-muted font-bold" colSpan={2}>الرصيد الفعلي حسب الدفعات المسجّلة</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* mobile cards */}
        <ul className="md:hidden grid gap-2">
          {sorted.map((e, k) => (
            <Fragment key={e.key}>
              {(k === 0 || sorted[k - 1].period !== e.period) && <li className="pt-2 first:pt-0"><PeriodLabel period={e.period} /></li>}
              <MobileRow e={e} onOpen={() => (e.type === 'installment' ? setEditing(e.id) : setEditingPay(e.id))} />
            </Fragment>
          ))}
        </ul>
        <div className="md:hidden mt-3 rounded-xl bg-card-2 border border-line p-3 grid grid-cols-3 gap-2 text-center text-[12px]">
          <div><div className="text-muted font-bold">إجمالي المخطط</div><div className="font-extrabold text-[13.5px]"><Money value={s.totalPlanned} /></div></div>
          <div><div className="text-muted font-bold">المدفوع فعلياً</div><div className="font-extrabold text-[13.5px] text-teal"><Money value={s.totalPaid} /></div></div>
          <div><div className="text-muted font-bold">المتبقي</div><div className="font-extrabold text-[13.5px] text-saffron"><Money value={s.outstanding} /></div></div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {plan.mode === 'custom' && <Button size="sm" icon={<Icon name="plus" size={16} />} onClick={() => run(addInstallment(plan, unit))}>إضافة قسط</Button>}
          <Button size="sm" icon={<FileIcon type="csv" size={17} />} onClick={() => { exportCSV(plan, settings.decimals); toast('تم تصدير الجدول (CSV).'); }}>تصدير CSV</Button>
          <Button size="sm" icon={<Icon name="print" size={16} />} onClick={() => window.print()}>طباعة</Button>
          <Button size="sm" icon={<FileIcon type="pdf" size={17} />} onClick={() => { toast('اختر «حفظ بصيغة PDF» من نافذة الطباعة.', 'info'); setTimeout(() => window.print(), 400); }}>PDF</Button>
          <Button size="sm" icon={<Icon name="receipt" size={16} />} onClick={() => go(`/plan/${plan.id}/payments`)}>سجل الدفعات ({plan.payments.length})</Button>
        </div>
      </Card>

      {plan.notes && <Card className="p-4 no-print"><CardTitle icon="note">ملاحظات</CardTitle><p className="whitespace-pre-wrap text-ink-2">{plan.notes}</p></Card>}

      {editingRow && <RowEditor plan={plan} row={editingRow} onClose={() => setEditing(null)} onRun={run}
        onEditPayment={(pid) => { setEditing(null); setEditingPay(pid); }} />}
      {editingPay && <PaymentEditor plan={plan} paymentId={editingPay} onClose={() => setEditingPay(null)} />}
      {renaming && <RenameModal plan={plan} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function PeriodLabel({ period }: { period: ScheduleEntry['period'] }) {
  const t = period === 'past' ? { label: 'السابقة', cls: 'text-teal', dot: 'bg-teal' }
    : period === 'current' ? { label: 'الشهر الحالي', cls: 'text-brand', dot: 'bg-brand' }
    : { label: 'القادمة', cls: 'text-muted', dot: 'bg-muted' };
  return (
    <div className={`flex items-center gap-2 text-[13px] font-extrabold ${t.cls}`}>
      <span className={`size-2 rounded-full ${t.dot}`} />{t.label}<span className="flex-1 h-px bg-line" />
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex items-center gap-2.5 px-3 h-11 rounded-xl text-[14px] font-bold text-right hover:bg-card-2 ${danger ? 'text-rose' : ''}`}>
      {icon}{children}
    </button>
  );
}

function Mini({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'teal' | 'saffron' | 'violet' }) {
  const t = tone === 'teal' ? 'text-teal' : tone === 'saffron' ? 'text-saffron' : tone === 'violet' ? 'text-violet' : '';
  return (
    <div className="rounded-xl bg-card-2 border border-line px-3 py-2">
      <dt className="text-muted font-bold text-[12px]">{label}</dt>
      <dd className={`font-extrabold text-[15px] ${t}`}>{value}</dd>
    </div>
  );
}

function rowTone(e: ScheduleEntry) {
  if (e.status === 'cancelled' || e.status === 'skipped') return 'opacity-60';
  if (e.isCurrentMonth && e.type === 'installment') return 'bg-brand-bg/60';
  if (e.status === 'overdue') return 'bg-rose-bg/40';
  if (e.type !== 'installment') return 'bg-blue-bg/40';
  if (e.isFinal) return 'bg-violet-bg/35';
  return '';
}

function DesktopRow({ plan, e, onRun, onOpen }: { plan: Plan; e: ScheduleEntry; onRun: (r: any) => Promise<boolean>; onOpen: () => void }) {
  const { unit } = useApp();
  const row = e.type === 'installment' ? plan.installments[e.index] : null;
  const editable = !!row && !row.closed && !row.skipped;
  return (
    <tr className={`border-t border-line ${rowTone(e)}`}>
      <td className="p-2.5 num font-bold"><span className="inline-flex items-center gap-1">{e.no}{e.type !== 'installment' && <Icon name="coins" size={14} className="text-blue" />}</span></td>
      <td className="p-2">
        {editable ? (
          <input type="date" aria-label={`تاريخ القسط ${e.no}`} className="bg-transparent border border-transparent hover:border-line focus:border-ink-2 rounded-lg px-2 py-1 num"
            value={e.date} onChange={(ev) => ev.target.value && onRun(changeInstallmentDate(plan, row!.id, ev.target.value))} />
        ) : <span className="num px-2">{formatDateShort(e.date)}</span>}
        {e.isCurrentMonth && e.type === 'installment' && <span className="ms-1 text-[11px] font-bold text-brand">● الشهر الحالي</span>}
      </td>
      <td className="p-2 text-left">
        {editable ? <InlineMoney value={row!.planned} label={`القسط المخطط ${e.no}`} onCommit={(v) => onRun(editInstallment(plan, row!.id, v, 'keep', unit))} />
          : e.planned == null ? <span className="text-muted">—</span> : <span className={e.status === 'cancelled' ? 'line-through' : ''}><Money value={e.planned} /></span>}
      </td>
      <td className="p-2.5 text-left font-bold text-teal">{e.actual ? <Money value={e.actual} /> : <span className="text-muted font-normal">—</span>}</td>
      <td className="p-2.5 text-left font-bold"><Money value={e.balanceAfter} /></td>
      <td className="p-2.5"><span className="inline-flex flex-wrap gap-1"><StatusPill entry={e} />{e.isFinal && <FinalPill />}</span>
        {e.note && <div className="text-[11.5px] text-muted mt-0.5 truncate max-w-48" title={e.note}>{e.note}</div>}</td>
      <td className="p-2 text-left">
        {e.type === 'installment' ? (
          <button onClick={onOpen} className="h-8 px-2.5 rounded-lg border border-line hover:bg-card-2 text-[12.5px] font-bold inline-flex items-center gap-1">
            <Icon name="more" size={15} />إجراءات
          </button>
        ) : (
          <button onClick={onOpen} className="h-8 px-2.5 rounded-lg border border-line hover:bg-card-2 text-[12.5px] font-bold inline-flex items-center gap-1">
            <Icon name="edit" size={14} />تعديل
          </button>
        )}
      </td>
    </tr>
  );
}

function InlineMoney({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const commit = () => {
    if (raw == null) return;
    const v = parseRial(raw);
    setRaw(null);
    if (v == null) return;
    if (v !== value) onCommit(v);
  };
  if (raw == null) {
    return (
      <button onClick={() => setRaw(toInputValue(value))} aria-label={`${label}: ${formatAmount(value)} — اضغط للتعديل`}
        className="group inline-flex items-center gap-1 rounded-lg px-2 py-1 border border-transparent hover:border-line font-bold">
        <Icon name="edit" size={13} className="opacity-0 group-hover:opacity-60" /><Money value={value} />
      </button>
    );
  }
  return (
    <input autoFocus aria-label={label} inputMode="decimal" dir="ltr" className="field !min-h-8 !py-1 !w-32 num font-bold text-left"
      value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setRaw(null); }} />
  );
}

function MobileRow({ e, onOpen }: { e: ScheduleEntry; onOpen: () => void }) {
  const tone = e.status === 'overdue' ? 'rose' : e.status === 'paid' || e.status === 'paid-short' ? 'teal' : e.isCurrentMonth ? 'saffron' : 'default';
  return (
    <li>
      <button onClick={onOpen} className={`w-full text-right flex items-center gap-3 rounded-2xl border border-line p-2.5 bg-card ${rowTone(e)} ${e.isCurrentMonth && e.type === 'installment' ? 'glow-border' : ''}`}>
        <DateBadge date={e.date} tone={tone as any} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold">{e.type === 'installment' ? 'القسط' : e.type === 'down' ? 'دفعة أولى' : 'دفعة إضافية'} <span className="num">{e.no}</span></span>
            {e.isFinal && <FinalPill />}
          </div>
          <div className="mt-1"><StatusPill entry={e} /></div>
          <div className="text-[12px] text-muted mt-1">الرصيد بعده: <Money value={e.balanceAfter} className="font-bold text-ink-2" /></div>
        </div>
        <div className="text-left shrink-0">
          {e.planned != null && <div className={`font-extrabold text-[16px] ${e.status === 'cancelled' ? 'line-through' : ''}`}><Money value={e.planned} /></div>}
          {e.actual > 0 && <div className="text-[12.5px] font-bold text-teal">مدفوع <Money value={e.actual} /></div>}
          {e.type === 'installment' ? <Icon name="chevron" size={16} className="text-muted inline-block mt-1" /> : <Icon name="edit" size={14} className="text-muted inline-block mt-1" />}
        </div>
      </button>
    </li>
  );
}

function PlanControls({ plan, onRun, onStrategy }: { plan: Plan; onRun: (r: any) => Promise<boolean>; onStrategy: (s: Strategy) => void }) {
  const { unit } = useApp();
  const [principal, setPrincipal] = useState<number | null>(plan.principal);
  const [fixed, setFixed] = useState<number | null>(plan.fixedAmount);
  useEffect(() => setPrincipal(plan.principal), [plan.principal]);
  useEffect(() => setFixed(plan.fixedAmount), [plan.fixedAmount]);
  const timer = useRef<number>();

  // recalculate automatically shortly after a valid change
  function schedule(fn: () => void) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, 700);
  }
  const fixedErr = fixed == null || fixed <= 0 ? 'يجب أن يكون القسط الشهري الثابت أكبر من صفر.' : null;
  const principalErr = principal == null || principal <= 0 ? 'أدخل مبلغاً أكبر من صفر.' : null;
  const showFixed = plan.mode === 'fixed' || plan.strategy === 'fixed';
  const currentFirst = plan.installments[0]?.dueDate ?? plan.firstDate;
  const [first, setFirst] = useState(currentFirst);
  useEffect(() => setFirst(currentFirst), [currentFirst]);

  return (
    <Card className="p-4 sm:p-5">
      <CardTitle icon="settings">{plan.mode === 'fixed' ? 'تثبيت القسط الشهري' : 'إعدادات الخطة'}</CardTitle>
      <div className="grid gap-3.5">
        <Field label="المبلغ الإجمالي" htmlFor="pc-principal" error={principalErr} hint="عند تغييره يُعاد حساب المدة والأقساط غير المدفوعة فوراً.">
          <MoneyInput id="pc-principal" value={principal} invalid={!!principalErr}
            onChange={(v) => { setPrincipal(v); if (v && v > 0 && v !== plan.principal) schedule(() => onRun(changePrincipal(plan, v, unit))); }} />
        </Field>
        <Field label="تاريخ أول قسط (بداية الخطة)" htmlFor="pc-first" hint="إذا بدأت الخطة قبل إدخالها في النظام اختر تاريخها الفعلي؛ تنتقل كل المواعيد معها، والدفعات المسجّلة لا تتغير.">
          <div className="flex gap-2">
            <input id="pc-first" type="date" className="field" value={first} onChange={(e) => setFirst(e.target.value)} />
            <Button disabled={!first || first === currentFirst} onClick={() => onRun(changeFirstDate(plan, first))}>حفظ</Button>
          </div>
        </Field>
        {showFixed && (
          <Field label="القسط الشهري الثابت" htmlFor="pc-fixed" error={fixedErr} hint="عند تغييره يُعاد حساب الجدول وتاريخ السداد الأخير فوراً.">
            <MoneyInput id="pc-fixed" value={fixed} invalid={!!fixedErr}
              onChange={(v) => { setFixed(v); if (v && v > 0 && v !== plan.fixedAmount) schedule(() => onRun(changeFixedAmount(plan, v, unit))); }} />
          </Field>
        )}
        {plan.mode !== 'fixed' && (
          <Field label="عند تعديل قسط أو تسجيل دفعة إضافية">
            <Segmented ariaLabel="طريقة إعادة الحساب" value={plan.strategy === 'last' ? 'last' : plan.strategy} onChange={(v) => onStrategy(v as Strategy)}
              options={[
                { value: 'equal', label: 'توزيع بالتساوي' },
                { value: 'fixed', label: 'تثبيت القسط' },
                ...(plan.mode === 'custom' ? [{ value: 'last' as const, label: 'تسوية بالأخير' }] : []),
              ]} />
          </Field>
        )}
      </div>
    </Card>
  );
}

function FixedSummary({ plan }: { plan: Plan }) {
  const s = summarize(plan);
  const differs = s.finalAmount !== s.regular;
  return (
    <Card className="p-4 sm:p-5">
      <CardTitle icon="calendar">نتيجة القسط الثابت</CardTitle>
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        <Mini label="القسط المنتظم" value={<Money value={s.regular} />} />
        <Mini label="القسط الأخير (التسوية)" value={<Money value={s.finalAmount} />} tone="violet" />
        <Mini label="أقساط كاملة" value={<span className="num">{s.fullInstallments}</span>} />
        <Mini label="مدة السداد" value={<><span className="num">{s.durationMonths}</span> شهر</>} />
        <Mini label="تاريخ آخر قسط" value={s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'} />
        <Mini label="إجمالي المبلغ المسدَّد" value={<Money value={plan.principal} />} />
      </dl>
      {differs && s.durationMonths > 1 && (
        <div className="mt-3"><Notice tone="violet" icon="flag">القسط الأخير <Money value={s.finalAmount} /> يسوّي الرصيد بالضبط دون زيادة.</Notice></div>
      )}
    </Card>
  );
}

export function RenameModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { upsertPlan, toast } = useApp();
  const [name, setName] = useState(plan.name);
  const [notes, setNotes] = useState(plan.notes);
  async function save() {
    if (!name.trim()) return;
    if (await upsertPlan({ ...plan, name: name.trim(), notes, updatedAt: new Date().toISOString() })) { toast('تم حفظ الاسم والملاحظات.'); onClose(); }
  }
  return (
    <Modal open onClose={onClose} title="اسم الخطة والملاحظات"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" onClick={save} disabled={!name.trim()}>حفظ</Button></>}>
      <div className="grid gap-3">
        <Field label="اسم الخطة" htmlFor="rn" error={!name.trim() ? 'الاسم مطلوب.' : null}>
          <input id="rn" className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="ملاحظات" htmlFor="rnn"><textarea id="rnn" className="field min-h-24" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-[12px] text-muted">أُنشئت: <span className="num">{formatDateShort(plan.createdAt.slice(0, 10))}</span> — آخر تعديل: <span className="num">{formatDateShort(plan.updatedAt.slice(0, 10))}</span></p>
      </div>
    </Modal>
  );
}

export { todayISO };
