// News-Distiller Safari Extension popup.js

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

// Extract summary from partially-streamed JSON, handling escaped quotes correctly
function extractSummaryFromBuffer(buf) {
  var sumKey = '"summary": "';
  var sumStart = buf.indexOf(sumKey);
  if (sumStart === -1) return null;
  var textStart = sumStart + sumKey.length;
  var textEnd = textStart;
  while (textEnd < buf.length) {
    var ch = buf[textEnd];
    if (ch === '\\') { textEnd += 2; continue; } // skip escaped char
    if (ch === '"') break; // end of string
    textEnd++;
  }
  var partial = buf.substring(textStart, textEnd)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  return partial.length > 20 ? partial : null;
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

          // Accumulate chunks and show summary progressively
          if (msg.chunk) {
            chunkBuffer += msg.chunk;
            if (!summaryShown) {
              var partial = extractSummaryFromBuffer(chunkBuffer);
              if (partial) {
                document.getElementById('summaryText').textContent = partial;
                document.getElementById('summaryCard').style.display = 'block';
                document.getElementById('results').style.display = 'block';
                summaryShown = true;
                // Keep spinner running until done event
              }
            }
          }

          // Final done event — render complete results
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
  document.getElementById('summaryText').textContent = r.summary || '';
  document.getElementById('summaryCard').style.display = 'block';

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
    if (r.caveat) { caveatEl.textContent = r.caveat; caveatEl.style.display = 'block'; }
    else { caveatEl.style.display = 'none'; }
    document.getElementById('biasCard').style.display = 'block';
  } else {
    document.getElementById('biasCard').style.display = 'none';
  }
  document.getElementById('results').style.display = 'block';
}

