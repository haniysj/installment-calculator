import { useState } from 'react';
import { summarize, uid } from '../lib/engine';
import { formatDateShort } from '../lib/dates';
import { MODE_LABEL } from '../lib/csv';
import type { Plan } from '../lib/types';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, EmptyState, Pill, ProgressBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { RenameModal } from './PlanDetails';

export function Plans() {
  const { plans, settings, updateSettings, upsertPlan, removePlan, confirm, toast } = useApp();
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<Plan | null>(null);
  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const list = plans.filter((p) => !q.trim() || norm(p.name + ' ' + p.notes).includes(norm(q.trim())));

  async function duplicate(p: Plan) {
    const map = new Map(p.installments.map((r) => [r.id, uid('ins')]));
    const stamp = new Date().toISOString();
    const copy: Plan = {
      ...structuredClone(p), id: uid('plan'), name: `${p.name} (نسخة)`, createdAt: stamp, updatedAt: stamp,
      installments: p.installments.map((r) => ({ ...r, id: map.get(r.id)! })),
      payments: p.payments.map((x) => ({ ...x, id: uid('pay'), installmentId: x.installmentId ? map.get(x.installmentId) ?? null : null })),
    };
    if (await upsertPlan(copy)) toast('تم تكرار الخطة.');
  }
  async function del(p: Plan) {
    if (await confirm({ title: 'حذف الخطة نهائياً؟', body: `سيتم حذف «${p.name}» وجميع دفعاتها من هذا الجهاز.`, confirmText: 'حذف نهائي', danger: true })) {
      await removePlan(p.id);
      toast('تم حذف الخطة.');
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <CardTitle icon="list" actions={<Button size="sm" variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => go('/new')}>خطة جديدة</Button>}>
        خطط التقسيط المحفوظة <span className="num text-muted">({plans.length})</span>
      </CardTitle>
      {plans.length > 0 && (
        <div className="relative mb-3">
          <Icon name="search" size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" aria-label="بحث في الخطط" className="field pr-10" placeholder="ابحث باسم الخطة أو الملاحظات…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {plans.length === 0 ? (
        <EmptyState icon="list" title="لا توجد خطط محفوظة" body="كل خطة تنشئها تُحفظ تلقائياً على هذا الجهاز وتعمل بدون إنترنت."
          action={<Button variant="primary" onClick={() => go('/new')}>إنشاء خطة</Button>} />
      ) : list.length === 0 ? (
        <p className="text-muted py-6 text-center">لا توجد نتائج لـ «{q}».</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {list.map((p) => {
            const s = summarize(p);
            const active = p.id === (settings.activePlanId ?? plans[0]?.id);
            return (
              <li key={p.id} className={`rounded-2xl border p-3.5 ${active ? 'border-ink-2' : 'border-line'}`}>
                <button className="w-full text-right" onClick={() => go(`/plan/${p.id}`)}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-extrabold text-[16px]">{p.name}</span>
                    {active && <Pill tone="ink">المعروضة</Pill>}
                    {s.completed && <Pill tone="teal"><Icon name="check" size={12} />مسددة</Pill>}
                    {s.overdueCount > 0 && <Pill tone="rose">{s.overdueCount} متأخر</Pill>}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">{MODE_LABEL[p.mode]} · آخر تعديل <span className="num">{formatDateShort(p.updatedAt.slice(0, 10))}</span></div>
                  <div className="flex items-center gap-2 mt-2.5"><div className="flex-1"><ProgressBar value={s.progress} /></div><span className="num text-[12.5px] font-bold">{s.progress.toFixed(0)}%</span></div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5 text-[12.5px]">
                    <div><span className="text-muted font-bold">المتبقي: </span><Money value={s.outstanding} className="font-extrabold" /></div>
                    <div><span className="text-muted font-bold">الانتهاء: </span><span className="num font-bold">{s.expectedEnd ? formatDateShort(s.expectedEnd) : '—'}</span></div>
                  </div>
                </button>
                <div className="flex gap-1 mt-3 pt-2.5 border-t border-line">
                  {!active && <Button size="sm" variant="ghost" onClick={() => updateSettings({ activePlanId: p.id })}>عرض في الرئيسية</Button>}
                  <span className="ms-auto" />
                  <IconBtn label="إعادة تسمية" icon="edit" onClick={() => setRenaming(p)} />
                  <IconBtn label="تكرار" icon="copy" onClick={() => duplicate(p)} />
                  <IconBtn label="حذف" icon="trash" danger onClick={() => del(p)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {renaming && <RenameModal plan={renaming} onClose={() => setRenaming(null)} />}
    </Card>
  );
}

function IconBtn({ label, icon, onClick, danger }: { label: string; icon: 'edit' | 'copy' | 'trash'; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`size-9 grid place-items-center rounded-lg hover:bg-card-2 ${danger ? 'text-rose' : 'text-ink-2'}`}>
      <Icon name={icon} size={18} />
    </button>
  );
}
