/*
 * End-to-end check of the built playground in a real browser.
 *
 * Builds nothing: run `npm run build` first, or let this script's preview
 * server serve an existing dist/. Needs Playwright's Chromium:
 *   npx playwright install chromium
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4173);
const URL = process.env.URL ?? `http://localhost:${PORT}/`;
const OUT = process.env.SCREENSHOT_DIR ?? null;

// Start a preview server unless the caller pointed us at one already.
let server = null;
if (!process.env.URL) {
  server = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore' },
  );
  await waitForServer(URL);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`preview server never came up at ${url}`);
}

const shot = async (page, name) => {
  if (OUT) await page.screenshot({ path: join(OUT, name) });
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();

// CodeMirror only renders the visible viewport, so innerText would miss most
// of a 4000-line file. The copy button puts the whole document on the
// clipboard, which is also the path a user takes.
const outputText = async (p = page) => {
  await p.locator('button[aria-label="Copy to clipboard"]').click();
  return p.evaluate(() => navigator.clipboard.readText());
};

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// The status bar flips to a file/line summary once a conversion lands.
await page.waitForSelector('.statusbar__state--ok', { timeout: 30000 });
check('initial conversion succeeds', true);

const tabs = await page.locator('.tab--generated').allTextContents();
check('emits module.c and module.h tabs', tabs.join(',') === 'module.c,module.h', tabs.join(','));

const cOutput = await outputText();
check('C output mentions the exported function', cOutput.includes('w2c_module_add'), cOutput.slice(0, 160));
check('C output includes the generated header', cOutput.includes('#include "module.h"'));
check('C output is the full file, not just the viewport', cOutput.split('\n').length > 500, `${cOutput.split('\n').length} lines`);

const status = await page.locator('.statusbar__state').innerText();
check('status bar reports size and timing', /\d+ (module )?lines/.test(status) && /ms/.test(status), status);

await shot(page, 'light.png');

// Selection has to be visible, not merely present in the DOM: an opaque
// active-line background used to paint over it on the cursor's own line, and
// drawSelection() used to suppress the native one in the read-only pane.
// Comparing pixels before and after extending a selection is the only check
// that actually catches that.
await page.addStyleTag({
  content: '.cm-cursor, .cm-dropCursor { display: none !important }',
});

// Compare only the content area: the gutter highlights natively even when the
// text does not, which would mask the very bug this is guarding against.
async function selectionChangesContentPixels(pane, prepare, select) {
  await prepare();
  await page.waitForTimeout(120);
  const content = pane.locator('.cm-content');
  const before = await content.screenshot({ animations: 'disabled' });
  await select();
  await page.waitForTimeout(150);
  const after = await content.screenshot({ animations: 'disabled' });
  return !before.equals(after);
}

const editorPane = page.locator('.editor').first();
const outputPane = page.locator('.editor').nth(1);

// An opaque active-line background used to paint over the selection on the
// cursor's own line, so drag within one line and keep the cursor there.
{
  const line = editorPane.locator('.cm-line').nth(2);
  check(
    'selection is visible on the cursor line in the editor',
    await selectionChangesContentPixels(
      editorPane,
      () => line.click(),
      async () => {
        const box = await line.boundingBox();
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + 2 + Math.min(box.width - 4, 160), y, { steps: 8 });
        await page.mouse.up();
      },
    ),
  );
}

// drawSelection() used to suppress the browser's native selection here while
// drawing none of its own, so Select All lit up the gutter and nothing else.
check(
  'selection is visible in the output pane',
  await selectionChangesContentPixels(
    outputPane,
    () => outputPane.locator('.cm-line', { hasText: '#include' }).first().click(),
    () => page.keyboard.press('ControlOrMeta+a'),
  ),
);

check(
  'active line stays translucent so it cannot mask the selection',
  await page.evaluate(() => {
    const el = document.querySelector('.cm-editor .cm-activeLine');
    const bg = el && getComputedStyle(el).backgroundColor;
    return Boolean(bg && /rgba\([^)]*,\s*0?\.\d+\s*\)/.test(bg));
  }),
);

// Focus mode: the scaffolding folds away behind placeholders.
const folds = await page.locator('.fold-placeholder').allTextContents();
check('scaffolding is folded by default', folds.length === 2, folds.join(' | '));
check('placeholder names the runtime declarations', folds.some((f) => /wasm2c runtime declarations/.test(f)), folds.join(' | '));
check('placeholder counts the hidden lines', folds.some((f) => /7\d\d lines/.test(f)), folds.join(' | '));
const visibleLines = await page.locator('.editor').nth(1).locator('.cm-line').count();
check('focused view is short enough to read', visibleLines < 80, `${visibleLines} rendered lines`);
check('status bar reports the split', /module lines .*scaffolding hidden/.test(await page.locator('.statusbar__state').innerText()));
check('copy still yields the whole file', (await outputText()).split('\n').length > 700);

// Expanding one placeholder restores its lines.
await page.locator('.fold-placeholder', { hasText: 'runtime declarations' }).click();
await page.waitForTimeout(150);
check('clicking a placeholder expands it', await page.locator('.fold-placeholder').count() === 1);

// The toggle turns the whole thing off and back on.
const focusToggle = page.locator('button[aria-label="Hide wasm2c scaffolding"]');
await focusToggle.click();
await page.waitForTimeout(150);
check('toggle shows the full file', await page.locator('.fold-placeholder').count() === 0);
await focusToggle.click();
await page.waitForTimeout(150);
check('toggle folds it back', await page.locator('.fold-placeholder').count() === 2);
await shot(page, 'focus.png');

// Switch to the .h tab.
await page.locator('.tab', { hasText: 'module.h' }).click();
const hOutput = await outputText();
check('header declares the instance struct', /struct w2c_module/.test(hOutput));
check('header pulls in the wasm-rt runtime', hOutput.includes('wasm-rt.h'));

// Type an error and confirm the diagnostics path.
await page.locator('.editor').first().click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('(module (func (result i32) i64.const 0))');
await page.waitForSelector('.errors', { timeout: 15000 });
const errorText = await page.locator('.errors__body').innerText();
check('type error is shown in the error panel', /type mismatch/.test(errorText), errorText.split('\n')[0]);
check('error panel keeps wabt caret alignment', errorText.includes('^'));
const marked = await page.locator('.cm-lintRange-error').count();
check('error is underlined in the editor', marked > 0, `${marked} ranges`);
check('last good output stays visible while broken', await page.locator('.output--stale').count() === 1);
check('stale badge is shown', await page.locator('.pane__stale').count() === 1);
await shot(page, 'error.png');

// Recover.
await page.locator('.editor').first().click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('(module (func (export "sq") (param i32) (result i32) local.get 0 local.get 0 i32.mul))');
await page.waitForSelector('.statusbar__state--ok', { timeout: 15000 });
const recovered = await outputText();
check('recovers after fixing the error', recovered.includes('w2c_module_sq'), recovered.slice(0, 160));

// Options: module name should rename symbols and tabs.
await page.locator('button:has-text("Options")').click();
const nameInput = page.locator('.field__input[type="text"]');
await nameInput.fill('demo');
await page.waitForSelector('.tab:has-text("demo.c")', { timeout: 15000 });
check('module name renames the tabs', true);
await page.keyboard.press('Escape');
const renamed = await outputText();
check('module name prefixes the symbols', renamed.includes('w2c_demo'), renamed.slice(0, 160));

// Multi-output.
await page.locator('button:has-text("Options")').click();
await page.locator('.field__input[type="number"]').fill('3');
await page.waitForSelector('.tab:has-text("demo-impl.h")', { timeout: 15000 });
const multiTabs = await page.locator('.tab--generated').allTextContents();
check('multi-output splits the .c files', multiTabs.join(',') === 'demo_0.c,demo_1.c,demo_2.c,demo.h,demo-impl.h', multiTabs.join(','));
await page.locator('.field__input[type="number"]').fill('1');
await page.keyboard.press('Escape');

// Examples menu.
await page.locator('button:has-text("Examples")').click();
await page.locator('.menu__item:has-text("Table and call_indirect")').click();
await page.waitForSelector('.statusbar__state--ok', { timeout: 15000 });
const watText = await page.locator('.editor').first().innerText();
check('example loads into the editor', watText.includes('call_indirect'), watText.slice(0, 120));

// Dark theme.
await page.locator('.button--icon[title^="Theme"]').click();
await page.locator('.button--icon[title^="Theme"]').click();
const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('theme toggle reaches dark', themeAttr === 'dark', String(themeAttr));
await shot(page, 'dark.png');

// Share link round-trip.
await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {}));
await page.locator('button:has-text("Share")').click();
await page.waitForFunction(() => window.location.hash.length > 3, null, { timeout: 5000 });
const shareUrl = page.url();
check('share writes a fragment', shareUrl.includes('#'), shareUrl.slice(0, 80));
const fresh = await context.newPage();
await fresh.goto(shareUrl, { waitUntil: 'domcontentloaded' });
await fresh.waitForSelector('.statusbar__state--ok', { timeout: 30000 });
const restoredWat = await fresh.locator('.editor').first().innerText();
check('shared link restores the module', restoredWat.includes('call_indirect'), restoredWat.slice(0, 120));
await fresh.close();

// Runtime sources, and following a symbol into them. This is the whole point:
// generated C names types like wasm_rt_funcref_table_t that wasm2c never emits.
// An earlier check renamed the module; put it back so the tab names are the
// defaults this block expects.
await page.locator('button:has-text("Options")').click();
await page.locator('.field__input[type="text"]').fill('module');
await page.keyboard.press('Escape');
await page.locator('button:has-text("Examples")').click();
await page.locator('.menu__item:has-text("Table and call_indirect")').click();
await page.waitForSelector('.tab:has-text("module.c")', { timeout: 15000 });
await page.waitForSelector('.statusbar__state--ok', { timeout: 15000 });

const allTabs = await page.locator('.tab').allTextContents();
check('runtime sources appear as tabs', allTabs.includes('wasm-rt.h'), allTabs.join(','));
check(
  'generated files still come first',
  allTabs.indexOf('module.c') < allTabs.indexOf('wasm-rt.h'),
  allTabs.join(','),
);
check(
  'exception runtime is hidden while the feature is off',
  !allTabs.includes('wasm-rt-exceptions.h'),
  allTabs.join(','),
);

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/*
 * Click the word itself. A .cm-line box spans the whole pane, so estimating a
 * character width from it lands on the indent; measuring the text node with a
 * Range gives the real rectangle.
 */
