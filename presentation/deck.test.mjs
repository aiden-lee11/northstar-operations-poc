import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('./slides.js', import.meta.url), 'utf8');

function openDeck(t, hash = '') {
  const dom = new JSDOM(html, {
    // jsdom rejects file: history.replaceState; exercise file-opened behavior in Chrome.
    url: 'https://presentation.test/' + hash,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  const { document } = dom.window;
  const key = (value, options = {}, target = document.activeElement) => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  };
  return { window: dom.window, document, key, visible: () => [...document.querySelectorAll('.slide')].filter(slide => !slide.hidden) };
}

test('keeps the assessor note plain and focused on scope with two architecture paragraphs', async t => {
  const content = await readFile(new URL('../docs/key-decisions.html', import.meta.url), 'utf8');
  const dom = new JSDOM(content);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const text = document.querySelector('main').textContent;
  assert.match(text, /two-hour build allowance/);
  assert.match(text, /rather than an end-to-end KYC system/);
  assert.match(text, /lightweight tools with manageable integration and maintenance needs/);
  assert.equal(document.getElementById('context-title'), null);
  assert.match(text, /small local demo and is nowhere near production-ready/);
  assert.match(text, /not been connected to or tested against real external APIs/);
  assert.match(text, /does not demonstrate regulatory compliance/);
  assert.match(text, /not proof that a production flag platform is lightweight/);
  assert.equal(document.querySelectorAll('#architecture > p').length, 2);
  assert.equal(document.querySelector('svg, table, .flow, .eyebrow'), null);
  for (const element of document.querySelectorAll('main, h1, h2, p, a')) {
    assert.equal(dom.window.getComputedStyle(element).color, 'rgb(0, 0, 0)');
  }
});

test('opens one slide, has five slides and speaker notes for each', t => {
  const { document, visible } = openDeck(t);
  assert.equal(document.querySelectorAll('.slide').length, 5);
  assert.equal(visible().length, 1);
  assert.equal(visible()[0].dataset.title, 'Recommendation');
  assert.equal(document.getElementById('previous').disabled, true);
  assert.equal(document.getElementById('notes-panel').hidden, true);
  assert.equal(document.getElementById('sources-panel').hidden, true);
  for (const slide of document.querySelectorAll('.slide')) {
    assert.ok(slide.querySelector('.speaker-notes').content.textContent.trim());
    assert.ok(slide.querySelector('[tabindex="-1"]'));
  }
});

test('recommends selective custom development while retaining working Power Apps', t => {
  const { document } = openDeck(t);
  const recommendation = document.querySelector('.title-slide');
  assert.match(document.getElementById('slide-title-1').textContent, /Keep what works.*Pilot Devin.*For one month/);
  assert.match(recommendation.textContent, /Reserve rebuilds for bounded tools/);
  assert.match(recommendation.textContent, /manageable integration and maintenance needs/);
  assert.match(recommendation.textContent, /Retain all three working production Power Apps applications initially/);
  const notes = recommendation.querySelector('.speaker-notes').content.textContent;
  assert.match(notes, /Keep Power Apps if it meets the needs/);
  assert.match(notes, /build allowance was two hours/);
  assert.match(notes, /not an end-to-end KYC system/);
  assert.match(notes, /not a claim that production feature flags are inherently simple/);
  assert.match(document.querySelector('.vendor').textContent, /Customize.*citizen development.*runtime and connectors.*governance/s);
  assert.match(document.querySelectorAll('.vendor')[1].textContent, /Coding and cloud agents/);
  assert.match(document.querySelector('.spend-line').textContent, /~60 engineers.*brief inputs, not audited/);
});

test('demonstrates only feature flag admin and its backend-driven synthetic consumer', t => {
  const { document } = openDeck(t);
  const demo = document.querySelector('.demo-slide');
  assert.deepEqual([...demo.querySelectorAll('[data-workflow]')].map(card => card.dataset.workflow), ['flags', 'preview']);
  assert.doesNotMatch(demo.textContent, /refund/i);
  assert.doesNotMatch(html, /#refunds/);
  assert.match(demo.textContent, /standalone synthetic reference implementation/);
  assert.match(demo.textContent, /Review → Evaluate → Experience → Roll back/);
  assert.match(demo.textContent, /Synthetic checkout.*no money.*backend-sourced decision/);
  assert.match(demo.textContent, /not an integration/);
  assert.match(demo.textContent, /No deployed flag platform/);
  assert.match(demo.textContent, /Feasibility, not customer fit or ROI/);
  assert.deepEqual([...document.querySelectorAll('[data-demo-link]')].map(link => link.href), [
    'http://127.0.0.1:8000/#flags',
    'http://127.0.0.1:8000/#preview',
  ]);
});

test('preserves a reproducible Staging cohort demo and accurate Cloud provenance', t => {
  const { document } = openDeck(t);
  const demo = document.querySelector('.demo-slide');
  const notes = demo.querySelector('.speaker-notes').content;
  assert.match(notes.textContent, /BOTH views to Staging; disable new_checkout_flow first/);
  assert.match(notes.textContent, /Cedar Test Account \(bucket 1,543\).*inside the 25% cohort/);
  assert.match(notes.textContent, /Aurora Test Account \(bucket 9,289\).*outside/);
  const steps = [...notes.querySelectorAll('ol li')].map(step => step.textContent);
  assert.equal(steps.length, 5);
  assert.match(steps[0], /disabled: old checkout/);
  assert.match(steps[1], /enable at 25%.*Enable the synthetic pilot/);
  assert.match(steps[2], /backend decision trace; refresh.*stable identity/);
  assert.match(steps[3], /100% with reason/);
  assert.match(steps[4], /roll back to 25%.*Aurora: old; Cedar: new.*new rollback history event/);
  assert.match(notes.textContent, /State and history reset on server restart/);
  assert.match(notes.textContent, /baseline was built locally with Devin.*extension was delegated to Cloud, followed by local visual polish/);
  assert.ok(demo.querySelector('a[href="https://github.com/aiden-lee11/northstar-operations-poc/pull/1"]'));
  assert.ok(notes.querySelector('a[href="https://app.devin.ai/sessions/5d7c24a6d0e64fedac1df5cbee9181a4"]'));
  assert.doesNotMatch(html, /X-Amz-|X-Goog-|presigned|signature=/i);
});

test('separates illustrative complexity and bottleneck hypotheses from measured client findings', t => {
  const { document } = openDeck(t);
  const scope = document.querySelector('.discovery-slide');
  assert.match(scope.textContent, /The brief does not identify the bottleneck/);
  assert.deepEqual([...scope.querySelectorAll('[data-complexity]')].map(node => node.dataset.complexity), ['bounded', 'connected', 'regulated']);
  assert.match(scope.querySelector('.complexity-high').textContent, /KYC review workflow/);
  assert.match(scope.textContent, /Scope-dependent, not a measured ranking/);
  assert.match(scope.textContent, /Production flag platforms can also have high ownership burden/);
  assert.match(scope.textContent, /Questions, not client findings/);
  assert.match(scope.textContent, /Two engineers want an extra control/);
  assert.match(scope.textContent, /Teams repeatedly lose hours/);
  assert.match(scope.textContent, /Headcount is not the decision rule/);
  assert.match(scope.textContent, /Two-hour build allowance.*not an end-to-end KYC system/);
  assert.match(scope.querySelector('.speaker-notes').content.textContent, /Two engineers can own a critical bottleneck/);
});

test('uses one month-long pilot to evaluate representative work and ownership', t => {
  const { document } = openDeck(t);
  const pilot = document.querySelector('.pilot-slide');
  assert.match(document.getElementById('slide-title-5').textContent, /One pilot/);
  assert.equal(pilot.querySelectorAll('.weeks article').length, 4);
  for (const criterion of ['owner', 'Cursor usage', 'matched coding tasks', 'requirement change', 'debugging', 'maintenance', 'adoption alone is insufficient', 'Operator outcomes', 'Review, rework & failed attempts', 'security & task coverage', 'Usage, migration, support', 'opportunity cost', 'not long-term KTLO proof']) {
    assert.ok(pilot.textContent.includes(criterion), criterion);
  }
  const decisions = pilot.querySelector('.pilot-decisions').textContent;
  assert.match(decisions, /Custom apps/);
  assert.match(decisions, /Devin vs Cursor/);
  assert.doesNotMatch(pilot.textContent, /Separately:|two pilots/i);
  assert.deepEqual([...document.querySelectorAll('.slide')].map(slide => slide.dataset.cue.split(' · ')[0]), [
    '0:00–0:20', '0:20–0:55', '0:55–1:35', '1:35–3:50', '3:50–4:45',
  ]);
});

test('navigates with keys and buttons without wrapping past the bounds', t => {
  const { document, window, key, visible } = openDeck(t);
  key('ArrowRight');
  assert.equal(visible()[0].dataset.title, 'Vendor value');
  assert.equal(window.location.hash, '#slide-2');
  assert.equal(document.activeElement.id, 'slide-title-2');
  key(' ');
  assert.equal(visible()[0].dataset.title, 'Bottleneck discovery');
  key(' ', { shiftKey: true });
  assert.equal(visible()[0].dataset.title, 'Vendor value');
  key('End');
  assert.equal(document.getElementById('next').disabled, true);
  key('ArrowRight');
  assert.equal(visible()[0].dataset.title, 'One-month pilot');
  key('Home');
  document.getElementById('next').click();
  document.getElementById('previous').click();
  assert.equal(visible()[0].dataset.title, 'Recommendation');
  assert.equal(visible().length, 1);
});

test('handles deep links, malformed hashes and hash changes', t => {
  assert.equal(openDeck(t, '#slide-3').visible()[0].dataset.title, 'Bottleneck discovery');
  assert.equal(openDeck(t, '#slide-999').visible()[0].dataset.title, 'One-month pilot');
  assert.equal(openDeck(t, '#slide-0').visible()[0].dataset.title, 'Recommendation');
  assert.equal(openDeck(t, '#not-a-slide').visible()[0].dataset.title, 'Recommendation');
  const deck = openDeck(t);
  deck.window.history.replaceState(null, '', '#slide-4');
  deck.window.dispatchEvent(new deck.window.HashChangeEvent('hashchange'));
  assert.equal(deck.visible()[0].dataset.title, 'Live demonstration');
});

test('toggles notes from the keyboard and restores navigation after closing', t => {
  const { document, key, visible } = openDeck(t);
  key('n');
  assert.equal(document.getElementById('notes-panel').hidden, false);
  assert.equal(document.getElementById('notes-toggle').getAttribute('aria-expanded'), 'true');
  key('n');
  assert.equal(document.getElementById('notes-panel').hidden, true);
  key('ArrowRight');
  assert.equal(visible()[0].dataset.title, 'Vendor value');
  document.getElementById('notes-toggle').click();
  document.getElementById('sources-toggle').click();
  assert.equal(document.getElementById('notes-panel').hidden, true);
  assert.equal(document.getElementById('sources-panel').hidden, false);
  key('Escape');
  assert.equal(document.getElementById('sources-panel').hidden, true);
  assert.equal(document.activeElement.id, 'sources-toggle');
});

test('validates the local demo port without navigating while editing it', t => {
  const { document, window, key, visible } = openDeck(t);
  const input = document.getElementById('demo-port');
  input.value = '8080';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual([...document.querySelectorAll('[data-demo-link]')].map(link => link.href), [
    'http://127.0.0.1:8080/#flags',
    'http://127.0.0.1:8080/#preview',
  ]);
  input.focus();
  key('ArrowRight');
  assert.equal(visible()[0].dataset.title, 'Recommendation');
  for (const invalid of ['', '0', '65536', '1.5']) {
    input.value = invalid;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(document.querySelector('[data-demo-link]').href, 'http://127.0.0.1:8080/#flags');
  }
});

test('starts, pauses, resumes and resets the timer without auto-advancing', t => {
  const { document, window, visible } = openDeck(t);
  let now = 0;
  window.Date.now = () => now;
  const toggle = document.getElementById('timer-toggle');
  toggle.click();
  now = 65000;
  toggle.click();
  assert.equal(document.getElementById('timer').textContent, '1:05');
  now = 90000;
  toggle.click();
  now = 330000;
  toggle.click();
  assert.equal(document.getElementById('timer').textContent, '5:05');
  assert.equal(toggle.dataset.overBudget, 'true');
  assert.equal(visible()[0].dataset.title, 'Recommendation');
  document.getElementById('timer-reset').click();
  assert.equal(document.getElementById('timer').textContent, '0:00');
  assert.equal(toggle.dataset.overBudget, 'false');
});

test('supports fullscreen keyboard and button controls with a graceful fallback', async t => {
  const { document, key } = openDeck(t);
  let enters = 0;
  let exits = 0;
  document.documentElement.requestFullscreen = async () => { enters += 1; };
  document.exitFullscreen = async () => { exits += 1; };
  key('f');
  assert.equal(enters, 1);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
  document.getElementById('fullscreen').click();
  assert.equal(exits, 1);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  document.documentElement.requestFullscreen = async () => { throw new Error('Not permitted'); };
  key('f');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('fullscreen').textContent, 'Use browser fullscreen');
});

test('has no external runtime assets and opens sources without opener access', t => {
  const { document } = openDeck(t);
  for (const asset of document.querySelectorAll('script[src], link[rel="stylesheet"]')) {
    const value = asset.getAttribute('src') ?? asset.getAttribute('href');
    assert.ok(!/^(https?:)?\/\//.test(value));
  }
  for (const link of document.querySelectorAll('a[target="_blank"]')) {
    assert.ok(link.relList.contains('noopener'));
    assert.ok(link.relList.contains('noreferrer'));
  }
  let prints = 0;
  const window = document.defaultView;
  window.print = () => { prints += 1; };
  document.getElementById('print').click();
  assert.equal(prints, 1);
});
