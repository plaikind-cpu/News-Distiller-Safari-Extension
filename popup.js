// News-Distiller Safari Extension popup.js
// All handlers via addEventListener in DOMContentLoaded — required by MV3 CSP

const API_BASE = 'https://app.news-distiller.com';
const LEAN_POSITIONS = { 'Left': 8, 'Center-Left': 28, 'Center': 50, 'Center-Right': 72, 'Right': 92 };

let currentTab = null;
let lastResult = null;
let savedCode = '';

function showToast(msg, duration) {
  duration = duration || 2000;
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, duration);
}

function collapseAuth() {
  document.getElementById('accBody').classList.remove('open');
  document.getElementById('accChevron').classList.remove('open');
}

function toggleAccess() {
  var body = document.getElementById('accBody');
  var chevron = document.getElementById('accChevron');
  if (body.classList.contains('open')) {
    body.classList.remove('open');
    chevron.classList.remove('open');
  } else {
    body.classList.add('open');
    chevron.classList.add('open');
  }
}

function updateCodeBadge() {
  var badge = document.getElementById('navCodeBadge');
  var accStatus = document.getElementById('accStatusBadge');
  if (savedCode) {
    badge.textContent = 'Code \u2713';
    badge.style.color = '#1D9E75';
    accStatus.textContent = savedCode.substring(0, 4) + '....';
    accStatus.style.color = '#1D9E75';
  } else {
    badge.textContent = 'No code';
    badge.style.color = '#6688aa';
    accStatus.textContent = 'No code';
    accStatus.style.color = '#6688aa';
  }
}

async function saveCode() {
  var code = document.getElementById('codeInput').value.trim();
  savedCode = code;
  await chrome.storage.local.set({ nd_code: code });
  updateCodeBadge();
  showToast(code ? 'Code saved!' : 'Code cleared.');
  setTimeout(collapseAuth, 800);
}

async function testCode() {
  var code = document.getElementById('codeInput').value.trim() || savedCode;
  if (!code) { showToast('No code to test.'); return; }
  showToast('Testing...', 3000);
  try {
    var resp = await fetch(API_BASE + '/api/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    });
    var d = await resp.json();
    if (d.valid) {
      var rem = d.remaining !== undefined ? d.remaining : d.distills_remaining;
      var msg = rem !== undefined ? (rem === -1 ? 'Unlimited uses.' : rem + ' uses left.') : '';
      showToast('\u2713 Valid code! ' + msg, 3000);
    } else {
      showToast('\u2717 ' + (d.error || 'Code not recognized.'), 3000);
    }
  } catch(e) {
    showToast('Could not reach server.', 3000);
  }
}

async function distillPage() {
  showLoading(true);
  hideError();
  document.getElementById('resultsBox').classList.remove('visible');

  try {
    var pastedText = document.getElementById('pasteArea').value.trim();
    var urlInput = document.getElementById('urlInput').value.trim();
    var pageText = pastedText;

    if (!pageText && currentTab) {
      try {
        var response;
        try {
          response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageText' });
        } catch(e) {
          await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] });
          response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageText' });
        }
        if (response && response.text && response.text.length > 200) {
          pageText = response.text;
        }
      } catch(e) {
        console.log('Content script error:', e);
      }
    }

    var body = { style: 'executive' };
    if (savedCode) body.code = savedCode;

    if (pageText) {
      body.text = pageText;
    } else if (urlInput) {
      body.url = urlInput;
    } else {
      showError('Please paste article text or enter a URL.');
      showLoading(false);
      return;
    }

    var resp = await fetch(API_BASE + '/api/distill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      var d = await resp.json();
      if (d.error === 'free_exhausted') {
        showError('Free distillations used up. Enter a Distiller Pack code or get one at pklmedialab.com.');
      } else {
        showError(d.error || d.message || 'Analysis failed. Please try again.');
      }
      showLoading(false);
      return;
    }

    // SSE streaming
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var chunkBuffer = '';
    var summaryShown = false;

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data: ')) continue;
        var payload = line.slice(6).trim();
        if (!payload) continue;
        var msg;
        try { msg = JSON.parse(payload); } catch(e) { continue; }
        if (msg.error) { showError(msg.error); showLoading(false); return; }

        // Accumulate JSON chunks and show summary as soon as parseable
        if (msg.chunk) {
          chunkBuffer += msg.chunk;
          if (!summaryShown) {
            try {
              var partial = JSON.parse(chunkBuffer);
              if (partial.summary) {
                document.getElementById('summaryEl').textContent = partial.summary;
                document.getElementById('resultsBox').classList.add('visible');
                showLoading(false);
                summaryShown = true;
              }
            } catch(e) {}
          }
        }

        // Final done event
        if (msg.done && msg.result) {
          lastResult = msg.result;
          renderResults(msg.result);
          showLoading(false);
        }
      }
    }
  } catch(e) {
    showError('Network error \u2014 please try again.');
  } finally {
    showLoading(false);
  }
}

