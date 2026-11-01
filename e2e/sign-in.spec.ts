import { expect, test } from '@playwright/test';

const STUB = 'http://127.0.0.1:4010';

test('tracer: sign in with GitHub and see an empty My ladders page', async ({ page, request }) => {
  await request.post(`${STUB}/__stub/user`, { data: { id: 42, login: 'octo' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/ladders$/);
  await expect(page.getByRole('heading', { name: 'My ladders' })).toBeVisible();
  await expect(page.getByText('No ladders yet')).toBeVisible();
  await expect(page.getByText('octo', { exact: true })).toBeVisible();
});

test('sign-out ends the session and /ladders redirects to /', async ({ page, request }) => {
  await request.post(`${STUB}/__stub/user`, { data: { id: 42, login: 'octo-renamed' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByText('octo-renamed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/ladders');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
});

test('access denied on GitHub shows a friendly page and no session', async ({ page, request }) => {
  await request.post(`${STUB}/__stub/deny`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in was cancelled' })).toBeVisible();
  await page.goto('/ladders');
  await expect(page).toHaveURL(/\/$/);
});
