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
let _savedMeta = null;
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
  _savedMeta = null;
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: _currentTab.id },
      func: function() {
        function getMeta(names) {
          for (var i = 0; i < names.length; i++) {
            var el = document.querySelector('meta[property="' + names[i] + '"],meta[name="' + names[i] + '"]');
            if (el && el.content) return el.content;
          }
          return '';
        }
        var title = getMeta(['og:title','twitter:title']) || document.title || '';
        var siteName = getMeta(['og:site_name','application-name']) || '';
        var pubDate = getMeta(['article:published_time','og:article:published_time','pubdate','date','DC.date']) || '';
        if (!siteName) siteName = window.location.hostname.replace('www.','');
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
        return {
          text: 'Page Title: ' + document.title + '\nURL: ' + window.location.href + '\n\n' + text.replace(/\s+/g,' ').trim(),
          meta: { title: title, siteName: siteName, pubDate: pubDate, url: window.location.href }
        };
      }
    });
    var result = results[0] && results[0].result;
    if (!result) throw new Error('Could not extract text from page.');
    _savedMeta = result.meta;
    await runDistill(result.text, code);
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
  _savedMeta = null;
  await runDistill(text, code);
}

function extractSummaryFromBuffer(buf) {
  var sumKey = '"summary": "';
  var sumStart = buf.indexOf(sumKey);
  if (sumStart === -1) return null;
  var textStart = sumStart + sumKey.length;
  var textEnd = textStart;
  while (textEnd < buf.length) {
    var ch = buf[textEnd];
    if (ch === '\\') { textEnd += 2; continue; }
    if (ch === '"') break;
    textEnd++;
  }
  var raw = buf.substring(textStart, textEnd)
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return raw.length > 10 ? raw : null;
}