async function followFrom(tabName, matchText, word) {
  await page.locator('.tab', { hasText: tabName }).first().click();
  await page.waitForTimeout(250);
  const pane = page.locator('.editor').nth(1);
  await pane.locator('.cm-line', { hasText: matchText }).first().scrollIntoViewIfNeeded();

  const point = await pane.locator('.cm-content').evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const at = node.textContent.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const box = range.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    }
    return null;
  }, word);
  if (!point) return `could not locate "${word}"`;

  await page.keyboard.down(modifier);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up(modifier);
  await page.waitForTimeout(400);
  return page.locator('.tab--active').first().innerText();
}

// module.h line 28 is `wasm_rt_funcref_table_t w2c_T0;`
const landedOn = await followFrom('module.h', 'wasm_rt_funcref_table_t', 'wasm_rt_funcref_table_t');
check('following a wasm_rt type opens wasm-rt.h', landedOn === 'wasm-rt.h', landedOn);
check(
  'it lands on the definition, not the top of the file',
  await page.evaluate(() => {
    const flash = document.querySelector('.cm-jumpFlash');
    return flash ? flash.textContent.includes('wasm_rt_funcref_table_t') : false;
  }),
  await page.locator('.cm-jumpFlash').first().innerText().catch(() => 'no flashed line'),
);

