// TruthPrism Safari Extension popup.js

const SERVER_URL = 'https://app.truthprism.app';

let _savedResult = null;
let _savedMeta = null;
let _savedClaims = [];
let _loadingInterval = null;
let _currentTab = null;
let _claimsReceived = 0;
let _totalClaims = 0;

document.addEventListener('DOMContentLoaded', async function() {
  var data = await chrome.storage.local.get(['tp_code']);
  if (data.tp_code) {
    document.getElementById('accessCode').value = data.tp_code;
    showAuthStatus('\u2713 Prism Code configured', 'ok');
    collapseAuth();
    checkRemaining(data.tp_code);
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
  if (!code) { showAuthStatus('Please enter a Prism Code', 'error'); return; }
  await chrome.storage.local.set({ tp_code: code });
  showAuthStatus('\u2713 Code saved!', 'ok');
  setTimeout(collapseAuth, 800);
  checkRemaining(code);
}

async function testCode() {
  var code = document.getElementById('accessCode').value.trim();
  if (!code) { showAuthStatus('Enter a code first', 'error'); return; }
  showAuthStatus('Testing\u2026', '');
  try {
    var r = await fetch(SERVER_URL + '/api/check-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    var d = await r.json();
    if (d.success) {
      var rem = d.remaining != null ? d.remaining : null;
      var remStr = rem === -1 ? 'Unlimited.' : (rem != null ? rem + ' checks left.' : '');
      showAuthStatus('\u2713 Valid! ' + remStr, 'ok');
      if (rem != null) showRemaining(rem);
    } else {
      showAuthStatus('\u2717 ' + (d.error || 'Code not recognized.'), 'error');
    }
  } catch(e) {
    showAuthStatus('\u2717 Cannot connect to server', 'error');
  }
}

async function checkRemaining(code) {
  try {
    var r = await fetch(SERVER_URL + '/api/check-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    var d = await r.json();
    if (d.remaining != null) showRemaining(d.remaining);
  } catch(e) {}
}

function showRemaining(remaining) {
  var banner = document.getElementById('remainingBanner');
  if (remaining == null) { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  if (remaining <= 0) {
    banner.style.cssText = 'display:block;padding:4px 8px;border-radius:4px;margin-bottom:6px;font-size:10px;text-align:center;background:#2a1010;border:1px solid #6a2020;color:#f08080;';
    banner.textContent = '\u26a0 Checks used up. Get a Prism Pack at app.truthprism.app/checkout';
  } else if (remaining <= 3) {
    banner.style.cssText = 'display:block;padding:4px 8px;border-radius:4px;margin-bottom:6px;font-size:10px;text-align:center;background:#2a1f00;border:1px solid #4a3a00;color:#f0d060;';
    banner.textContent = '\u26a0 ' + remaining + ' check' + (remaining !== 1 ? 's' : '') + ' remaining';
  } else {
    banner.style.cssText = 'display:block;padding:4px 8px;border-radius:4px;margin-bottom:6px;font-size:10px;text-align:center;background:#0f2a1a;border:1px solid #1a4a2a;color:#55dd99;';
    banner.textContent = '\u2713 ' + remaining + ' checks remaining';
  }
}

async function getCode() {
  var data = await chrome.storage.local.get(['tp_code']);
  if (!data.tp_code) {
    showError('Please save your Prism Code first.');
    expandAuth();
    return null;
  }
  return data.tp_code;
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
        var siteName = getMeta(['og:site_name','application-name']) || window.location.hostname.replace('www.','');
        var pubDate = getMeta(['article:published_time','og:article:published_time','pubdate','date','DC.date']) || '';
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
    await runCheck(result.text, code);
  } catch(e) {
    showError(e.message || 'Could not read page content.');
    showLoading(false);
  }
}

async function checkCustomText() {
  var code = await getCode();
  if (!code) return;
  var text = document.getElementById('customText').value.trim();
  if (!text) { showError('Please paste some text first.'); return; }
  _savedMeta = null;
  showLoading(true);
  hideError();
  hideResults();
  await runCheck(text, code);
}

function setStep(text) {
  var el = document.getElementById('loadingStep');
  if (el) el.textContent = text;
}

async function runCheck(text, code) {
  _savedResult = null;
  _savedClaims = [];
  _claimsReceived = 0;
  _totalClaims = 0;
  setStep('Analyzing content\u2026');

  try {
    var resp = await fetch(SERVER_URL + '/api/check-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_text: text.substring(0, 10000), access_code: code })
    });
    if (!resp.ok) {
      var ed = await resp.json().catch(function(){ return {}; });
      throw new Error(ed.error || 'Analysis failed \u2014 please try again.');
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
          try {
            var msg = JSON.parse(line.slice(6));
            if (msg.type === 'error') {
              showError(msg.message || 'Analysis failed.'); showLoading(false);
            } else if (msg.type === 'summary') {
              setStep('Step 1: Summarizing article \u2713');
              document.getElementById('summaryHeadline').textContent = msg.headline || '';
              document.getElementById('summaryText').textContent = msg.executive_summary || '';
              document.getElementById('summaryCard').style.display = 'block';
              document.getElementById('results').style.display = 'block';
            } else if (msg.type === 'claim_count') {
              _totalClaims = msg.total;
              setStep('Step 2: Claim 0/' + _totalClaims + ' verified');
            } else if (msg.type === 'claim') {
              _claimsReceived++;
              _savedClaims.push(msg.claim || msg);
              setStep('Step 2: Claim ' + _claimsReceived + '/' + _totalClaims + ' verified');
            } else if (msg.type === 'assessment') {
              setStep('Step 3: Evaluating context\u2026');
              displayResults(msg);
              if (msg.remaining != null) showRemaining(msg.remaining);
            } else if (msg.type === 'done') {
              setStep('Finished');
              showLoading(false);
            }
          } catch(e) {}
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

function getScoreColor(s) {
  if (!s) return '#6688aa';
  return s >= 8 ? '#22c55e' : s >= 6 ? '#f59e0b' : '#ef4444';
}
function getScoreDesc(s) {
  if (!s) return '';
  if (s >= 9) return 'Highly Accurate'; if (s >= 7) return 'Generally Credible';
  if (s >= 5) return 'Mixed'; if (s >= 3) return 'Low Credibility'; return 'Very Low';
}

function displayResults(data) {
  _savedResult = data;
  var factual = data.factual_score || data.score || 0;
  var context = data.context_score || 0;
  document.getElementById('factualScore').textContent = factual + '/10';
  document.getElementById('factualScore').style.color = getScoreColor(factual);
  document.getElementById('factualDesc').textContent = getScoreDesc(factual);
  document.getElementById('contextScore').textContent = context ? context + '/10' : 'N/A';
  document.getElementById('contextScore').style.color = getScoreColor(context);
  document.getElementById('contextDesc').textContent = getScoreDesc(context);
  if (data.headline || data.executive_summary) {
    document.getElementById('summaryHeadline').textContent = data.headline || '';
    document.getElementById('summaryText').textContent = data.executive_summary || '';
    document.getElementById('summaryCard').style.display = 'block';
  }
  if (data.fact_assessment) {
    document.getElementById('factAssessText').textContent = data.fact_assessment;
    document.getElementById('factAssessCard').style.display = 'block';
  }
  if (data.context_assessment) {
    document.getElementById('contextAssessText').textContent = data.context_assessment;
    document.getElementById('contextCard').style.display = 'block';
  }
  if (data.factual_score_rationale || data.context_score_rationale) {
    document.getElementById('factualRationale').textContent = data.factual_score_rationale ? 'Factual: ' + data.factual_score_rationale : '';
    document.getElementById('contextRationale').textContent = data.context_score_rationale ? 'Context: ' + data.context_score_rationale : '';
    document.getElementById('scoreExplainCard').style.display = 'block';
  }
  document.getElementById('results').style.display = 'block';
}

// Full Report — identical pattern to working ND extension
// Fetches jsPDF from local bundle, inlines it, opens blob via chrome.tabs.create
async function openFullReport() {
  var d = _savedResult;
  if (!d) { showError('No results to report. Please run a check first.'); return; }
  var jspdfContent = '';
  try {
    var r = await fetch(chrome.runtime.getURL('jspdf.min.js'));
    if (r.ok) jspdfContent = await r.text();
  } catch(e) {}
  _buildFullReport(d, jspdfContent);
}

function _buildFullReport(d, jspdfContent) {
  var timestamp = new Date().toLocaleString();
  var m = _savedMeta || {};
  var claims = _savedClaims || [];

  function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var pubDateDisplay = '';
  if (m.pubDate) {
    try { pubDateDisplay = new Date(m.pubDate).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}); }
    catch(e) { pubDateDisplay = m.pubDate; }
  }

  var factual = d.factual_score || d.score || 0;
  var context = d.context_score || 0;
  function sc(s) { return s >= 8 ? '#22c55e' : s >= 6 ? '#f59e0b' : '#ef4444'; }

  // Article meta
  var metaHtml = '';
  if (m.title || m.siteName) {
    metaHtml = '<div class="article-meta">';
    if (m.title) metaHtml += '<div class="article-title">' + esc(m.title) + '</div>';
    var bl = [];
    if (m.siteName) bl.push('<strong>' + esc(m.siteName) + '</strong>');
    if (pubDateDisplay) bl.push(esc(pubDateDisplay));
    if (bl.length) metaHtml += '<div class="article-byline">' + bl.join(' &bull; ') + '</div>';
    if (m.url) metaHtml += '<div class="article-url"><a href="' + esc(m.url) + '">' + esc(m.url) + '</a></div>';
    metaHtml += '</div>';
  }

  // Claims
  var claimsHtml = '';
  if (claims.length) {
    claimsHtml = '<h2>Claims Checked</h2>';
    claims.forEach(function(c) {
      var claim = (typeof c === 'object' && c.claim) ? c.claim : String(c);
      var verdict = (typeof c === 'object') ? (c.verdict || '') : '';
      var finding = (typeof c === 'object') ? (c.finding || '') : '';
      var sources = (typeof c === 'object') ? (c.source_summary || '') : '';
      var vc = verdict === 'Supported' ? '#22c55e' : verdict === 'False' ? '#ef4444' : verdict === 'Partially Supported' ? '#f59e0b' : '#94a3b8';
      claimsHtml += '<div class="claim-card"><div class="claim-header"><div class="claim-text">' + esc(claim) + '</div>';
      if (verdict) claimsHtml += '<div class="claim-verdict" style="color:' + vc + ';">' + esc(verdict) + '</div>';
      claimsHtml += '</div>';
      if (finding) claimsHtml += '<div class="claim-finding">' + esc(finding) + '</div>';
      if (sources) claimsHtml += '<div class="claim-sources">Sources: ' + esc(sources) + '</div>';
      claimsHtml += '</div>';
    });
  }

  // Plain text
  var plain = 'TRUTHPRISM REPORT\n' + '='.repeat(50) + '\nGenerated: ' + timestamp + '\n';
  if (m.title) plain += '\nARTICLE:   ' + m.title;
  if (m.siteName) plain += '\nSOURCE:    ' + m.siteName;
  if (pubDateDisplay) plain += '\nPUBLISHED: ' + pubDateDisplay;
  if (m.url) plain += '\nURL:       ' + m.url;
  plain += '\n\nFACTUAL SCORE: ' + factual + '/10\nCONTEXT SCORE: ' + (context || 'N/A') + (context ? '/10' : '') + '\n';
  if (d.executive_summary) plain += '\nEXECUTIVE SUMMARY\n' + '-'.repeat(30) + '\n' + d.executive_summary + '\n';
  claims.forEach(function(c) {
    var claim = (typeof c === 'object' && c.claim) ? c.claim : String(c);
    plain += '\nCLAIM: ' + claim + (c.verdict ? '\nVERDICT: ' + c.verdict : '') + '\n' + (c.finding || '') + '\n';
  });
  if (d.fact_assessment) plain += '\nFACT CHECK ASSESSMENT\n' + '-'.repeat(30) + '\n' + d.fact_assessment + '\n';
  if (d.context_assessment) plain += '\nCONTEXT & FRAMING\n' + '-'.repeat(30) + '\n' + d.context_assessment + '\n';
  plain += '\n' + '='.repeat(50) + '\nGenerated by TruthPrism \u2014 app.truthprism.app\nPowered by Claude AI & Brave Search';

  var html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TruthPrism Report</title>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:820px;margin:0 auto;padding:32px 28px;background:#f4f6f9;color:#1a2a3a;}',
    'h1{font-size:24px;color:#667eea;margin-bottom:2px;font-weight:800;}',
    '.ts{font-size:12px;color:#888;margin-bottom:20px;}',
    'h2{font-size:13px;font-weight:700;color:#667eea;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #764ba2;padding-bottom:5px;margin:24px 0 10px;}',
    '.article-meta{background:white;border-left:5px solid #667eea;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.article-title{font-size:17px;font-weight:700;color:#1a2a3a;margin-bottom:5px;line-height:1.4;}',
    '.article-byline{font-size:12px;color:#555;margin-bottom:4px;}',
    '.article-url{font-size:11px;word-break:break-all;}.article-url a{color:#667eea;}',
    '.scores{display:flex;gap:14px;margin-bottom:16px;}',
    '.score-box{flex:1;background:white;border:1px solid #dde;border-radius:8px;padding:14px;text-align:center;}',
    '.score-lbl{font-size:11px;color:#888;margin-bottom:6px;font-weight:600;text-transform:uppercase;}',
    '.score-num{font-size:32px;font-weight:800;line-height:1;}',
    '.card{background:white;border-radius:8px;padding:14px 18px;margin-bottom:10px;font-size:13px;line-height:1.75;color:#333;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.card-hl{font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:8px;}',
    '.claim-card{background:white;border:1px solid #dde;border-radius:8px;padding:14px;margin-bottom:8px;}',
    '.claim-header{display:flex;justify-content:space-between;margin-bottom:6px;gap:10px;}',
    '.claim-text{font-size:13px;font-weight:600;color:#1a2a3a;flex:1;}',
    '.claim-verdict{font-size:12px;font-weight:700;white-space:nowrap;}',
    '.claim-finding{font-size:12px;color:#444;line-height:1.6;}',
    '.claim-sources{font-size:11px;color:#888;margin-top:4px;font-style:italic;}',
    '.btn-hint{font-size:11px;color:#888;margin-top:4px;}',
    '.footer{font-size:11px;color:#aaa;margin-top:28px;padding-top:14px;border-top:1px solid #dde;text-align:center;}',
    '@media print{.btn-hint{display:none!important;}body{background:white;}}',
    '</style></head><body>',
    '<h1>TruthPrism Report</h1>',
    '<div class="ts">Generated: ' + timestamp + '</div>',
    metaHtml,
    '<div class="scores">',
    '<div class="score-box"><div class="score-lbl" style="color:#60a5fa;">Factual Score</div><div class="score-num" style="color:' + sc(factual) + '">' + factual + '/10</div></div>',
    '<div class="score-box"><div class="score-lbl" style="color:#a78bfa;">Context Score</div><div class="score-num" style="color:' + sc(context) + '">' + (context ? context + '/10' : 'N/A') + '</div></div>',
    '</div>',
    ((d.executive_summary || d.summary) ? '<h2>Executive Summary</h2><div class="card">' + (d.headline ? '<div class="card-hl">' + esc(d.headline) + '</div>' : '') + esc(d.executive_summary || d.summary) + '</div>' : ''),
    claimsHtml,
    (d.fact_assessment ? '<h2>Fact Check Assessment</h2><div class="card">' + esc(d.fact_assessment) + '</div>' : ''),
    (d.context_assessment ? '<h2>Context &amp; Framing</h2><div class="card">' + esc(d.context_assessment) + '</div>' : ''),
    ((d.factual_score_rationale||d.context_score_rationale) ? '<h2>Score Explanation</h2><div class="card">' + (d.factual_score_rationale ? '<div style="margin-bottom:5px;">Factual: ' + esc(d.factual_score_rationale) + '</div>' : '') + (d.context_score_rationale ? '<div>Context: ' + esc(d.context_score_rationale) + '</div>' : '') + '</div>' : ''),
    '<div class="btn-hint" style="line-height:1.6;margin-top:8px;"><strong>Want a PDF?</strong> Open Safari\u2019s share menu \u2192 tap <strong>Options</strong> at top \u2192 select <strong>PDF</strong> \u2192 then Mail, Message, AirDrop, or save it.</div>',
    '<div class="footer">Generated by TruthPrism &mdash; app.truthprism.app &mdash; Powered by Claude AI &amp; Brave Search</div>',
    '<script>' + jspdfContent + '<\/script>',
    '<script>',
    'var _d=' + JSON.stringify(d) + ';',
    'var _m=' + JSON.stringify({title:m.title||'',siteName:m.siteName||'',pubDate:pubDateDisplay,url:m.url||''}) + ';',
    'var _c=' + JSON.stringify(claims) + ';',
    'var _ts=' + JSON.stringify(timestamp) + ';',
    'var _plain=' + JSON.stringify(plain) + ';',
    'function buildPDF(){',
    '  var doc=new jspdf.jsPDF({orientation:"portrait",unit:"pt",format:"letter"});',
    '  var pw=doc.internal.pageSize.getWidth(),ph=doc.internal.pageSize.getHeight(),mg=50,y=mg,mw=pw-mg*2;',
    '  function chk(n){if(y+n>ph-mg){doc.addPage();y=mg;}}',
    '  function txt(s,sz,st,r,g,b){doc.setFontSize(sz);doc.setFont("helvetica",st||"normal");',
    '    doc.setTextColor(r!=null?r:30,g!=null?g:42,b!=null?b:58);',
    '    var ls=doc.splitTextToSize(s,mw);chk(ls.length*sz*1.4);doc.text(ls,mg,y);y+=ls.length*sz*1.4;doc.setTextColor(30,42,58);}',
    '  function sec(t){y+=8;chk(28);doc.setFontSize(11);doc.setFont("helvetica","bold");',
    '    doc.setTextColor(102,126,234);doc.text(t.toUpperCase(),mg,y);y+=6;',
    '    doc.setDrawColor(118,75,162);doc.line(mg,y,pw-mg,y);y+=8;doc.setTextColor(30,42,58);}',
    '  doc.setFontSize(22);doc.setFont("helvetica","bold");doc.setTextColor(102,126,234);',
    '  doc.text("TruthPrism Report",mg,y);y+=26;',
    '  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(130,130,130);',
    '  doc.text("Generated: "+_ts,mg,y);y+=18;',
    '  if(_m.title){txt(_m.title,13,"bold",102,126,234);y+=2;}',
    '  var bl=[];if(_m.siteName)bl.push(_m.siteName);if(_m.pubDate)bl.push(_m.pubDate);',
    '  if(bl.length){txt(bl.join(" \u2022 "),9,"normal",100,100,100);}',
    '  if(_m.url){txt(_m.url,8,"normal",102,126,234);}y+=12;',
    '  sec("Scores");txt("Factual: "+(_d.factual_score||_d.score||0)+"/10  |  Context: "+(_d.context_score||"N/A")+(_d.context_score?"/10":""),12,"bold");y+=8;',
    '  if(_d.executive_summary){sec("Executive Summary");if(_d.headline)txt(_d.headline,12,"bold");txt(_d.executive_summary,11);y+=6;}',
    '  if(_c.length){sec("Claims Checked");',
    '    _c.forEach(function(c){',
    '      var claim=(typeof c==="object"&&c.claim)?c.claim:String(c);',
    '      chk(30);doc.setFontSize(11);doc.setFont("helvetica","bold");doc.setTextColor(30,42,58);',
    '      var ls=doc.splitTextToSize(claim,mw-60);chk(ls.length*14+20);doc.text(ls,mg,y);',
    '      if(c.verdict){var vc=[100,100,100];if(c.verdict==="Supported")vc=[34,197,94];else if(c.verdict==="False")vc=[239,68,68];else if(c.verdict==="Partially Supported")vc=[245,158,11];',
    '        doc.setTextColor(vc[0],vc[1],vc[2]);doc.setFontSize(10);doc.text(c.verdict,pw-mg,y,{align:"right"});}',
    '      y+=ls.length*14+4;',
    '      if(c.finding){doc.setFont("helvetica","normal");doc.setTextColor(60,60,60);var fl=doc.splitTextToSize(c.finding,mw);chk(fl.length*13);doc.text(fl,mg,y);y+=fl.length*13+6;}',
    '      doc.setTextColor(30,42,58);',
    '    });}',
    '  if(_d.fact_assessment){sec("Fact Check Assessment");txt(_d.fact_assessment,11);y+=6;}',
    '  if(_d.context_assessment){sec("Context & Framing");txt(_d.context_assessment,11);y+=6;}',
    '  y+=16;chk(16);doc.setFontSize(8);doc.setFont("helvetica","normal");doc.setTextColor(160,160,160);',
    '  doc.text("Generated by TruthPrism \u2014 app.truthprism.app \u2014 Powered by Claude AI & Brave Search",mg,y);',
    '  return doc;',
    '}',
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
  var factual = d.factual_score || d.score || 0;
  var text = 'TRUTHPRISM ANALYSIS\n' + '='.repeat(40) + '\n\n';
  if (m.title) text += 'Article: ' + m.title + '\n';
  if (m.siteName) text += 'Source: ' + m.siteName + '\n';
  text += '\nFactual Score: ' + factual + '/10\n';
  if (d.context_score) text += 'Context Score: ' + d.context_score + '/10\n';
  if (d.executive_summary) text += '\n' + d.executive_summary + '\n';
  text += '\nGenerated by TruthPrism \u2014 app.truthprism.app\n';
  try {
    await navigator.clipboard.writeText(text);
    var btn = document.getElementById('saveBtn');
    btn.textContent = '\u2713 Copied!';
    setTimeout(function() { btn.textContent = '\ud83d\udccb Copy'; }, 2000);
  } catch(e) {}
}

function resetResults() {
  document.getElementById('results').style.display = 'none';
  ['summaryCard','factAssessCard','contextCard','scoreExplainCard'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('customText').value = '';
  _savedResult = null; _savedMeta = null; _savedClaims = [];
}

function showLoading(on) {
  document.getElementById('loading').style.display = on ? 'block' : 'none';
  document.getElementById('checkBtn').style.display = on ? 'none' : 'block';
  document.getElementById('checkCustomBtn').disabled = on;
  if (on) {
    _loadingInterval = setInterval(function(){}, 9999); // placeholder, steps driven by SSE
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
