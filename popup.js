// News-Distiller Safari Extension popup.js
// Matches TruthPrism patterns exactly

const SERVER_URL = 'https://app.news-distiller.com';
const LEAN_POSITIONS = { 'Left': 8, 'Center-Left': 28, 'Center': 50, 'Center-Right': 72, 'Right': 92 };
const LOADING_STEPS = [
  'Reading and analyzing content\u2026',
  'Identifying key themes\u2026',
  'Extracting important points\u2026',
  'Assessing political framing\u2026',
  'Structuring your summary\u2026'
];

let _savedResult = null;
let _loadingInterval = null;
let _currentTab = null;

document.addEventListener('DOMContentLoaded', async function() {
  var data = await chrome.storage.local.get(['nd_code']);
  if (data.nd_code) {
    document.getElementById('accessCode').value = data.nd_code;
    showAuthStatus('\u2713 Distiller Pack code configured', 'ok');
    collapseAuth();
  }
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    _currentTab = tabs[0];
    if (_currentTab && _currentTab.url) {
      var short = _currentTab.url.length > 55 ? _currentTab.url.substring(0, 55) + '...' : _currentTab.url;
      document.getElementById('pageUrl').textContent = '\ud83d\udcc4 ' + short;
    }
  } catch(e) {}

  document.getElementById('authHeader').addEventListener('click', toggleAuth);
  document.getElementById('saveCodeBtn').addEventListener('click', saveCode);
  document.getElementById('testCodeBtn').addEventListener('click', testCode);
  document.getElementById('checkBtn').addEventListener('click', checkCurrentPage);
  document.getElementById('checkCustomBtn').addEventListener('click', checkCustomText);
  document.getElementById('saveBtn').addEventListener('click', copyReport);
  document.getElementById('newCheckBtn').addEventListener('click', resetResults);
  document.getElementById('fullReportBtn').addEventListener('click', openFullReport);
});

function toggleAuth() {
  var body = document.getElementById('authBody');
  var toggle = document.getElementById('authToggle');
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
  toggle.textContent = hidden ? '\u25bc' : '\u25b6';
}
function collapseAuth() {
  document.getElementById('authBody').style.display = 'none';
  document.getElementById('authToggle').textContent = '\u25b6';
}
function expandAuth() {
  document.getElementById('authBody').style.display = 'block';
  document.getElementById('authToggle').textContent = '\u25bc';
}
function showAuthStatus(msg, type) {
  var el = document.getElementById('authStatus');
  el.textContent = msg;
  el.className = 'auth-status ' + (type || '');
}

async function saveCode() {
  var code = document.getElementById('accessCode').value.trim();
  if (!code) { showAuthStatus('Please enter a code', 'error'); return; }
  await chrome.storage.local.set({ nd_code: code });
  showAuthStatus('\u2713 Code saved!', 'ok');
  setTimeout(collapseAuth, 800);
}

async function testCode() {
  var code = document.getElementById('accessCode').value.trim();
  if (!code) { showAuthStatus('Enter a code first', 'error'); return; }
  showAuthStatus('Testing\u2026', '');
  try {
    var r = await fetch(SERVER_URL + '/api/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    });
    var d = await r.json();
    if (d.valid) {
      var rem = d.remaining != null ? d.remaining : null;
      var remStr = rem === -1 ? 'Unlimited uses.' : (rem != null ? rem + ' uses left.' : '');
      showAuthStatus('\u2713 Valid code! ' + remStr, 'ok');
    } else {
      showAuthStatus('\u2717 ' + (d.message || d.error || 'Code not recognized.'), 'error');
    }
  } catch(e) {
    showAuthStatus('\u2717 Cannot connect to server', 'error');
  }
}

async function getCode() {
  var data = await chrome.storage.local.get(['nd_code']);
  if (!data.nd_code) {
    showError('Please save your Distiller Pack code first.');
    expandAuth();
    return null;
  }
  return data.nd_code;
}

async function checkCurrentPage() {
  var code = await getCode();
  if (!code) return;
  if (!_currentTab) { showError('Could not access current tab.'); return; }
  showLoading(true);
  hideError();
  hideResults();
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: _currentTab.id },
      func: function() {
        var selectors = ['article','[role="main"]','.article-content','.article-body',
          '.post-content','.story-body','.entry-content','main','#main-content','#content'];
        var text = '';
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el && el.innerText.length > 200) { text = el.innerText; break; }
        }
        if (!text) {
          var clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,nav,footer,header,aside').forEach(function(e){e.remove();});
          text = clone.innerText;
        }
        return 'Page Title: ' + document.title + '\nURL: ' + window.location.href + '\n\n' + text.replace(/\s+/g,' ').trim();
      }
    });
    var pageText = results[0] && results[0].result;
    if (!pageText) throw new Error('Could not extract text from page.');
    await runDistill(pageText, code);
  } catch(e) {
    showError(e.message || 'Could not read page content.');
    showLoading(false);
  }
}