// Following an #include should open that file too.
const includeLanded = await followFrom('module.c', '#include "module.h"', 'module.h');
check('following an #include opens that file', includeLanded === 'module.h', includeLanded);

// The draft survives a reload, and a shared link still outranks it.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.statusbar__state--ok', { timeout: 30000 });
await page.locator('.editor').first().click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('(module (func (export "persisted") (result i32) i32.const 4242))');
await page.locator('button:has-text("Options")').click();
await page.locator('.field__input[type="text"]').fill('kept');
await page.keyboard.press('Escape');
await page.waitForSelector('.tab:has-text("kept.c")', { timeout: 15000 });
await page.waitForTimeout(800); // outlast the save debounce

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.statusbar__state--ok', { timeout: 30000 });
const afterReload = await page.locator('.editor').first().innerText();
check('WAT survives a reload', afterReload.includes('persisted'), afterReload.slice(0, 120));
check(
  'options survive a reload',
  (await page.locator('.tab').first().innerText()) === 'kept.c',
  await page.locator('.tab').first().innerText(),
);
check('reloaded module still converts', (await outputText()).includes('w2c_kept_persisted'));

await page.goto(shareUrl, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.statusbar__state--ok', { timeout: 30000 });
const overDraft = await page.locator('.editor').first().innerText();
check(
  'a shared link outranks the saved draft',
  overDraft.includes('call_indirect') && !overDraft.includes('persisted'),
  overDraft.slice(0, 120),
);

// Narrow viewport.
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 390px', overflow <= 0, `${overflow}px`);
await shot(page, 'mobile.png');

console.log();
if (problems.length) {
  console.log('page problems:');
  for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
}
await browser.close();
server?.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
