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

// Full Report — loads jsPDF from local extension file, no CDN needed
async function openFullReport() {
  // Load jsPDF from the extension bundle (avoids CSP issues with external CDN)
  var jspdfContent = '';
  try {
    var jspdfUrl = chrome.runtime.getURL('jspdf.min.js');
    var r = await fetch(jspdfUrl);
    jspdfContent = await r.text();
  } catch(e) {
    jspdfContent = ''; // fallback: PDF buttons won't work but rest of report will
  }
  _openFullReportWithPDF(jspdfContent);
}

function _openFullReportWithPDF(jspdfContent) {
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

  // Article metadata block
  var metaHtml = '';
  if (m.title || m.siteName || pubDateDisplay) {
    metaHtml = '<div class="article-meta">';
    if (m.title) metaHtml += '<div class="article-title">' + esc(m.title) + '</div>';
    var byline = [];
    if (m.siteName) byline.push('<strong>' + esc(m.siteName) + '</strong>');
    if (pubDateDisplay) byline.push(esc(pubDateDisplay));
    if (byline.length) metaHtml += '<div class="article-byline">' + byline.join(' &bull; ') + '</div>';
    if (m.url) metaHtml += '<div class="article-url"><a href="' + esc(m.url) + '">' + esc(m.url) + '</a></div>';
    metaHtml += '</div>';
  }

  // Sections
  var sectionsHtml = '';
  (d.sections || []).forEach(function(sec) {
    if (!sec.points || !sec.points.length) return;
    sectionsHtml += '<h2>' + esc(sec.title) + '</h2><ul>';
    sec.points.forEach(function(pt) { sectionsHtml += '<li>' + esc(pt) + '</li>'; });
    sectionsHtml += '</ul>';
  });

  // Lean section with inline SVG gradient meter — no external deps
  var leanHtml = '';
  if (d.lean) {
    var LPOS = {'Left':8,'Center-Left':28,'Center':50,'Center-Right':72,'Right':92};
    var pct = LPOS[d.lean] !== undefined ? LPOS[d.lean] : 50;
    var conf = (d.confidence || 'low').toLowerCase();
    var confStyles = {
      low:    'background:#fff3cd;color:#cc8800;',
      medium: 'background:#dbeafe;color:#1d6ed8;',
      high:   'background:#d1fae5;color:#0D6E6E;'
    };
    var confStyle = confStyles[conf] || confStyles.low;

    leanHtml = '<h2>Political Lean Assessment</h2>' +
      '<div class="lean-box">' +
        '<div class="lean-header">' +
          '<span class="lean-label-sm">Political Lean</span>' +
          '<span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;' + confStyle + '">' + esc(d.confidence||'') + ' confidence</span>' +
        '</div>' +
        // Gradient bar using pure CSS — no JS, no external deps
        '<div style="margin:10px 0 4px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:5px;">' +
            '<span>Left</span><span>Center&#8209;Left</span><span>Center</span><span>Center&#8209;Right</span><span>Right</span>' +
          '</div>' +
          '<div style="position:relative;height:20px;border-radius:10px;background:linear-gradient(to right,#2040a0,#4060c0,#888,#c06030,#a02020);">' +
            '<div style="position:absolute;top:50%;left:' + pct + '%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:white;border:3px solid #222;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:24px;font-weight:800;color:#0D6E6E;text-align:center;margin:12px 0 10px;">' + esc(d.lean) + '</div>';
    if (d.signals && d.signals.length) {
      leanHtml += '<ul class="signals">';
      d.signals.forEach(function(s) { leanHtml += '<li>' + esc(s) + '</li>'; });
      leanHtml += '</ul>';
    }
    if (d.caveat) leanHtml += '<p class="caveat">' + esc(d.caveat) + '</p>';
    leanHtml += '</div>';
  }

  // Plain text for email body
  var plainText = 'NEWS-DISTILLER REPORT\n' + '='.repeat(50) + '\nGenerated: ' + timestamp + '\n';
  if (m.title)       plainText += '\nARTICLE:   ' + m.title;
  if (m.siteName)    plainText += '\nSOURCE:    ' + m.siteName;
  if (pubDateDisplay) plainText += '\nPUBLISHED: ' + pubDateDisplay;
  if (m.url)         plainText += '\nURL:       ' + m.url;
  plainText += '\n\n' + '='.repeat(50) + '\nEXECUTIVE SUMMARY\n' + '='.repeat(50) + '\n\n' + (d.summary || '') + '\n';
  (d.sections || []).forEach(function(sec) {
    if (!sec.points || !sec.points.length) return;
    plainText += '\n' + sec.title.toUpperCase() + '\n' + '-'.repeat(30) + '\n';
    sec.points.forEach(function(pt) { plainText += '\u2022 ' + pt + '\n'; });
  });
  if (d.lean) {
    plainText += '\n' + '='.repeat(50) + '\nPOLITICAL LEAN ASSESSMENT\n' + '='.repeat(50) + '\n';
    plainText += d.lean + (d.confidence ? ' (' + d.confidence + ' confidence)' : '') + '\n\n';
    (d.signals || []).forEach(function(s) { plainText += '  \u203a ' + s + '\n'; });
    if (d.caveat) plainText += '\n' + d.caveat + '\n';
  }
  plainText += '\n' + '='.repeat(50) + '\nGenerated by News-Distiller \u2014 app.news-distiller.com\nPowered by Claude AI';

  var mailSubject = 'News-Distiller Report' + (m.title ? ': ' + m.title.substring(0, 60) : '');
  var mailtoHref = 'mailto:?subject=' + encodeURIComponent(mailSubject) + '&body=' + encodeURIComponent(plainText);

  // Fully self-contained HTML — no external scripts or fonts
  var html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<title>News-Distiller Report</title>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
    '  max-width:820px;margin:0 auto;padding:32px 28px;background:#f4f6f9;color:#1a2a3a;}',
    'h1{font-size:24px;color:#0D6E6E;margin-bottom:2px;font-weight:800;}',
    '.report-ts{font-size:12px;color:#888;margin-bottom:20px;}',
    'h2{font-size:13px;font-weight:700;color:#0D6E6E;text-transform:uppercase;letter-spacing:.6px;',
    '  border-bottom:2px solid #11998E;padding-bottom:5px;margin:24px 0 10px;}',
    '.article-meta{background:white;border-left:5px solid #0D6E6E;border-radius:0 8px 8px 0;',
    '  padding:14px 18px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.article-title{font-size:17px;font-weight:700;color:#1a2a3a;margin-bottom:5px;line-height:1.4;}',
    '.article-byline{font-size:12px;color:#555;margin-bottom:4px;}',
    '.article-url{font-size:11px;word-break:break-all;} .article-url a{color:#0D6E6E;}',
    '.summary{background:white;border-radius:8px;padding:16px 18px;',
    '  font-size:14px;line-height:1.8;color:#2a3a4a;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    'ul{margin:0 0 4px 0;padding-left:18px;}',
    'li{font-size:13px;color:#2a3a4a;line-height:1.75;margin-bottom:3px;padding-left:4px;}',
    '.lean-box{background:white;border-radius:8px;padding:18px;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.lean-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
    '.lean-label-sm{font-size:11px;font-weight:700;color:#0D6E6E;text-transform:uppercase;letter-spacing:.5px;}',
    '.signals{list-style:none;padding:0;margin:4px 0 10px;}',
    '.signals li{font-size:12px;color:#445566;padding:3px 0 3px 14px;position:relative;line-height:1.5;}',
    '.signals li::before{content:"\u203a";position:absolute;left:0;color:#0D6E6E;font-weight:700;}',
    '.caveat{font-size:12px;color:#cc8800;font-style:italic;margin-top:10px;',
    '  padding-top:10px;border-top:1px solid #eee;line-height:1.5;}',
    '.btn-row{display:flex;gap:12px;margin:28px 0 8px;flex-wrap:wrap;}',
    '.btn{padding:12px 24px;border:none;border-radius:8px;font-size:13px;font-weight:700;',
    '  cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;',
    '  transition:opacity .15s;}',
    '.btn:hover{opacity:.85;}',
    '.btn-pdf{background:#0D6E6E;color:white;}',
    '.btn-mail{background:#1D9E75;color:white;}',
    '.btn-copy{background:white;color:#0D6E6E;border:2px solid #0D6E6E;}',
    '.btn-hint{font-size:11px;color:#888;margin-top:6px;}',
    '.footer{font-size:11px;color:#aaa;margin-top:28px;padding-top:14px;border-top:1px solid #dde;text-align:center;}',
    // Print styles — hide buttons, white background, show full content
    '@media print{',
    '  body{background:white;padding:20px;}',
    '  .btn-row,.btn-hint{display:none!important;}',
    '  .article-meta,.summary,.lean-box{box-shadow:none;border:1px solid #ddd;}',
    '}',
    '</style></head><body>',
    '<h1>News-Distiller Report</h1>',
    '<div class="report-ts">Generated: ' + timestamp + '</div>',
    metaHtml,
    '<h2>Executive Summary</h2>',
    '<div class="summary">' + esc(d.summary || '') + '</div>',
    sectionsHtml,
    leanHtml,
    '<div class="btn-row">',
    '<button class="btn btn-pdf" id="pdfBtn">⬇ Download PDF</button>',
    '<a class="btn btn-mail" id="mailBtn" href="' + esc(mailtoHref) + '">✉ Email Report</a>',
    '<button class="btn btn-copy" id="copyBtn">📋 Copy Text</button>',
    '</div>',
    '<div class="btn-hint">Tip: To email as PDF — download it first, then attach the file to your email.</div>',
    '<div class="footer">Generated by News-Distiller &mdash; app.news-distiller.com &mdash; Powered by Claude AI</div>',
    '<script>' + jspdfContent + '<\/script>',
    '<script>',
    'var _data=' + JSON.stringify(d) + ';',
    'var _meta=' + JSON.stringify({title:m.title||'',siteName:m.siteName||'',pubDate:pubDateDisplay,url:m.url||''}) + ';',
    'var _ts=' + JSON.stringify(timestamp) + ';',
    'var _plain=' + JSON.stringify(plainText) + ';',
    'var LPOS={"Left":8,"Center-Left":28,"Center":50,"Center-Right":72,"Right":92};',
    'function buildPDF(){',
    '  var doc=new jspdf.jsPDF({orientation:"portrait",unit:"pt",format:"letter"});',
    '  var pw=doc.internal.pageSize.getWidth(),ph=doc.internal.pageSize.getHeight(),mg=50,y=mg,mw=pw-mg*2;',
    '  function chk(n){if(y+n>ph-mg){doc.addPage();y=mg;}}',
    '  function txt(s,sz,st,r,g,b){doc.setFontSize(sz);doc.setFont("helvetica",st||"normal");',
    '    doc.setTextColor(r!=null?r:30,g!=null?g:42,b!=null?b:58);',
    '    var ls=doc.splitTextToSize(s,mw);chk(ls.length*sz*1.4);doc.text(ls,mg,y);y+=ls.length*sz*1.4;',
    '    doc.setTextColor(30,42,58);}',
    '  function sec(t){y+=8;chk(28);doc.setFontSize(11);doc.setFont("helvetica","bold");',
    '    doc.setTextColor(13,110,110);doc.text(t.toUpperCase(),mg,y);y+=6;',
    '    doc.setDrawColor(17,153,142);doc.line(mg,y,pw-mg,y);y+=8;doc.setTextColor(30,42,58);}',
    // Header
    '  doc.setFontSize(20);doc.setFont("helvetica","bold");doc.setTextColor(13,110,110);',
    '  doc.text("News-Distiller Report",mg,y);y+=26;',
    '  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(130,130,130);',
    '  doc.text("Generated: "+_ts,mg,y);y+=18;',
    // Meta
    '  if(_meta.title){txt(_meta.title,13,"bold",13,110,110);y+=2;}',
    '  var bl=[];if(_meta.siteName)bl.push(_meta.siteName);if(_meta.pubDate)bl.push(_meta.pubDate);',
    '  if(bl.length){txt(bl.join(" \u2022 "),9,"normal",100,100,100);}',
    '  if(_meta.url){txt(_meta.url,8,"normal",13,110,110);}',
    '  y+=12;',
    // Summary
    '  sec("Executive Summary");txt(_data.summary||"",11);y+=8;',
    // Sections
    '  (_data.sections||[]).forEach(function(s){',
    '    if(!s.points||!s.points.length)return;sec(s.title);',
    '    s.points.forEach(function(p){chk(20);doc.setFontSize(10);doc.setFont("helvetica","normal");',
    '      var ls=doc.splitTextToSize(p,mw-12);doc.text("\u2022",mg,y);doc.text(ls,mg+10,y);y+=ls.length*14+2;});y+=4;',
    '  });',
    // Lean
    '  if(_data.lean){sec("Political Lean Assessment");',
    '    txt(_data.lean+(_data.confidence?" ("+_data.confidence+" confidence)":""),14,"bold",13,110,110);y+=4;',
    '    (_data.signals||[]).forEach(function(s){chk(16);doc.setFontSize(10);doc.setFont("helvetica","normal");',
    '      doc.setTextColor(60,80,100);var ls=doc.splitTextToSize(s,mw-12);',
    '      doc.text("\u203a",mg,y);doc.text(ls,mg+10,y);y+=ls.length*13+2;});',
    '    if(_data.caveat){y+=4;txt(_data.caveat,9,"italic",160,100,0);}}',
    // Footer
    '  y+=16;chk(16);doc.setFontSize(8);doc.setFont("helvetica","normal");doc.setTextColor(160,160,160);',
    '  doc.text("Generated by News-Distiller \u2014 app.news-distiller.com",mg,y);',
    '  return doc;',
    '}',
    'document.addEventListener("DOMContentLoaded", function() {',
    '  document.getElementById("pdfBtn").addEventListener("click", function() {',
    '    var b=document.getElementById("pdfBtn");',
    '    b.textContent="Generating PDF\u2026";b.disabled=true;',
    '    setTimeout(function(){',
    '      try{buildPDF().save("news-distiller-report.pdf");b.textContent="\u2713 Downloaded!";}',
    '      catch(e){b.textContent="\u26a0 Error: "+e.message;}',
    '      b.disabled=false;',
    '    },50);',
    '  });',
    '  document.getElementById("copyBtn").addEventListener("click", function() {',
    '    navigator.clipboard.writeText(_plain).then(function() {',
    '      var b = document.getElementById("copyBtn");',
    '      b.textContent = "\u2713 Copied!";',
    '      setTimeout(function() { b.textContent = "\ud83d\udccb Copy Text"; }, 2000);',
    '    });',
    '  });',
    '});',
    '<\/script>',
    '</body></html>'
  ].join('');

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
