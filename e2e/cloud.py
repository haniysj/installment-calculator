"""Cloud saving end-to-end: two phones, a wiped phone, offline edits. Run against scripts/local-server.mjs."""
import re, sys
from playwright.sync_api import sync_playwright, expect
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4180'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
errs = []

def phone(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return ctx, pg

def login(pg, mode, pin):
    pg.goto(B + '/#/backup')
    pg.wait_for_selector('#cl-pin')
    pg.fill('#cl-pin', pin)
    if mode == 'setup':
        pg.fill('#cl-pin2', pin)
        pg.get_by_role('button', name='تعيين الرمز وتفعيل الحفظ').click()
    else:
        pg.get_by_role('button', name='دخول').click()

with sync_playwright() as p:
    b = p.chromium.launch()
    # ── phone A: plan first, then turn on cloud saving
    ca, a = phone(b)
    a.goto(B + '/#/new')
    a.fill('#name', 'سيارة'); a.fill('#principal', '3000'); a.fill('#firstDate', '25/09/2026'); a.fill('#fixed', '300')
    a.get_by_role('button', name='حفظ الخطة').click(); a.wait_for_url(re.compile('#/plan/'))
    a.goto(B + '/#/'); expect(a.get_by_text('خططك محفوظة على هذا الجهاز فقط')).to_be_visible()
    a.screenshot(path=f'{OUT}/cloud-01-reminder.png')
    a.goto(B + '/#/backup'); a.wait_for_selector('#cl-pin2')  # first time: choose a code (with confirmation)
    login(a, 'setup', '246810')
    expect(a.get_by_text('محفوظ سحابياً').first).to_be_visible(timeout=10000)
    a.screenshot(path=f'{OUT}/cloud-02-connected.png', full_page=True)
    # another phone only gets "enter code" (no second setup), and a wrong code is refused with attempts left
    cx, x = phone(b); x.goto(B + '/#/backup'); x.wait_for_selector('#cl-pin')
    assert x.locator('#cl-pin2').count() == 0, 'no setup once a code exists'
    login(x, 'unlock', '000000')
    expect(x.get_by_text('بقيت 4 محاولات').first).to_be_visible()
    x.screenshot(path=f'{OUT}/cloud-05-wrong-code.png')
    cx.close()

    # ── phone B: new phone, sign in → plan comes back
    cb, bp = phone(b)
    bp.goto(B + '/#/'); expect(bp.get_by_role('button', name='لدي رمز سري — استرجاع خططي')).to_be_visible()
    login(bp, 'unlock', '246810')
    expect(bp.get_by_text('محفوظ سحابياً').first).to_be_visible(timeout=10000)
    bp.goto(B + '/#/plans'); expect(bp.get_by_text('سيارة').first).to_be_visible()

    # B records a payment → A sees it after sync
    bp.goto(B + '/#/'); bp.wait_for_timeout(600)
    bp.locator('main button', has_text='تسجيل دفعة').first.click()
    bp.get_by_role('button', name='حفظ الدفعة').click(); bp.wait_for_timeout(2500)
    a.goto(B + '/#/backup'); a.get_by_role('button', name='حفظ الآن').click(); a.wait_for_timeout(1500)
    a.goto(B + '/#/'); a.wait_for_timeout(1200)
    assert '2,700' in a.inner_text('main'), 'A should see the payment made on B'

    # B offline: edits stay on the phone, upload when back online
    cb.set_offline(True)
    bp.goto(B + '/#/'); bp.wait_for_timeout(500)
    bp.locator('main button', has_text='تسجيل دفعة').first.click()
    bp.get_by_role('button', name='حفظ الدفعة').click(); bp.wait_for_timeout(2000)
    bp.goto(B + '/#/backup'); expect(bp.get_by_text('بدون إنترنت').first).to_be_visible()
    bp.screenshot(path=f'{OUT}/cloud-03-offline.png')
    cb.set_offline(False); bp.wait_for_timeout(3500)
    expect(bp.get_by_text('محفوظ سحابياً').first).to_be_visible(timeout=10000)

    # ── phone A wiped (all browser data gone) → sign in → everything is back
    ca.close()
    cw, w = phone(b)
    w.goto(B + '/#/'); expect(w.get_by_text('لا توجد خطط تقسيط بعد')).to_be_visible()
    login(w, 'unlock', '246810')
    expect(w.get_by_text('محفوظ سحابياً').first).to_be_visible(timeout=10000)
    w.goto(B + '/#/'); w.wait_for_timeout(1200)
    t = w.inner_text('main')
    assert 'سيارة' in t and '2,400' in t, t[:300]
    w.screenshot(path=f'{OUT}/cloud-04-restored.png')

    # deleting on one phone removes it on the other
    w.goto(B + '/#/plans'); w.get_by_role('button', name='حذف').first.click()
    w.get_by_role('dialog').get_by_role('button', name='حذف نهائي').click(); w.wait_for_timeout(2500)
    bp.goto(B + '/#/backup'); bp.get_by_role('button', name='حفظ الآن').click(); bp.wait_for_timeout(1500)
    bp.goto(B + '/#/plans'); expect(bp.get_by_text('لا توجد خطط محفوظة')).to_be_visible()

    # sign out keeps local data and stops cloud
    bp.goto(B + '/#/backup'); bp.get_by_role('button', name='إيقاف على هذا الجهاز').click()
    bp.get_by_role('dialog').get_by_role('button', name='إيقاف').click()
    expect(bp.get_by_text('غير مفعّل').first).to_be_visible()
    b.close()
if errs: print('\n'.join(errs)); sys.exit(1)
print('CLOUD OK')
