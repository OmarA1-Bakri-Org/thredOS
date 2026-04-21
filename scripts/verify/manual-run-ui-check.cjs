const { chromium, request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4302';
  const outDir = path.join(process.cwd(), 'test-results', 'manual-ui-check');
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, 'run-section-after-dispatch.png');

  const api = await request.newContext({ baseURL });
  const loginRes = await api.post('/api/auth/login', {
    data: {
      email: process.env.THREDOS_VERIFY_EMAIL || 'verifier@thredos.local',
      password: process.env.THREDOS_VERIFY_PASSWORD || 'thredos-verify-password',
      next: '/app',
    },
  });
  if (!loginRes.ok()) {
    throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const storageState = await api.storageState();
  await api.dispose();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL, storageState });
  const page = await context.newPage();

  const consoleMessages = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', res => {
    if (res.status() >= 400) {
      failedResponses.push({ url: res.url(), status: res.status(), method: res.request().method() });
    }
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-workbench-region="top-bar"]', { timeout: 120000 });
  await page.waitForSelector('[data-workbench-region="accordion-panel"]', { timeout: 120000 });
  await page.waitForSelector('[data-testid="topbar-status-summary"]', { timeout: 120000 });

  await page.locator('[data-workbench-region="accordion-panel"]').getByRole('button', { name: 'RUN' }).first().click();
  await page.getByTestId('run-section').waitFor({ timeout: 30000 });

  await page.getByRole('button', { name: 'Run all', exact: true }).click();
  await page.getByTestId('confirm-dialog').waitFor({ timeout: 30000 });

  const runResponsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/run') && response.request().method() === 'POST',
    { timeout: 120000 }
  );
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Run all' }).click();
  const runResponse = await runResponsePromise;
  const runJson = await runResponse.json().catch(() => null);

  await page.getByTestId('run-control-plane').waitFor({ timeout: 120000 });
  await page.waitForTimeout(3000);

  const summary = {
    url: page.url(),
    runResponseStatus: runResponse.status(),
    runResponseBody: runJson,
    traceCount: await page.getByTestId('run-trace-count').textContent(),
    approvalCount: await page.getByTestId('run-approval-count').textContent(),
    traceCards: await page.locator('[data-testid="run-trace-events"] >> .border.border-slate-800').allTextContents().catch(() => []),
    approvalCards: await page.locator('[data-testid="run-approval-events"] >> .border.border-slate-800').allTextContents().catch(() => []),
    consoleMessages,
    pageErrors,
    failedResponses,
  };

  await page.screenshot({ path: screenshotPath, fullPage: true });
  fs.writeFileSync(path.join(outDir, 'run-section-after-dispatch.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({ screenshotPath, summaryPath: path.join(outDir, 'run-section-after-dispatch.json'), summary }, null, 2));

  await browser.close();
})();
