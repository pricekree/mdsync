(function () {
  const vscode = acquireVsCodeApi();

  const SCROLL_LOCK_MS = 180;
  const SYNC_THROTTLE_MS = 48;

  let scrollLock = false;
  let scrollLockTimer = null;
  let lineIndex = [];
  let scrollRaf = null;
  let lastSyncTime = 0;
  let lastSyncedLine = -1;

  function lockScroll() {
    scrollLock = true;
    if (scrollLockTimer) {
      clearTimeout(scrollLockTimer);
    }
    scrollLockTimer = setTimeout(() => {
      scrollLock = false;
    }, SCROLL_LOCK_MS);
  }

  /** One entry per source line; prefer .code-line over block parents. */
  function buildLineIndex() {
    const content = document.getElementById('content');
    if (!content) {
      lineIndex = [];
      return;
    }
    const contentTop = content.getBoundingClientRect().top + window.scrollY;
    const byLine = new Map();

    content.querySelectorAll('[data-line]').forEach((el) => {
      if (el.classList.contains('fence-close')) {
        return;
      }
      const line = parseInt(el.dataset.line, 10);
      if (isNaN(line)) {
        return;
      }
      const existing = byLine.get(line);
      const isCodeLine = el.classList.contains('code-line');
      if (existing) {
        if (existing.isCodeLine && !isCodeLine) {
          return;
        }
        if (!existing.isCodeLine && isCodeLine) {
          byLine.delete(line);
        } else {
          return;
        }
      }
      const top = el.getBoundingClientRect().top + window.scrollY - contentTop;
      byLine.set(line, { line, top, el, isCodeLine });
    });

    lineIndex = Array.from(byLine.values()).sort((a, b) => a.top - b.top);
  }

  function getLineForElement(el) {
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.line !== undefined && !el.classList.contains('fence-close')) {
        return parseInt(el.dataset.line, 10);
      }
      el = el.parentElement;
    }
    return null;
  }

  function entryForLine(line) {
    return lineIndex.find((e) => e.line === line);
  }

  function lineAtScrollY(scrollY) {
    if (lineIndex.length === 0) {
      return null;
    }
    const content = document.getElementById('content');
    const contentTop = content.getBoundingClientRect().top + window.scrollY;
    const target = scrollY + window.innerHeight * 0.2 - contentTop;

    let best = lineIndex[0].line;
    for (let i = 0; i < lineIndex.length; i++) {
      if (lineIndex[i].top <= target) {
        best = lineIndex[i].line;
      } else {
        break;
      }
    }
    return best;
  }

  function highlightLine(line) {
    document.querySelectorAll('.active-line').forEach((el) => {
      el.classList.remove('active-line');
    });
    document.querySelectorAll('[data-line="' + line + '"]').forEach((el) => {
      if (!el.classList.contains('fence-close')) {
        el.classList.add('active-line');
      }
    });
  }

  function scrollToLine(line, highlight) {
    const entry = entryForLine(line);
    if (!entry) {
      return;
    }
    lockScroll();
    const rect = entry.el.getBoundingClientRect();
    const targetTop = window.scrollY + rect.top - window.innerHeight * 0.2;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
    if (highlight !== false) {
      highlightLine(line);
    }
    lastSyncedLine = line;
  }

  function postScrollLine(line) {
    const now = Date.now();
    if (line === lastSyncedLine && now - lastSyncTime < SYNC_THROTTLE_MS) {
      return;
    }
    lastSyncTime = now;
    lastSyncedLine = line;
    vscode.postMessage({ type: 'scrollLine', line });
  }

  function getCodeText(code) {
    const lines = code.querySelectorAll('.code-line:not(.fence-close)');
    if (lines.length) {
      return Array.from(lines)
        .map((el) => el.textContent.replace(/\u200B/g, ''))
        .join('\n');
    }
    return code.textContent;
  }

  function copyCode(btn) {
    const pre = btn.closest('pre');
    const code = pre && pre.querySelector('code');
    if (!code) {
      return;
    }
    const text = getCodeText(code);
    const label = btn.querySelector('.code-copy-label');
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      if (label) {
        const prev = label.textContent;
        label.textContent = 'Copied!';
        setTimeout(() => {
          btn.classList.remove('copied');
          label.textContent = prev;
        }, 1500);
      }
    });
  }

  function renderMermaid() {
    const nodes = document.querySelectorAll('pre.mermaid');
    if (!nodes.length || typeof mermaid === 'undefined') {
      return Promise.resolve();
    }
    mermaid.initialize({
      startOnLoad: false,
      theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
      securityLevel: 'strict',
    });
    return mermaid.run({ nodes: Array.from(nodes), suppressErrors: true });
  }

  function scrollToAnchor(id) {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    lockScroll();
    const rect = el.getBoundingClientRect();
    const targetTop = window.scrollY + rect.top - window.innerHeight * 0.15;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
  }

  function afterContentUpdate(msg) {
    buildLineIndex();
    return renderMermaid().then(() => {
      if (msg.line !== undefined) {
        scrollToLine(msg.line, true);
      } else if (msg.scrollLine !== undefined) {
        scrollToLine(msg.scrollLine, false);
      } else if (msg.scrollRatio !== undefined) {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, msg.scrollRatio * maxScroll);
      }
    });
  }

  function onPreviewScroll() {
    if (scrollLock) {
      return;
    }
    if (scrollRaf) {
      return;
    }
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      const line = lineAtScrollY(window.scrollY);
      if (line !== null && !isNaN(line)) {
        lockScroll();
        highlightLine(line);
        postScrollLine(line);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      copyCode(copyBtn);
      return;
    }

    const anchor = e.target.closest('a[href]');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href && !href.startsWith('javascript:')) {
        e.preventDefault();
        e.stopPropagation();
        if (href.startsWith('#')) {
          scrollToAnchor(href.slice(1));
        }
        vscode.postMessage({ type: 'openLink', href });
        return;
      }
    }

    const line = getLineForElement(e.target);
    if (line !== null && !isNaN(line)) {
      lockScroll();
      highlightLine(line);
      lastSyncedLine = line;
      vscode.postMessage({ type: 'revealLine', line });
    }
  });

  document.addEventListener('change', (e) => {
    const checkbox = e.target.closest('.task-list-item-checkbox');
    if (!checkbox) {
      return;
    }
    const line = getLineForElement(checkbox);
    if (line !== null && !isNaN(line)) {
      vscode.postMessage({ type: 'toggleTask', line, checked: checkbox.checked });
    }
  });

  window.addEventListener('scroll', onPreviewScroll, { passive: true });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'updateContent') {
      const scrollY = window.scrollY;
      const ratio = scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      document.getElementById('content').innerHTML = msg.html;
      afterContentUpdate({ scrollRatio: ratio });
    } else if (msg.type === 'scrollToLine') {
      scrollToLine(msg.line, false);
    } else if (msg.type === 'revealLine') {
      scrollToLine(msg.line, true);
    } else if (msg.type === 'scrollToAnchor') {
      scrollToAnchor(msg.id);
    }
  });

  buildLineIndex();
  renderMermaid();
  vscode.postMessage({ type: 'ready' });
})();