async function checkCustomText() {
  var code = await getCode();
  if (!code) return;
  var text = document.getElementById('customText').value.trim();
  if (!text) { showError('Please paste article text first.'); return; }
  showLoading(true);
  hideError();
  hideResults();
  await runDistill(text, code);
}

async function runDistill(text, code) {
  _savedResult = null;
  var chunkBuffer = '';
  var summaryShown = false;

  try {
    var resp = await fetch(SERVER_URL + '/api/distill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 15000), code: code, style: 'executive' })
    });

    if (!resp.ok) {
      var ed = await resp.json().catch(function(){ return {}; });
      if (ed.error === 'free_exhausted') {
        throw new Error('Free distillations used up. Get a Distiller Pack at pklmedialab.com');
      }
      throw new Error(ed.error || ed.message || 'Analysis failed \u2014 please try again.');
    }

    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    function read() {
      return reader.read().then(function(chunk) {
        if (chunk.done) { showLoading(false); return; }
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();

        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          var payload = line.slice(6).trim();
          if (!payload) return;
          var msg;
          try { msg = JSON.parse(payload); } catch(e) { return; }

          if (msg.error) { showError(msg.error); showLoading(false); return; }

          // Accumulate chunks — extract summary as soon as it appears (web app pattern)
          if (msg.chunk) {
            chunkBuffer += msg.chunk;
            if (!summaryShown) {
              var sumKey = '"summary": "';
              var sumStart = chunkBuffer.indexOf(sumKey);
              if (sumStart !== -1) {
                var textStart = sumStart + sumKey.length;
                var textEnd = textStart;
                while (textEnd < chunkBuffer.length) {
                  if (chunkBuffer[textEnd] === '"' && chunkBuffer[textEnd-1] !== '\\') break;
                  textEnd++;
                }
                var partial = chunkBuffer.substring(textStart, textEnd);
                if (partial.length > 20) {
                  document.getElementById('summaryText').textContent = partial;
                  document.getElementById('summaryCard').style.display = 'block';
                  document.getElementById('results').style.display = 'block';
                  summaryShown = true;
                  // Keep spinner going until done
                }
              }
            }
          }

          // Final done event — render full results
          if (msg.done && msg.result) {
            _savedResult = msg.result;
            renderResults(msg.result);
            showLoading(false);
          }
        });
        return read();
      }).catch(function(e) {
        showError('Network error \u2014 please try again.');
        showLoading(false);
      });
    }
    await read();
  } catch(e) {
    showError(e.message || 'Failed to connect \u2014 please try again.');
    showLoading(false);
  }
}

function renderResults(r) {
  // Summary
  document.getElementById('summaryText').textContent = r.summary || '';
  document.getElementById('summaryCard').style.display = 'block';

  // Political lean — exact field names: r.lean, r.confidence, r.signals, r.caveat
  if (r.lean) {
    var pct = LEAN_POSITIONS[r.lean] !== undefined ? LEAN_POSITIONS[r.lean] : 50;
    setTimeout(function() {
      document.getElementById('leanMarker').style.left = pct + '%';
    }, 100);
    document.getElementById('leanVerdict').textContent = r.lean;

    var conf = (r.confidence || 'low').toLowerCase();
    var confEl = document.getElementById('confPill');
    confEl.textContent = (r.confidence || '') + ' confidence';
    confEl.className = 'confidence-pill conf-' + conf;

    var signalsEl = document.getElementById('leanSignals');
    signalsEl.innerHTML = '';
    (r.signals || []).forEach(function(s) {
      var li = document.createElement('li');
      li.textContent = s;
      signalsEl.appendChild(li);
    });

    var caveatEl = document.getElementById('leanCaveat');
    if (r.caveat) {
      caveatEl.textContent = r.caveat;
      caveatEl.style.display = 'block';
    } else {
      caveatEl.style.display = 'none';
    }
    document.getElementById('biasCard').style.display = 'block';
  } else {
    document.getElementById('biasCard').style.display = 'none';
  }

  document.getElementById('results').style.display = 'block';
}