// Full Report — generates HTML blob with PDF save and Mail buttons (matches TruthPrism pattern)
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
    sectionsHtml += '<h2>' + esc(sec.title) + '</h2><ul>';
    sec.points.forEach(function(pt) {
      sectionsHtml += '<li>' + esc(pt) + '</li>';
    });
    sectionsHtml += '</ul>';
  });

  var leanHtml = '';
  if (d.lean) {
    leanHtml = '<h2>Political Lean Assessment</h2>' +
      '<div class="lean-box">' +
      '<div class="lean-verdict">' + esc(d.lean) +
      (d.confidence ? ' <span class="conf">(' + esc(d.confidence) + ' confidence)</span>' : '') + '</div>';
    if (d.signals && d.signals.length) {
      leanHtml += '<ul class="signals">';
      d.signals.forEach(function(s) { leanHtml += '<li>' + esc(s) + '</li>'; });
      leanHtml += '</ul>';
    }
    if (d.caveat) leanHtml += '<p class="caveat">' + esc(d.caveat) + '</p>';
    leanHtml += '</div>';
  }

  // Build plain text version for mail/copy
  var plainText = 'NEWS-DISTILLER REPORT\nGenerated: ' + timestamp + '\n\n';
  plainText += 'EXECUTIVE SUMMARY\n' + (d.summary || '') + '\n\n';
  (d.sections || []).forEach(function(sec) {
    if (!sec.points || !sec.points.length) return;
    plainText += sec.title.toUpperCase() + '\n';
    sec.points.forEach(function(pt) { plainText += '\u2022 ' + pt + '\n'; });
    plainText += '\n';
  });
  if (d.lean) {
    plainText += 'POLITICAL LEAN: ' + d.lean;
    if (d.confidence) plainText += ' (' + d.confidence + ' confidence)';
    plainText += '\n';
    (d.signals || []).forEach(function(s) { plainText += '  \u203a ' + s + '\n'; });
    if (d.caveat) plainText += '\n' + d.caveat + '\n';
  }
  plainText += '\n---\nGenerated by News-Distiller \u2014 app.news-distiller.com';

  var mailSubject = encodeURIComponent('News-Distiller Report');
  var mailBody = encodeURIComponent(plainText);
  var mailtoLink = 'mailto:?subject=' + mailSubject + '&body=' + mailBody;

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>News-Distiller Report</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:40px auto;padding:0 24px;background:#f5f7fa;color:#1a2a3a;}' +
    'h1{font-size:22px;color:#0D6E6E;margin-bottom:4px;}' +
    'h2{font-size:14px;font-weight:700;color:#0D6E6E;border-bottom:2px solid #0D6E6E;padding-bottom:4px;margin:20px 0 8px;}' +
    '.meta{font-size:12px;color:#888;margin-bottom:20px;}' +
    '.summary{background:white;border-left:4px solid #0D6E6E;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:4px;font-size:14px;line-height:1.8;color:#333;}' +
    'ul{margin:0 0 12px 0;padding-left:20px;}' +
    'li{font-size:13px;color:#333;line-height:1.7;margin-bottom:3px;}' +
    '.lean-box{background:white;border-radius:8px;border:1px solid #dde;padding:14px;margin-bottom:10px;}' +
    '.lean-verdict{font-size:20px;font-weight:700;color:#0D6E6E;margin-bottom:8px;}' +
    '.conf{font-size:12px;font-weight:400;color:#888;}' +
    '.signals{margin:6px 0 8px;padding-left:16px;}' +
    '.signals li{font-size:12px;color:#555;}' +
    '.caveat{font-size:12px;color:#cc8800;font-style:italic;margin:8px 0 0;padding-top:8px;border-top:1px solid #eee;}' +
    '.btn-row{display:flex;gap:10px;margin:24px 0;flex-wrap:wrap;}' +
    '.btn{padding:11px 22px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;}' +
    '.btn-pdf{background:#0D6E6E;color:white;}' +
    '.btn-mail{background:#1D9E75;color:white;}' +
    '.btn-copy{background:#f0f4f8;color:#0D6E6E;border:1px solid #0D6E6E;}' +
    '.footer{font-size:11px;color:#aaa;margin-top:24px;padding-top:12px;border-top:1px solid #dde;}' +
    '@media print{.btn-row{display:none;}.body{background:white;margin:0;}}' +
    '</style></head><body>' +
    '<h1>News-Distiller Report</h1>' +
    '<div class="meta">Generated: ' + timestamp + '</div>' +
    '<h2>Executive Summary</h2>' +
    '<div class="summary">' + esc(d.summary || '') + '</div>' +
    sectionsHtml +
    leanHtml +
    '<div class="btn-row">' +
    '<button class="btn btn-pdf" onclick="window.print()">🖨 Save as PDF</button>' +
    '<a class="btn btn-mail" href="' + mailtoLink + '">✉ Email Report</a>' +
    '<button class="btn btn-copy" onclick="copyText()">📋 Copy Text</button>' +
    '</div>' +
    '<div class="footer">Generated by News-Distiller &mdash; app.news-distiller.com &mdash; Powered by Claude AI</div>' +
    '<script>' +
    'var _plain=' + JSON.stringify(plainText) + ';' +
    'function copyText(){navigator.clipboard.writeText(_plain).then(function(){' +
    'var b=document.querySelector(".btn-copy");b.textContent="\u2713 Copied!";setTimeout(function(){b.textContent="\ud83d\udccb Copy Text"},2000);});}' +
    '<\/script>' +
    '</body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

async function copyReport() {
  var d = _savedResult;
  if (!d) return;
  var text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n' + (d.summary || '') + '\n\n';
  if (d.lean) {
    text += 'Political Lean: ' + d.lean + (d.confidence ? ' (' + d.confidence + ' confidence)' : '') + '\n';
    (d.signals || []).forEach(function(s) { text += '  \u203a ' + s + '\n'; });
    if (d.caveat) text += '\n' + d.caveat + '\n';
  }
  text += '\nDistilled by News-Distiller (app.news-distiller.com)\n';
  try {
    await navigator.clipboard.writeText(text);
    var btn = document.getElementById('saveBtn');
    btn.textContent = '\u2713 Copied!';
    setTimeout(function() { btn.textContent = '\ud83d\udccb Copy'; }, 2000);
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
