// News-Distiller Safari Extension - popup.js

const API_BASE = 'https://app.news-distiller.com';
const LEAN_POSITIONS = {
  'Left': 8, 'Center-Left': 28, 'Center': 50, 'Center-Right': 72, 'Right': 92
};

let currentTab = null;
let lastResult = null;
let savedCode = '';

// Init
async function init() {
  // Load saved code
  const stored = await chrome.storage.local.get('nd_code');
  savedCode = stored.nd_code || '';
  if (savedCode) {
    document.getElementById('codeInput').value = savedCode;
    document.getElementById('codeStatus').textContent = 'Code: ' + savedCode.substring(0, 4) + '....';
    document.getElementById('codeStatus').className = 'code-status ok';
  }

  // Get current tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
  if (currentTab) {
    const url = currentTab.url || '';
    document.getElementById('urlDisplay').textContent = url.length > 50 ? url.substring(0, 50) + '...' : url;
  }
}

// Save code
async function saveCode() {
  const code = document.getElementById('codeInput').value.trim();
  savedCode = code;
  await chrome.storage.local.set({ nd_code: code });
  const st = document.getElementById('codeStatus');
  if (code) {
    st.textContent = 'Code saved: ' + code.substring(0, 4) + '....';
    st.className = 'code-status ok';
  } else {
    st.textContent = 'Code cleared.';
    st.className = 'code-status';
  }
}

// Distill current page
async function distillPage() {
  if (!currentTab) { showError('Could not access current tab.'); return; }

  showLoading(true);
  hideError();
  document.getElementById('resultsBox').classList.remove('visible');

  try {
    // Extract page text via content script
    let pageText = '';
    try {
      let response;
      try {
        response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageText' });
      } catch(e) {
        // Inject content script if not ready
        await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] });
        response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageText' });
      }
      if (response && response.text && response.text.length > 200) {
        pageText = response.text;
      }
    } catch(e) {
      console.log('Content script error:', e);
    }

    if (!pageText) {
      showError('Could not extract article text. Try copying and pasting the article text into the web app instead.');
      showLoading(false);
      return;
    }

    // Call News-Distiller API
    const body = { text: pageText, style: 'executive' };
    if (savedCode) body.code = savedCode;

    const response = await fetch(`${API_BASE}/api/distill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const d = await response.json();
      if (d.error === 'free_exhausted') {
        showError('You have used all your free distillations. Enter a Distiller Pack code or get one at pklmedialab.com.');
      } else {
        showError(d.error || d.message || 'Analysis failed. Please try again.');
      }
      showLoading(false);
      return;
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        let msg;
        try { msg = JSON.parse(payload); } catch(e) { continue; }

        if (msg.error) { showError(msg.error); showLoading(false); return; }

        if (msg.done && msg.result) {
          lastResult = msg.result;
          renderResults(msg.result);
        }
      }
    }

  } catch(e) {
    showError('Network error - please try again.');
  } finally {
    showLoading(false);
  }
}

// Render results
function renderResults(r) {
  document.getElementById('summaryEl').textContent = r.summary || '';

  // Lean meter
  if (r.lean) {
    const pct = LEAN_POSITIONS[r.lean] ?? 50;
    document.getElementById('leanMarker').style.left = pct + '%';
    document.getElementById('leanVerdict').textContent = r.lean + (r.confidence ? ' (' + r.confidence + ' confidence)' : '');
    document.getElementById('leanSection').style.display = 'block';
  } else {
    document.getElementById('leanSection').style.display = 'none';
  }

  document.getElementById('resultsBox').classList.add('visible');
  document.getElementById('resultsBox').scrollIntoView({ behavior: 'smooth' });
}

// Save summary
function saveSummary() {
  if (!lastResult) return;
  const text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n' +
    (lastResult.summary || '') + '\n\n' +
    (lastResult.lean ? 'Political Lean: ' + lastResult.lean + '\n' : '') +
    '\nDistilled by News-Distiller (app.news-distiller.com)\n';

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'news-distiller-summary.txt'; a.click();
  URL.revokeObjectURL(url);
}

// Open web app
function openWebApp() {
  chrome.tabs.create({ url: 'https://app.news-distiller.com' });
}

// Reset
function resetUI() {
  document.getElementById('resultsBox').classList.remove('visible');
  hideError();
  lastResult = null;
}

// Helpers
function showLoading(on) {
  document.getElementById('loadingBox').classList.toggle('visible', on);
  document.getElementById('distillBtn').disabled = on;
}
function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = msg; el.classList.add('visible');
}
function hideError() {
  document.getElementById('errorBox').classList.remove('visible');
}

init();