// Full report — generates HTML blob and opens in new tab (exactly like TruthPrism)
function openFullReport() {
  var d = _savedResult;
  if (!d) return;
  var timestamp = new Date().toLocaleString();

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  var sectionsHtml = '';
  (d.sections || []).forEach(function(sec) {
    if (!sec.points || !sec.points.length) return;
    sectionsHtml += '<h2>' + esc(sec.title) + '</h2><ul style="margin:0 0 12px 0;padding-left:20px;">';
    sec.points.forEach(function(pt) {
      sectionsHtml += '<li style="font-size:13px;color:#333;line-height:1.7;margin-bottom:4px;">' + esc(pt) + '</li>';
    });
    sectionsHtml += '</ul>';
  });

  var leanHtml = '';
  if (d.lean) {
    leanHtml = '<h2>Political Lean Assessment</h2>' +
      '<div style="background:#f0f4f8;border-radius:8px;padding:14px;margin-bottom:10px;">' +
      '<div style="font-size:18px;font-weight:700;color:#1a2a3a;margin-bottom:6px;">' + esc(d.lean) +
      (d.confidence ? ' <span style="font-size:11px;font-weight:400;color:#666;">(' + esc(d.confidence) + ' confidence)</span>' : '') + '</div>';
    if (d.signals && d.signals.length) {
      leanHtml += '<ul style="margin:0 0 8px 0;padding-left:16px;">';
      d.signals.forEach(function(s) {
        leanHtml += '<li style="font-size:12px;color:#444;margin-bottom:3px;">' + esc(s) + '</li>';
      });
      leanHtml += '</ul>';
    }
    if (d.caveat) {
      leanHtml += '<p style="font-size:12px;color:#f0a000;font-style:italic;margin:0;">' + esc(d.caveat) + '</p>';
    }
    leanHtml += '</div>';
  }

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>News-Distiller Report</title>' +
    '<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#f5f7fa;color:#1a2a3a;}' +
    'h1{font-size:20px;margin-bottom:4px;}h2{font-size:14px;margin:18px 0 8px;color:#0D6E6E;border-bottom:1px solid #dde;padding-bottom:4px;}' +
    '.summary{background:white;border:1px solid #dde;border-radius:8px;padding:14px;margin-bottom:10px;font-size:14px;line-height:1.8;color:#333;}' +
    '.save-btn{display:inline-block;padding:10px 20px;background:#0D6E6E;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin:14px 0;}' +
    '.meta{font-size:11px;color:#999;margin-top:20px;border-top:1px solid #dde;padding-top:10px;}</style></head><body>' +
    '<h1>News-Distiller Analysis Report</h1>' +
    '<p style="font-size:12px;color:#666;margin-bottom:16px;">' + timestamp + '</p>' +
    '<h2>Executive Summary</h2>' +
    '<div class="summary">' + esc(d.summary || '') + '</div>' +
    sectionsHtml +
    leanHtml +
    '<button class="save-btn" onclick="saveIt()">💾 Save as Text File</button>' +
    '<div class="meta">Generated by News-Distiller &mdash; app.news-distiller.com &mdash; Powered by Claude AI</div>' +
    '<script>function saveIt(){' +
    'var out="NEWS-DISTILLER REPORT\\nGenerated: ' + timestamp + '\\n\\n";' +
    'out+=document.body.innerText;' +
    'var a=document.createElement("a");a.href="data:text/plain;charset=utf-8,"+encodeURIComponent(out);' +
    'a.download="news-distiller-report.txt";a.click();}' +
    '<\\/script></body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

async function copyReport() {
  var d = _savedResult;
  if (!d) return;
  var text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n' +
    (d.summary || '') + '\n\n';
  if (d.lean) {
    text += 'Political Lean: ' + d.lean;
    if (d.confidence) text += ' (' + d.confidence + ' confidence)';
    text += '\n';
    (d.signals || []).forEach(function(s) { text += '  \u203a ' + s + '\n'; });
    if (d.caveat) text += '\n' + d.caveat + '\n';
  }
  text += '\nDistilled by News-Distiller (app.news-distiller.com)\n';
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById('saveBtn').textContent = '\u2713 Copied!';
    setTimeout(function() { document.getElementById('saveBtn').textContent = '\ud83d\udccb Copy'; }, 2000);
  } catch(e) {}
}

function resetResults() {
  document.getElementById('results').style.display = 'none';
  document.getElementById('summaryCard').style.display = 'none';
  document.getElementById('biasCard').style.display = 'none';
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('customText').value = '';
  _savedResult = null;
}

function showLoading(on) {
  document.getElementById('loading').style.display = on ? 'block' : 'none';
  document.getElementById('checkBtn').style.display = on ? 'none' : 'block';
  document.getElementById('checkCustomBtn').disabled = on;
  if (on) {
    var si = 0;
    document.getElementById('loadingStep').textContent = LOADING_STEPS[0];
    _loadingInterval = setInterval(function() {
      si = (si + 1) % LOADING_STEPS.length;
      document.getElementById('loadingStep').textContent = LOADING_STEPS[si];
    }, 2000);
  } else {
    if (_loadingInterval) { clearInterval(_loadingInterval); _loadingInterval = null; }
  }
}
function showError(msg) {
  var el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  showLoading(false);
}
function hideError() { document.getElementById('errorMsg').style.display = 'none'; }
function hideResults() { document.getElementById('results').style.display = 'none'; }
