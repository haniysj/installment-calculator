"""Old data with a duplicated month (from the removed 'postpone') is repaired on load; no postpone button."""
import re, sys, json
from playwright.sync_api import sync_playwright, expect
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.goto(B + '/#/new')
    pg.fill('#name', 'قرض'); pg.fill('#principal', '3000'); pg.fill('#firstDate', '25/03/2026'); pg.fill('#fixed', '300')
    pg.get_by_role('button', name='حفظ الخطة').click(); pg.wait_for_url(re.compile('#/plan/')); url = pg.url
    # break the stored plan like the old postpone did: rows 2.. shifted one month, row 4 stays
    pg.evaluate("""() => new Promise((res, rej) => {
      const open = indexedDB.open('installment-calculator');
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('plans', 'readwrite'); const st = tx.objectStore('plans');
        st.getAll().onsuccess = (e) => {
          const plan = e.target.result[0];
          plan.installments.forEach((r, k) => { if (k >= 2 && k !== 4) { const [y, m] = r.dueDate.split('-').map(Number); const n = new Date(y, m, 25); r.dueDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-25`; } });
          st.put(plan); tx.oncomplete = () => res(true);
        };
      };
      open.onerror = rej;
    })""")
    pg.reload(); pg.wait_for_timeout(1500)
    months = pg.evaluate("""() => new Promise((res) => {
      const open = indexedDB.open('installment-calculator');
      open.onsuccess = () => { open.result.transaction('plans').objectStore('plans').getAll().onsuccess = (e) =>
        res(e.target.result[0].installments.filter(r => !r.cancelled).map(r => r.dueDate.slice(0, 7))); };
    })""")
    assert len(months) == len(set(months)), f'duplicate months after repair: {months}'
    print('months', months)
    # installment editor: no postpone, skip remains
    pg.locator('ul li button').filter(has_text='القسط 3').first.click()
    pg.get_by_role('radio', name='المزيد').click()
    expect(pg.get_by_role('button', name='تخطي القسط')).to_be_visible()
    assert pg.get_by_text('تأجيل شهراً').count() == 0
    assert pg.get_by_role('button', name='حذف القسط').count() == 0
    pg.screenshot(path=f'{OUT}/months-editor.png')
    pg.get_by_role('button', name='تخطي القسط').click()
    pg.get_by_role('dialog').last.get_by_role('button', name='تخطي').click()
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{OUT}/months-after-skip.png', full_page=True)
    b.close()
print('MONTHS OK')