function renderResults(r) {
  document.getElementById('summaryEl').textContent = r.summary || '';

  // Political lean fields from API:
  // r.lean = "Center", r.confidence = "Medium confidence"
  // r.bias_signals = ["signal1", "signal2"] (bullet points)
  // r.lean_note = italic note text
  var lean = r.lean || r.political_lean || null;
  var confidence = r.confidence || r.lean_confidence || null;
  var signals = r.bias_signals || r.lean_signals || r.signals || [];
  var leanNote = r.lean_note || r.lean_summary || r.note || null;

  if (lean) {
    var pct = LEAN_POSITIONS[lean] !== undefined ? LEAN_POSITIONS[lean] : 50;
    document.getElementById('leanMarker').style.left = pct + '%';
    document.getElementById('leanVerdict').textContent = lean;
    document.getElementById('leanConfidence').textContent = confidence || '';

    var signalsEl = document.getElementById('leanSignals');
    signalsEl.innerHTML = '';
    if (Array.isArray(signals)) {
      signals.forEach(function(s) {
        var li = document.createElement('li');
        li.textContent = s;
        signalsEl.appendChild(li);
      });
    }

    var noteEl = document.getElementById('leanNote');
    if (leanNote) {
      noteEl.textContent = leanNote;
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
    }

    document.getElementById('leanSection').style.display = 'block';
  } else {
    document.getElementById('leanSection').style.display = 'none';
  }

  document.getElementById('resultsBox').classList.add('visible');
}

function openFullReport() {
  chrome.tabs.create({ url: API_BASE });
}

async function copyResult() {
  if (!lastResult) return;
  var lean = lastResult.lean || lastResult.political_lean || null;
  var confidence = lastResult.confidence || null;
  var signals = lastResult.bias_signals || lastResult.signals || [];
  var text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n' +
    (lastResult.summary || '') + '\n\n' +
    (lean ? 'Political Lean: ' + lean + (confidence ? ' (' + confidence + ')' : '') + '\n' : '') +
    (signals.length ? signals.map(function(s) { return '  \u2022 ' + s; }).join('\n') + '\n' : '') +
    '\nDistilled by News-Distiller (app.news-distiller.com)\n';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Summary copied to clipboard!');
  } catch(e) {
    showToast('Could not copy \u2014 use the Web App.');
  }
}

async function shareResult() {
  if (!lastResult) return;
  var lean = lastResult.lean || null;
  var text = 'NEWS-DISTILLER SUMMARY\n\n' +
    (lastResult.summary || '') + '\n\n' +
    (lean ? 'Political Lean: ' + lean + '\n\n' : '') +
    'Distilled by News-Distiller (app.news-distiller.com)';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'News-Distiller Summary', text: text });
    } catch(e) { copyResult(); }
  } else {
    copyResult();
  }
}

function resetUI() {
  document.getElementById('resultsBox').classList.remove('visible');
  document.getElementById('pasteArea').value = '';
  document.getElementById('urlInput').value = '';
  document.getElementById('charCount').textContent = '0 chars \u00b7 ~0 words';
  hideError();
  lastResult = null;
}

function showLoading(on) {
  document.getElementById('loadingBox').classList.toggle('visible', on);
  document.getElementById('distillBtn').disabled = on;
}
function showError(msg) {
  var el = document.getElementById('errorBox');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideError() {
  document.getElementById('errorBox').classList.remove('visible');
}

document.addEventListener('DOMContentLoaded', async function() {
  document.getElementById('navCodeBadge').addEventListener('click', toggleAccess);
  document.getElementById('accHeader').addEventListener('click', toggleAccess);
  document.getElementById('saveCodeBtn').addEventListener('click', saveCode);
  document.getElementById('testCodeBtn').addEventListener('click', testCode);
  document.getElementById('distillBtn').addEventListener('click', distillPage);
  document.getElementById('saveBtn').addEventListener('click', copyResult);
  document.getElementById('shareBtn').addEventListener('click', shareResult);
  document.getElementById('fullReportBtn').addEventListener('click', openFullReport);
  document.getElementById('newBtn').addEventListener('click', resetUI);

  document.getElementById('pasteArea').addEventListener('input', function() {
    var text = this.value;
    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('charCount').textContent = chars + ' chars \u00b7 ~' + words + ' words';
  });

  var stored = await chrome.storage.local.get('nd_code');
  savedCode = stored.nd_code || '';
  if (savedCode) {
    document.getElementById('codeInput').value = savedCode;
  }
  updateCodeBadge();

  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    if (currentTab && currentTab.url && currentTab.url.startsWith('http')) {
      document.getElementById('urlInput').value = currentTab.url;
    }
  } catch(e) {
    console.log('Tab query error:', e);
  }
});
