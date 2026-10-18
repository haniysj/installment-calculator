"""End-to-end check of the production build (run `npm run build && npm run preview` first).

Usage: python3 e2e/e2e.py [base_url] [screenshot_dir]
Covers: create a fixed plan, verify the 1,000 / 150 example, record a payment, edit an installment,
export CSV, reload persistence, and offline loading through the service worker.
"""
import sys, os, re
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
os.makedirs(OUT, exist_ok=True)
errors = []

def shot(page, name):
    page.screenshot(path=f'{OUT}/{name}.png', full_page=True)

def run(width, height, tag, mobile):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': width, 'height': height}, device_scale_factor=2 if mobile else 1,
                            is_mobile=mobile, has_touch=mobile, locale='ar', accept_downloads=True)
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(f'[{tag}] {m.text}'))
        page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror {e}'))
        page.goto(BASE + '/#/')
        expect(page.get_by_text('لا توجد خطط تقسيط بعد')).to_be_visible()
        shot(page, f'{tag}-01-empty')

        # create the plan
        page.goto(BASE + '/#/new')
        page.fill('#name', 'سيارة العائلة')
        page.fill('#principal', '1000')
        page.fill('#fixed', '150')
        expect(page.get_by_text('ثم قسط أخير')).to_be_visible()
        shot(page, f'{tag}-02-new')
        page.get_by_role('button', name='حفظ الخطة').click()
        page.wait_for_url(re.compile(r'#/plan/'))
        expect(page.get_by_role('heading', name='سيارة العائلة')).to_be_visible()
        body = page.inner_text('body')
        assert 'القسط الأخير' in body
        shot(page, f'{tag}-03-plan')

        # change fixed amount → recalculation (300 → 4 installments)
        page.fill('#pc-fixed', '300')
        page.wait_for_timeout(1200)
        expect(page.get_by_text('تم تحديث القسط الثابت').first).to_be_visible()
        page.fill('#pc-fixed', '150')
        page.wait_for_timeout(1200)

        # record payment for installment 1 from the payments screen
        plan_url = page.url
        page.goto(plan_url + '/payments')
        page.get_by_role('button', name='حفظ الدفعة').click()
        expect(page.get_by_text('تم تسجيل القسط كمدفوع').first).to_be_visible()
        shot(page, f'{tag}-04-payments')

        # partial payment on installment 2 (100 of 150), keep open
        page.fill('#pay-amt', '100')
        page.get_by_role('button', name='حفظ الدفعة').click()
        expect(page.get_by_text('دفعة جزئية').first).to_be_visible()

        # dashboard numbers
        page.goto(BASE + '/#/')
        page.wait_for_timeout(1000)  # number ticker animation
        txt = page.inner_text('main')
        assert '250' in txt and '750' in txt and '.000' not in txt, txt[:500]
        shot(page, f'{tag}-05-dashboard')

        # CSV export
        with page.expect_download() as d:
            page.get_by_role('button', name='تصدير الجدول').click()
        path = d.value.path()
        csv = open(path, encoding='utf-8-sig').read()
        assert 'سيارة العائلة' in csv and ',100,' in csv

        # open the schedule and an installment editor
        page.goto(plan_url)
        if mobile:
            page.locator('ul li button').filter(has_text='القسط 3').first.click()
        else:
            page.get_by_role('button', name='إجراءات').nth(2).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        shot(page, f'{tag}-06-row-editor')
        page.get_by_role('radio', name='تعديل المبلغ').click()
        page.fill('#re-plan', '400')
        page.get_by_role('button', name='حفظ وإعادة الحساب').click()
        expect(page.get_by_text('إعادة حساب الأقساط اللاحقة').first).to_be_visible()
        shot(page, f'{tag}-07-after-edit')

        # persistence + offline
        page.reload()
        expect(page.get_by_role('heading', name='سيارة العائلة')).to_be_visible()
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_timeout(1500)
        ctx.set_offline(True)
        page.reload()
        expect(page.get_by_role('heading', name='سيارة العائلة')).to_be_visible()
        expect(page.get_by_text('غير متصل')).to_be_visible()
        shot(page, f'{tag}-08-offline')
        page.goto(BASE + '/#/new')
        page.fill('#principal', '500')
        page.fill('#fixed', '200')
        page.get_by_role('button', name='حفظ الخطة').click()
        page.wait_for_url(re.compile(r'#/plan/'))
        expect(page.get_by_role('heading', name='خطة جديدة')).to_be_visible()

        # dark theme check
        ctx.set_offline(False)
        page.goto(BASE + '/#/settings')
        page.get_by_role('radio', name='داكن').click()
        page.goto(plan_url)
        shot(page, f'{tag}-09-dark')
        b.close()
        print(f'{tag}: OK')

run(390, 844, 'phone', True)
run(1280, 900, 'desktop', False)
if errors:
    print('Console errors:'); print('\n'.join(errors)); sys.exit(1)
print('ALL E2E CHECKS PASSED')
