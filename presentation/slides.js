(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const notesPanel = document.getElementById('notes-panel');
  const sourcesPanel = document.getElementById('sources-panel');
  const notesToggle = document.getElementById('notes-toggle');
  const sourcesToggle = document.getElementById('sources-toggle');
  const timerToggle = document.getElementById('timer-toggle');
  const timerDisplay = document.getElementById('timer');
  let current = 0;
  let elapsed = 0;
  let startedAt = null;

  const hashIndex = () => {
    const match = /^#slide-(\d+)$/.exec(window.location.hash);
    return match ? Math.min(slides.length - 1, Math.max(0, Number(match[1]) - 1)) : 0;
  };

  function render(index, focus = false) {
    current = Math.min(slides.length - 1, Math.max(0, index));
    slides.forEach((slide, i) => { slide.hidden = i !== current; });
    const slide = slides[current];
    const position = `${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    document.getElementById('position').textContent = position;
    document.getElementById('current-title').textContent = slide.dataset.title;
    document.getElementById('progress').style.width = `${(current + 1) / slides.length * 100}%`;
    document.getElementById('notes-content').replaceChildren(slide.querySelector('.speaker-notes').content.cloneNode(true));
    document.title = `${current + 1}. ${slide.dataset.title} — Northstar Decision Brief`;
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    history.replaceState(null, '', `#slide-${current + 1}`);
    document.querySelector('.deck').scrollTop = 0;
    if (focus) slide.querySelector('[tabindex="-1"]').focus({ preventScroll: true });
  }

  function setPanel(panel, button, open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      const otherPanel = panel === notesPanel ? sourcesPanel : notesPanel;
      const otherButton = panel === notesPanel ? sourcesToggle : notesToggle;
      otherPanel.hidden = true;
      otherButton.setAttribute('aria-expanded', 'false');
      panel.querySelector('[data-close]').focus();
    } else {
      button.focus();
    }
  }

  function paintTimer() {
    const milliseconds = elapsed + (startedAt === null ? 0 : Date.now() - startedAt);
    const seconds = Math.floor(milliseconds / 1000);
    timerDisplay.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    timerToggle.dataset.overBudget = String(seconds >= 300);
    timerToggle.firstChild.textContent = startedAt === null ? (elapsed ? 'Resume ' : 'Start ') : 'Pause ';
    timerToggle.setAttribute('aria-label', `${startedAt === null ? 'Start' : 'Pause'} presentation timer`);
  }

  function toggleTimer() {
    if (startedAt === null) startedAt = Date.now();
    else { elapsed += Date.now() - startedAt; startedAt = null; }
    paintTimer();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      document.getElementById('fullscreen').textContent = 'Use browser fullscreen';
    }
  }

  previous.addEventListener('click', () => render(current - 1, true));
  next.addEventListener('click', () => render(current + 1, true));
  notesToggle.addEventListener('click', () => setPanel(notesPanel, notesToggle, notesPanel.hidden));
  sourcesToggle.addEventListener('click', () => setPanel(sourcesPanel, sourcesToggle, sourcesPanel.hidden));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
    const notes = button.dataset.close === 'notes';
    setPanel(notes ? notesPanel : sourcesPanel, notes ? notesToggle : sourcesToggle, false);
  }));
  timerToggle.addEventListener('click', toggleTimer);
  document.getElementById('timer-reset').addEventListener('click', () => { elapsed = 0; startedAt = null; paintTimer(); });
  document.getElementById('fullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('demo-port').addEventListener('input', event => {
    const input = event.currentTarget;
    const port = Number(input.value);
    const valid = input.value.trim() !== '' && Number.isInteger(port) && port >= 1 && port <= 65535;
    input.setAttribute('aria-invalid', String(!valid));
    document.getElementById('port-status').textContent = valid ? `Demo links use port ${port}.` : 'Enter a port from 1 to 65535. The last valid link is unchanged.';
    if (valid) document.querySelectorAll('[data-demo-link]').forEach(link => { link.href = `http://127.0.0.1:${port}/${link.hash || '#preview'}`; });
  });
  window.addEventListener('hashchange', () => render(hashIndex(), true));
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (!notesPanel.hidden) setPanel(notesPanel, notesToggle, false);
      else if (!sourcesPanel.hidden) setPanel(sourcesPanel, sourcesToggle, false);
      return;
    }
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); setPanel(notesPanel, notesToggle, notesPanel.hidden); return; }
    if (!notesPanel.hidden || !sourcesPanel.hidden) return;
    if (event.target.closest('button, a') && [' ', 'enter'].includes(key)) return;
    if (['arrowright', 'pagedown', ' '].includes(key)) { event.preventDefault(); render(current + (event.shiftKey && key === ' ' ? -1 : 1), true); }
    else if (['arrowleft', 'pageup'].includes(key)) { event.preventDefault(); render(current - 1, true); }
    else if (key === 'home') { event.preventDefault(); render(0, true); }
    else if (key === 'end') { event.preventDefault(); render(slides.length - 1, true); }
    else if (key === 'f') { event.preventDefault(); toggleFullscreen(); }
  });
  render(hashIndex());
  paintTimer();
  window.setInterval(paintTimer, 250);
})();
