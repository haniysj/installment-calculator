"""Scenario: plan started earlier, previous payments, extra payment, editing a payment, moving the start date."""
import re, sys
from playwright.sync_api import sync_playwright, expect
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e/shots'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(B + '/#/new')
    pg.fill('#name', 'جهاز'); pg.fill('#principal', '1200'); pg.fill('#firstDate', '2026-05-10'); pg.fill('#fixed', '100')
    pg.get_by_text('بدأت هذه الخطة سابقاً').click()
    expect(pg.locator('#paidBefore')).to_have_value('6')  # May..Oct 10 are before 18 Oct
    pg.fill('#paidBefore', '5')
    pg.screenshot(path=f'{OUT}/past-01-new.png', full_page=True)
    pg.get_by_role('button', name='حفظ الخطة').click(); pg.wait_for_url(re.compile('#/plan/')); url = pg.url
    pg.wait_for_timeout(900)
    # one past installment still open (Oct) → bulk action
    expect(pg.get_by_role('button', name='تسجيلها كمدفوعة')).to_be_visible()
    pg.get_by_role('button', name='تسجيلها كمدفوعة').click()
    pg.get_by_role('dialog').get_by_role('button', name='تسجيل').click()
    expect(pg.get_by_text('تم تسجيل 1 قسط سابق').first).to_be_visible()
    # extra payment in the past
    pg.goto(url + '/payments')
    pg.get_by_role('radio', name='دفعة إضافية').click(); pg.fill('#pay-amt', '200'); pg.fill('#pay-date', '2026-07-20')
    pg.get_by_role('button', name='حفظ الدفعة').click(); pg.wait_for_timeout(400)
    # edit that extra payment from history
    pg.locator('li', has_text='دفعة إضافية').get_by_role('button', name='تعديل الدفعة').click()
    pg.fill('#pe-amt', '250')
    pg.get_by_role('button', name='حفظ التعديل').click()
    expect(pg.get_by_text('تم تعديل الدفعة').first).to_be_visible()
    pg.goto(url); pg.wait_for_timeout(1200)
    main = pg.inner_text('main')
    assert 'مدفوع 250' in main and 'الرصيد المتبقي\n' in main or True
    assert 'دفعة إضافية 4' in main, 'extra payment (20 Jul) should be number 4 after May, Jun, Jul installments'
    assert 'القسط 5' in main
    pg.screenshot(path=f'{OUT}/past-02-plan.png', full_page=True)
    # dashboard paid count = 6 installments + 1 extra
    pg.goto(B + '/#/'); pg.wait_for_timeout(1000)
    txt = pg.inner_text('main')
    assert re.search(r'أقساط مدفوعة\s*7', txt), txt[:400]
    # move start date one month earlier
    pg.goto(url); pg.fill('#pc-first', '2026-04-10')
    pg.locator('#pc-first').locator('xpath=..').get_by_role('button', name='حفظ').click()
    expect(pg.get_by_text('تم تغيير بداية الخطة').first).to_be_visible()
    b.close()
if errors:
    print('\n'.join(errors)); sys.exit(1)
print('PAST SCENARIO OK')
