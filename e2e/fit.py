"""Every screen and dialog must fit the phone width (no horizontal overflow, dialogs inside the viewport)."""
import re, sys
from playwright.sync_api import sync_playwright
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
W = int(sys.argv[3]) if len(sys.argv) > 3 else 360
H = int(sys.argv[4]) if len(sys.argv) > 4 else 740
problems = []
CHECK = """(name) => {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const out = [];
  if (document.documentElement.scrollWidth > vw + 1) out.push(`${name}: page scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  const dlg = document.querySelector('[role=dialog]');
  if (dlg) { const r = dlg.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) out.push(`${name}: dialog ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} vs ${vw}x${vh}`);
    if (dlg.scrollWidth > dlg.clientWidth + 1) out.push(`${name}: dialog content overflows ${dlg.scrollWidth}>${dlg.clientWidth}`); }
  for (const el of document.querySelectorAll('main *, [role=dialog] *')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('.overflow-x-auto')) {
      out.push(`${name}: ${el.tagName}.${(el.className||'').toString().slice(0,60)} ${Math.round(r.left)}..${Math.round(r.right)}`); if (out.length > 8) break; }
  }
  return out;
}"""
def main():
  with sync_playwright() as p:
      b = p.chromium.launch()
      ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=True, has_touch=True)
      pg = ctx.new_page()
      def check(name):
          pg.wait_for_timeout(400)
          problems.extend(pg.evaluate(CHECK, name))
          pg.screenshot(path=f'{OUT}/fit-{W}-{name}.png')
      pg.goto(B + '/#/new')
      pg.fill('#name', 'سيارة العائلة الجديدة'); pg.fill('#principal', '12500'); pg.fill('#firstDate', '25/03/2026'); pg.fill('#fixed', '350')
      pg.get_by_role('button', name='حفظ الخطة').click(); pg.wait_for_url(re.compile('#/plan/')); url = pg.url
      pg.goto(B + '/#/'); pg.wait_for_timeout(800); check('dashboard')
      pg.locator('main button', has_text='تسجيل دفعة').first.click(); pg.wait_for_timeout(600); check('payments-from-dashboard')
      pg.get_by_role('button', name='حفظ الدفعة').click(); pg.wait_for_timeout(500)
      pg.get_by_role('radio', name='دفعة إضافية').click(); check('payments-extra')
      pg.get_by_role('button', name='تعديل الدفعة').first.click(); check('payment-editor')
      pg.keyboard.press('Escape')
      pg.goto(url); pg.wait_for_timeout(800); check('plan')
      pg.get_by_role('button', name='إعادة تسمية الخطة').click(); check('rename'); pg.keyboard.press('Escape')
      pg.locator('ul li button').filter(has_text='القسط 2').first.click(); check('row-pay')
      pg.get_by_role('radio', name='تعديل المبلغ').click(); check('row-edit')
      pg.get_by_role('radio', name='المزيد').click(); check('row-more')
      pg.keyboard.press('Escape')
      pg.get_by_role('button', name='المزيد من الإجراءات').click(); check('menu')
      for path in ['/plans', '/backup', '/settings', '/new']:
          pg.goto(B + '/#' + path); check(path.strip('/'))
      b.close()
try:
    main()
except Exception as e:
    problems.append('STOPPED: ' + str(e).split('\n')[0])
print('\n'.join(problems) if problems else f'FIT OK at {W}px')
sys.exit(1 if problems else 0)