async function runDistill(text, code) {
  _savedResult = null;
  var chunkBuffer = '';

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

          if (msg.chunk) {
            chunkBuffer += msg.chunk;
            var partial = extractSummaryFromBuffer(chunkBuffer);
            if (partial) {
              document.getElementById('summaryText').textContent = partial;
              document.getElementById('summaryCard').style.display = 'block';
              document.getElementById('results').style.display = 'block';
            }
          }

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
    setTimeout(function() { document.getElementById('leanMarker').style.left = pct + '%'; }, 100);
    document.getElementById('leanVerdict').textContent = r.lean;
    var conf = (r.confidence || 'low').toLowerCase();
    var confEl = document.getElementById('confPill');
    confEl.textContent = (r.confidence || '') + ' confidence';
    confEl.className = 'confidence-pill conf-' + conf;
    var signalsEl = document.getElementById('leanSignals');
    signalsEl.innerHTML = '';
    (r.signals || []).forEach(function(s) {
      var li = document.createElement('li'); li.textContent = s; signalsEl.appendChild(li);
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

// Full Report — HTML blob that uses jsPDF internally for PDF generation and email
function openFullReport() {
  var d = _savedResult;
  if (!d) return;
  var timestamp = new Date().toLocaleString();
  var m = _savedMeta || {};

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  var pubDateDisplay = '';
  if (m.pubDate) {
    try {
      pubDateDisplay = new Date(m.pubDate).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    } catch(e) { pubDateDisplay = m.pubDate; }
  }

  // Serialize result data into the blob so jsPDF can use it client-side
  var resultJSON = JSON.stringify(d);
  var metaJSON = JSON.stringify({ title: m.title||'', siteName: m.siteName||'', pubDate: pubDateDisplay, url: m.url||'' });

  var metaHtml = '';
  if (m.title || m.siteName || pubDateDisplay) {
    metaHtml = '<div class="article-meta">';
    if (m.title) metaHtml += '<div class="article-title">' + esc(m.title) + '</div>';
    var byline = [];
    if (m.siteName) byline.push(esc(m.siteName));
    if (pubDateDisplay) byline.push(esc(pubDateDisplay));
    if (byline.length) metaHtml += '<div class="article-byline">' + byline.join(' &bull; ') + '</div>';
    if (m.url) metaHtml += '<div class="article-url"><a href="' + esc(m.url) + '" target="_blank">' + esc(m.url) + '</a></div>';
    metaHtml += '</div>';
  }

  var sectionsHtml = '';
  (d.sections || []).forEach(function(sec) {
    if (!sec.points || !sec.points.length) return;
    sectionsHtml += '<h2>' + esc(sec.title) + '</h2><ul>';
    sec.points.forEach(function(pt) { sectionsHtml += '<li>' + esc(pt) + '</li>'; });
    sectionsHtml += '</ul>';
  });

  var leanHtml = '';
  if (d.lean) {
    var LPOS = {'Left':8,'Center-Left':28,'Center':50,'Center-Right':72,'Right':92};
    var pct = LPOS[d.lean] !== undefined ? LPOS[d.lean] : 50;
    var cconf = (d.confidence||'low').toLowerCase();
    var ccolors = {low:'#cc8800',medium:'#4da6ff',high:'#1D9E75'};
    var cbgs = {low:'#fff8e6',medium:'#e8f0ff',high:'#e8fff6'};
    leanHtml = '<h2>Political Lean Assessment</h2>' +
      '<div class="lean-box">' +
        '<div class="lean-header">' +
          '<span class="lean-title-sm">Political Lean</span>' +
          '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:' + (cbgs[cconf]||'#eee') + ';color:' + (ccolors[cconf]||'#888') + ';">' + esc(d.confidence||'') + ' confidence</span>' +
        '</div>' +
        '<div style="margin:10px 0 4px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:5px;">' +
            '<span>Left</span><span>Center-Left</span><span>Center</span><span>Center-Right</span><span>Right</span>' +
          '</div>' +
          '<div style="position:relative;height:18px;border-radius:9px;background:linear-gradient(to right,#2040a0,#3060c0,#888,#c06030,#a02020);">' +
            '<div style="position:absolute;top:50%;left:' + pct + '%;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:white;border:2px solid #1a2a3a;box-shadow:0 0 0 2px white;"></div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:700;color:#0D6E6E;text-align:center;margin:10px 0 8px;">' + esc(d.lean) + '</div>';
    if (d.signals && d.signals.length) {
      leanHtml += '<ul class="signals">';
      d.signals.forEach(function(s) { leanHtml += '<li>' + esc(s) + '</li>'; });
      leanHtml += '</ul>';
    }
    if (d.caveat) leanHtml += '<p class="caveat">' + esc(d.caveat) + '</p>';
    leanHtml += '</div>';
  }

  // The blob page loads jsPDF and builds PDF client-side, then offers download + email-with-attachment via Web Share API
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>News-Distiller Report</title>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:40px auto;padding:0 24px;background:#f5f7fa;color:#1a2a3a;}' +
    'h1{font-size:22px;color:#0D6E6E;margin-bottom:4px;}' +
    'h2{font-size:14px;font-weight:700;color:#0D6E6E;border-bottom:2px solid #11998E;padding-bottom:4px;margin:22px 0 8px;}' +
    '.report-meta{font-size:12px;color:#888;margin-bottom:16px;}' +
    '.article-meta{background:white;border:1px solid #dde;border-left:4px solid #0D6E6E;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;}' +
    '.article-title{font-size:16px;font-weight:700;color:#1a2a3a;margin-bottom:4px;}' +
    '.article-byline{font-size:12px;color:#666;margin-bottom:4px;}' +
    '.article-url{font-size:11px;color:#888;word-break:break-all;} .article-url a{color:#0D6E6E;}' +
    '.summary{background:white;border:1px solid #dde;border-radius:8px;padding:14px 16px;margin-bottom:4px;font-size:14px;line-height:1.8;color:#333;}' +
    'ul{margin:0 0 12px 0;padding-left:20px;} li{font-size:13px;color:#333;line-height:1.7;margin-bottom:3px;}' +
    '.lean-box{background:white;border:1px solid #dde;border-radius:8px;padding:16px;margin-bottom:10px;}' +
    '.lean-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}' +
    '.lean-title-sm{font-size:12px;font-weight:700;color:#0D6E6E;text-transform:uppercase;letter-spacing:0.5px;}' +
    '.signals{margin:4px 0 8px;padding-left:16px;} .signals li{font-size:12px;color:#555;}' +
    '.caveat{font-size:12px;color:#cc8800;font-style:italic;margin:8px 0 0;padding-top:8px;border-top:1px solid #eee;}' +
    '.btn-row{display:flex;gap:10px;margin:24px 0;flex-wrap:wrap;}' +
    '.btn{padding:11px 22px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-block;}' +
    '.btn-pdf{background:#0D6E6E;color:white;} .btn-mail{background:#1D9E75;color:white;} .btn-copy{background:#f0f4f8;color:#0D6E6E;border:1px solid #0D6E6E;}' +
    '.status{font-size:12px;color:#0D6E6E;margin-top:8px;min-height:18px;}' +
    '.footer{font-size:11px;color:#aaa;margin-top:24px;padding-top:12px;border-top:1px solid #dde;}' +
    '@media print{.btn-row,.status{display:none;}}' +
    '</style></head><body>' +
    '<h1>News-Distiller Report</h1>' +
    '<div class="report-meta">Generated: ' + timestamp + '</div>' +
    metaHtml +
    '<h2>Executive Summary</h2><div class="summary" id="summaryDiv">' + esc(d.summary||'') + '</div>' +
    sectionsHtml +
    leanHtml +
    '<div class="btn-row">' +
    '<button class="btn btn-pdf" onclick="downloadPDF()">⬇ Download PDF</button>' +
    '<button class="btn btn-mail" onclick="emailPDF()">✉ Email PDF</button>' +
    '<button class="btn btn-copy" onclick="copyText()">📋 Copy Text</button>' +
    '</div>' +
    '<div class="status" id="status"></div>' +
    '<div class="footer">Generated by News-Distiller &mdash; app.news-distiller.com &mdash; Powered by Claude AI</div>' +

    '<script>' +
    'var _data = ' + resultJSON + ';' +
    'var _meta = ' + metaJSON + ';' +
    'var _ts = "' + timestamp + '";' +
    'var _pdfBlob = null;' +

    // Build PDF using jsPDF
    'function buildPDF() {' +
    '  var doc = new jspdf.jsPDF({ orientation:"portrait", unit:"pt", format:"letter" });' +
    '  var pw = doc.internal.pageSize.getWidth();' +
    '  var ph = doc.internal.pageSize.getHeight();' +
    '  var margin = 50; var y = margin; var maxW = pw - margin * 2;' +
    '  function checkPage(needed) { if (y + needed > ph - margin) { doc.addPage(); y = margin; } }' +
    '  function addText(text, size, style, color, wrapWidth) {' +
    '    doc.setFontSize(size); doc.setFont("helvetica", style||"normal");' +
    '    if (color) doc.setTextColor(color[0],color[1],color[2]); else doc.setTextColor(30,42,58);' +
    '    var lines = doc.splitTextToSize(text, wrapWidth||maxW);' +
    '    var h = lines.length * size * 1.4;' +
    '    checkPage(h); doc.text(lines, margin, y); y += h;' +
    '    doc.setTextColor(30,42,58);' +
    '  }' +
    '  function addHRule(r,g,b) { doc.setDrawColor(r||13,g||110,b||110); doc.line(margin, y, pw-margin, y); y += 8; }' +
    '  function section(title) { y += 10; checkPage(30); doc.setFontSize(12); doc.setFont("helvetica","bold"); doc.setTextColor(13,110,110); doc.text(title.toUpperCase(), margin, y); y += 6; addHRule(17,153,142); doc.setTextColor(30,42,58); }' +

    // Header
    '  doc.setFontSize(20); doc.setFont("helvetica","bold"); doc.setTextColor(13,110,110);' +
    '  doc.text("News-Distiller Report", margin, y); y += 28;' +
    '  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(120,120,120);' +
    '  doc.text("Generated: " + _ts, margin, y); y += 20;' +

    // Article metadata
    '  if (_meta.title || _meta.siteName) {' +
    '    doc.setFillColor(240,247,245); doc.roundedRect(margin-8, y-4, maxW+16, 4, 2, 2, "F");' +
    '    if (_meta.title) { addText(_meta.title, 13, "bold", [13,110,110]); y += 2; }' +
    '    var byline = []; if (_meta.siteName) byline.push(_meta.siteName); if (_meta.pubDate) byline.push(_meta.pubDate);' +
    '    if (byline.length) { addText(byline.join(" \u2022 "), 9, "normal", [100,100,100]); }' +
    '    if (_meta.url) { addText(_meta.url, 8, "normal", [13,110,110]); }' +
    '    y += 14;' +
    '  }' +

    // Summary
    '  section("Executive Summary");' +
    '  addText(_data.summary||"", 11, "normal", null, maxW); y += 10;' +

    // Sections
    '  (_data.sections||[]).forEach(function(sec) {' +
    '    if (!sec.points || !sec.points.length) return;' +
    '    section(sec.title);' +
    '    sec.points.forEach(function(pt) {' +
    '      checkPage(20);' +
    '      doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(30,42,58);' +
    '      var lines = doc.splitTextToSize(pt, maxW-14);' +
    '      doc.text("\u2022", margin, y); doc.text(lines, margin+10, y);' +
    '      y += lines.length * 14 + 2;' +
    '    }); y += 6;' +
    '  });' +

    // Lean
    '  if (_data.lean) {' +
    '    section("Political Lean Assessment");' +
    '    var leanLine = _data.lean + (_data.confidence ? " (" + _data.confidence + " confidence)" : "");' +
    '    addText(leanLine, 14, "bold", [13,110,110]); y += 4;' +
    '    (_data.signals||[]).forEach(function(s) {' +
    '      checkPage(18); doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(60,80,100);' +
    '      var lines = doc.splitTextToSize(s, maxW-14); doc.text("\u203a", margin, y); doc.text(lines, margin+10, y);' +
    '      y += lines.length * 13 + 2;' +
    '    });' +
    '    if (_data.caveat) { y += 4; addText(_data.caveat, 9, "italic", [160,100,0]); }' +
    '  }' +

    // Footer
    '  y += 20; checkPage(20);' +
    '  doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(160,160,160);' +
    '  doc.text("Generated by News-Distiller \u2014 app.news-distiller.com \u2014 Powered by Claude AI", margin, y);' +

    '  return doc;' +
    '}' +

    'function downloadPDF() {' +
    '  document.getElementById("status").textContent = "Generating PDF\u2026";' +
    '  setTimeout(function() {' +
    '    try {' +
    '      var doc = buildPDF();' +
    '      doc.save("news-distiller-report.pdf");' +
    '      _pdfBlob = doc.output("blob");' +
    '      document.getElementById("status").textContent = "\u2713 PDF downloaded!";' +
    '    } catch(e) { document.getElementById("status").textContent = "Error: " + e.message; }' +
    '  }, 50);' +
    '}' +

    // Email PDF — use Web Share API with PDF blob if available (works on iOS Safari)
    // Falls back to mailto with text body if Web Share not available or PDF share fails
    'function emailPDF() {' +
    '  document.getElementById("status").textContent = "Preparing PDF for email\u2026";' +
    '  setTimeout(function() {' +
    '    try {' +
    '      var doc = buildPDF();' +
    '      _pdfBlob = doc.output("blob");' +
    '      var subject = "News-Distiller Report' + (m.title ? ': ' + m.title.replace(/'/g,"\\'").substring(0,60) : '') + '";' +
    '      var fname = "news-distiller-report.pdf";' +
    '      var file = new File([_pdfBlob], fname, { type: "application/pdf" });' +
    '      if (navigator.canShare && navigator.canShare({ files: [file] })) {' +
    '        navigator.share({ files: [file], title: subject })' +
    '          .then(function() { document.getElementById("status").textContent = "\u2713 Shared!"; })' +
    '          .catch(function(e) { if (e.name !== "AbortError") fallbackMailto(); });' +
    '      } else {' +
    '        fallbackMailto();' +
    '      }' +
    '    } catch(e) { fallbackMailto(); }' +
    '  }, 50);' +
    '}' +

    'function fallbackMailto() {' +
    '  var subj = encodeURIComponent("News-Distiller Report' + (m.title ? ': ' + m.title.substring(0,60) : '') + '");' +
    '  var body = "Please find the News-Distiller report attached (download the PDF from this page and attach it).\\n\\n";' +
    '  body += "EXECUTIVE SUMMARY\\n" + (_data.summary||"") + "\\n\\n";' +
    '  if (_data.lean) body += "POLITICAL LEAN: " + _data.lean + (_data.confidence ? " (" + _data.confidence + " confidence)" : "") + "\\n";' +
    '  body += "\\n---\\nGenerated by News-Distiller \u2014 app.news-distiller.com";' +
    '  window.location.href = "mailto:?subject=" + subj + "&body=" + encodeURIComponent(body);' +
    '  document.getElementById("status").textContent = "Note: Download the PDF above and attach it to your email.";' +
    '}' +

    'function copyText() {' +
    '  var t = "NEWS-DISTILLER REPORT\\nGenerated: " + _ts + "\\n";' +
    '  if (_meta.title) t += "\\nARTICLE: " + _meta.title;' +
    '  if (_meta.siteName) t += "\\nSOURCE: " + _meta.siteName;' +
    '  if (_meta.pubDate) t += "\\nPUBLISHED: " + _meta.pubDate;' +
    '  t += "\\n\\nEXECUTIVE SUMMARY\\n" + (_data.summary||"") + "\\n\\n";' +
    '  (_data.sections||[]).forEach(function(s){ if(s.points&&s.points.length){t+=s.title.toUpperCase()+"\\n"; s.points.forEach(function(p){t+="\u2022 "+p+"\\n";}); t+="\\n";} });' +
    '  if (_data.lean) { t+="POLITICAL LEAN: "+_data.lean+(_data.confidence?" ("+_data.confidence+" confidence)":"")+"\n"; (_data.signals||[]).forEach(function(s){t+="  \u203a "+s+"\\n";}); }' +
    '  t += "\\n---\\nGenerated by News-Distiller \u2014 app.news-distiller.com";' +
    '  navigator.clipboard.writeText(t).then(function(){' +
    '    document.getElementById("status").textContent="\u2713 Copied!";' +
    '    setTimeout(function(){document.getElementById("status").textContent="";},2000);' +
    '  });' +
    '}' +
    '<\/script>' +
    '</body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

async function copyReport() {
  var d = _savedResult;
  if (!d) return;
  var m = _savedMeta || {};
  var text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n';
  if (m.title) text += 'Article: ' + m.title + '\n';
  if (m.siteName) text += 'Source: ' + m.siteName + '\n';
  text += '\n' + (d.summary || '') + '\n\n';
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
  _savedMeta = null;
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
  el.textContent = msg; el.style.display = 'block';
  showLoading(false);
}
function hideError() { document.getElementById('errorMsg').style.display = 'none'; }
function hideResults() { document.getElementById('results').style.display = 'none'; }
