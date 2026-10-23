import { useRef, useState } from 'react';
import { buildBackup, mergePlans, parseBackup } from '../lib/backup';
import { todayISO } from '../lib/dates';
import type { Plan, Settings } from '../lib/types';
import { useApp } from '../store';
import { Button, Card, CardTitle, Notice, Segmented } from '../components/ui';
import { FileIcon, Icon } from '../components/Icon';
import { downloadFile } from '../components/PrintView';

export function Backup() {
  const { plans, settings, replacePlans, updateSettings, confirm, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ plans: Plan[]; settings: Partial<Settings> | null; file: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState<string | null>(null);

  function exportJSON() {
    downloadFile(`نسخة-حاسبة-التقسيط-${todayISO()}.json`, JSON.stringify(buildBackup(plans, settings), null, 2), 'application/json');
    toast(`تم تصدير ${plans.length} خطة في ملف نسخة احتياطية.`);
  }

  async function onFile(f: File | undefined) {
    setError(null);
    setPending(null);
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setError('الملف كبير جداً.'); return; }
    const r = parseBackup(await f.text());
    if (!r.ok) { setError(r.error); return; }
    setPending({ plans: r.plans, settings: r.settings, file: f.name });
  }

  async function restore() {
    if (!pending) return;
    if (mode === 'replace') {
      if (!(await confirm({ title: 'استبدال جميع الخطط؟', body: `ستُحذف الخطط الحالية (${plans.length}) وتحل محلها خطط الملف (${pending.plans.length}).`, confirmText: 'متابعة', danger: true }))) return;
      if (!(await confirm({ title: 'تأكيد نهائي', body: 'لا يمكن التراجع عن الاستبدال.', confirmText: 'استبدال', danger: true }))) return;
    }
    try {
      await replacePlans(mergePlans(plans, pending.plans, mode));
      if (pending.settings) await updateSettings({ ...pending.settings, activePlanId: pending.plans[0]?.id ?? settings.activePlanId });
      toast(`تمت استعادة ${pending.plans.length} خطة بنجاح.`);
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      console.error(e);
      toast('تعذّرت الاستعادة: خطأ في التخزين المحلي.', 'error');
    }
  }

  const sameIds = pending ? pending.plans.filter((p) => plans.some((x) => x.id === p.id)).length : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <Card className="p-4 sm:p-5">
        <CardTitle icon="download">نسخة احتياطية</CardTitle>
        <p className="text-ink-2 leading-relaxed mb-4">بياناتك محفوظة على هذا الجهاز فقط ولا تُرسل لأي خادم. صدّر ملف نسخة احتياطية بانتظام واحفظه في مكان آمن (Google Drive أو البريد) لنقل الخطط إلى جهاز آخر.</p>
        <Button variant="primary" icon={<FileIcon type="json" size={20} />} onClick={exportJSON} disabled={plans.length === 0}>
          تصدير جميع الخطط ({plans.length})
        </Button>
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon="upload">استعادة من نسخة احتياطية</CardTitle>
        <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" id="restore-file" onChange={(e) => onFile(e.target.files?.[0])} />
        <label htmlFor="restore-file" className="flex items-center justify-center gap-2 h-24 rounded-2xl border-2 border-dashed border-line hover:bg-card-2 cursor-pointer font-bold text-ink-2">
          <FileIcon type="json" size={26} />اختر ملف النسخة (JSON)
        </label>
        {error && <div className="mt-3"><Notice tone="rose">{error}</Notice></div>}
        {pending && (
          <div className="grid gap-3 mt-4">
            <Notice tone="teal" icon="check">
              الملف «{pending.file}» صالح ويحتوي {pending.plans.length} خطة
              {sameIds > 0 && <> — منها {sameIds} موجودة حالياً</>}.
            </Notice>
            <ul className="text-[13.5px] text-ink-2 list-disc pr-5">{pending.plans.slice(0, 8).map((p) => <li key={p.id}>{p.name}</li>)}{pending.plans.length > 8 && <li>…</li>}</ul>
            <Segmented ariaLabel="طريقة الاستعادة" value={mode} onChange={setMode} options={[
              { value: 'merge', label: 'دمج (تحديث المتطابق)' },
              { value: 'replace', label: 'استبدال الكل' },
            ]} />
            <div className="flex gap-2 justify-end">
              <Button onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = ''; }}>إلغاء</Button>
              <Button variant={mode === 'replace' ? 'danger' : 'primary'} icon={<Icon name="upload" size={17} />} onClick={restore}>استعادة</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
