import { expect, test } from '@playwright/test';

const phone = process.env.E2E_PHONE;
const password = process.env.E2E_PASSWORD;

test('browse, add to cart, log in, place a cash-on-delivery order', async ({ page }) => {
  test.skip(!phone || !password, 'Set E2E_PHONE and E2E_PASSWORD to a customer account on the stack under test');

  await page.goto('/');
  await expect(page.getByText('Attack Shark X11 White').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add Attack Shark X11 White' }).first().click();
  await expect(page.getByRole('button', { name: /Cart, 1 items/ })).toBeVisible();

  await page.goto('/checkout');
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout/);
  await page.getByLabel('Phone number').fill(phone!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Delivery location').selectOption('PHNOM_PENH');
  await page.getByLabel('Delivery service').selectOption('VET');
  await page.getByLabel('Address / note for the driver').fill('E2E smoke test, St. 315');
  const place = page.getByRole('button', { name: 'Place order' });
  await expect(place).toBeEnabled();
  await place.click();

  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
  await expect(page.getByText(/^CS-\d{6}$/)).toBeVisible();
});
