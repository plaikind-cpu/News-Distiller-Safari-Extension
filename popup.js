// TruthPrism Safari Extension popup.js

const SERVER_URL = 'https://app.truthprism.app';

const LEAN_POSITIONS = { 'Left': 8, 'Center-Left': 28, 'Center': 50, 'Center-Right': 72, 'Right': 92 };

let _savedResult = null;

const DEMO_RESULT = {
  score: 7,
  context_score: 8,
  headline: "David Attenborough celebrates his 100th birthday with widespread public acclaim for his seven-decade career.",
  executive_summary: "Sir David Attenborough, the renowned British wildlife documentarian and climate campaigner, celebrates his 100th birthday on May 8, 2026, with special events across London including concerts, museum exhibitions, and public gatherings. Born in 1926, Attenborough has spent over seven decades bringing intimate nature scenes to hundreds of millions of viewers through his BBC documentaries, earning him status as a British national hero.",
  claims: [
    { claim: "Attenborough's documentaries have brought intimate nature scenes to hundreds of millions of viewers worldwide", verdict: "Supported", confidence: "High", finding: "Multiple sources confirm his documentaries have reached hundreds of millions globally. 'Life on Earth' alone was watched by 500 million people worldwide." },
    { claim: "Attenborough has maintained an active filming career into his late 90s", verdict: "Partially Supported", confidence: "Medium", finding: "His birth date is May 8, 1926, making him 99 at the time of this article. His long career is well-documented but the specific age in some claims contained a minor discrepancy." },
    { claim: "Attenborough possesses a unique ability to connect with both animals and diverse human audiences", verdict: "Supported", confidence: "High", finding: "Multiple sources confirm his unique connection with both wildlife and audiences. His approach makes viewers feel a kinship to the animals." },
    { claim: "The British public views Attenborough as a national hero deserving of widespread celebration", verdict: "Supported", confidence: "High", finding: "A YouGov survey shows 36% of the public named David Attenborough as a national treasure — the highest number by far." }
  ],
  fact_assessment: "Most core assertions about David Attenborough's career and public standing prove accurate. His documentaries have reached hundreds of millions of viewers globally, his unique ability to connect with wildlife and audiences is well-documented, and polling confirms the British public views him as a national hero. The article's factual foundation remains largely solid.",
  context_assessment: "The article presents Attenborough's milestone birthday celebration and provides appropriate historical context. The biographical details and career achievements are well-covered. The contextual presentation is generally sound and captures the scope of his cultural impact effectively.",
  factual_score_rationale: "Most claims about Attenborough's career impact and public standing are well-supported by multiple independent sources.",
  context_score_rationale: "The article provides good biographical context about Attenborough's career span and achievements, meeting typical expectations for a celebratory profile piece.",
  framing_issues: ["The article presents Attenborough's 100th birthday as a current event with appropriate celebration context"]
};
const DEMO_URL   = "https://www.npr.org/2026/05/08/nx-s1-5802305/david-attenborough-celebrates-his-100th-birthday";
const DEMO_TITLE = "David Attenborough celebrates his 100th birthday — NPR";

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
  var sampleBtn = document.getElementById('sampleBtn');
  if (sampleBtn) sampleBtn.addEventListener('click', showDemo);
  initTextToggle();
  document.getElementById('checkCustomBtn').addEventListener('click', checkCustomText);
  document.getElementById('saveBtn').addEventListener('click', copyReport);
  document.getElementById('newCheckBtn').addEventListener('click', resetResults);
  document.getElementById('fullReportBtn').addEventListener('click', openFullReport);

  // Help modal wiring
  var helpLink = document.getElementById('helpLink');
  var helpOverlay = document.getElementById('helpOverlay');
  var helpClose = document.getElementById('helpClose');
  function _showHelp(e) { if (e) e.preventDefault(); if (helpOverlay) helpOverlay.classList.add('show'); }
  function _hideHelp() { if (helpOverlay) helpOverlay.classList.remove('show'); }
  if (helpLink) helpLink.addEventListener('click', _showHelp);
  if (helpClose) helpClose.addEventListener('click', _hideHelp);
  if (helpOverlay) helpOverlay.addEventListener('click', function(e) { if (e.target === helpOverlay) _hideHelp(); });
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
      body: JSON.stringify({ access_code: code, platform: 'ios' })
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
      body: JSON.stringify({ access_code: code, platform: 'ios' })
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

        // STRATEGY 1: JSON-LD structured data (works on most major news sites — NYT, WaPo, WSJ, BBC,
        // Atlantic, Bloomberg, Reuters, AP, Guardian, etc — even when paywall is up, since this is published for SEO).
        function findArticleInJsonLd() {
          var scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (var s = 0; s < scripts.length; s++) {
            var raw = scripts[s].textContent || '';
            if (!raw) continue;
            try {
              var data = JSON.parse(raw);
              var found = walkForArticleBody(data);
              if (found && found.length > 500) return found;
            } catch(e) {}
          }
          return '';
        }
        function walkForArticleBody(node) {
          if (!node || typeof node === 'string') return '';
          if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) {
              var r = walkForArticleBody(node[i]);
              if (r) return r;
            }
            return '';
          }
          if (typeof node === 'object') {
            if (typeof node.articleBody === 'string' && node.articleBody.length > 500) {
              var body = node.articleBody;
              if (typeof node.headline === 'string') body = node.headline + '\n\n' + body;
              else if (typeof node.name === 'string') body = node.name + '\n\n' + body;
              return body;
            }
            if (node['@graph']) { var r = walkForArticleBody(node['@graph']); if (r) return r; }
            if (node.mainEntity) { var r = walkForArticleBody(node.mainEntity); if (r) return r; }
            for (var k in node) {
              if (k === '@graph' || k === 'mainEntity') continue;
              var r = walkForArticleBody(node[k]);
              if (r) return r;
            }
          }
          return '';
        }

        // STRATEGY 2: Site-specific selectors
        function findArticleBySiteSelectors() {
          var siteSelectors = [
            '[data-testid="StandardArticleBody"]', 'section[name="articleBody"]',
            'section.article-content', 'div.article-wrap',
            '[data-qa="article-body"]', '.article-body',
            '.body-content', '.body-copy',
            '[data-event-module="article body"]', 'section.l-article__body',
            'article[itemprop="articleBody"]', '[itemprop="articleBody"]',
            'article', '[role="article"]',
            '[class*="article-body"]', '[class*="story-body"]',
            '[class*="post-content"]', '[class*="entry-content"]',
            '[class*="article-content"]', '[class*="story-content"]',
            'main', '#main-content', '#content'
          ];
          for (var i = 0; i < siteSelectors.length; i++) {
            var els = document.querySelectorAll(siteSelectors[i]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              var clone = el.cloneNode(true);
              clone.querySelectorAll('aside,nav,footer,header,figure figcaption,.ad,.ads,[class*="newsletter"],[class*="related"],[class*="recommend"],[aria-hidden="true"],[role="complementary"]').forEach(function(n){n.remove();});
              var t = (clone.innerText || '').trim();
              if (t.length > 500) return t;
            }
          }
          return '';
        }

        // STRATEGY 3: Densest <p> cluster
        function findArticleByDensestParas() {
          var allParas = document.querySelectorAll('p');
          if (allParas.length < 3) return '';
          var parents = new Map();
          allParas.forEach(function(p) {
            var t = (p.innerText || '').trim();
            if (t.length < 30) return;
            var par = p.parentElement;
            if (!par) return;
            if (!parents.has(par)) parents.set(par, 0);
            parents.set(par, parents.get(par) + t.length);
          });
          var best = null, bestLen = 0;
          parents.forEach(function(len, el) {
            if (len > bestLen) { bestLen = len; best = el; }
          });
          if (best && bestLen > 500) {
            var paras = best.querySelectorAll('p');
            var out = [];
            for (var i = 0; i < paras.length; i++) {
              var t = (paras[i].innerText || '').trim();
              if (t.length >= 30) out.push(t);
            }
            return out.join('\n\n');
          }
          return '';
        }

        // STRATEGY 4: Body fallback
        function findArticleByBodyFallback() {
          var clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,nav,footer,header,aside,form,iframe,[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"]').forEach(function(e){e.remove();});
          return (clone.innerText || '').trim();
        }

        var attempts = [
          findArticleInJsonLd(),
          findArticleBySiteSelectors(),
          findArticleByDensestParas()
        ];
        var best = '';
        for (var i = 0; i < attempts.length; i++) {
          if (attempts[i] && attempts[i].length > best.length) best = attempts[i];
        }
        if (best.length < 500) {
          var fb = findArticleByBodyFallback();
          if (fb.length > best.length) best = fb;
        }
        var cleaned = best.replace(/\s+/g, ' ').trim();
        return {
          text: 'Page Title: ' + document.title + '\nURL: ' + window.location.href + '\n\n' + cleaned,
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
      body: JSON.stringify({ claim_text: text.substring(0, 10000), access_code: code, platform: 'ios' })
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

function showDemo() {
  displayResults(DEMO_RESULT);
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
  // Political lean gauge
  if (data.lean) {
    var pct = LEAN_POSITIONS[data.lean] !== undefined ? LEAN_POSITIONS[data.lean] : 50;
    setTimeout(function() { document.getElementById('leanMarker').style.left = pct + '%'; }, 100);
    document.getElementById('leanVerdict').textContent = data.lean;
    var conf = (data.confidence || 'low').toLowerCase();
    var confEl = document.getElementById('confPill');
    confEl.textContent = (data.confidence || '') + ' confidence';
    confEl.className = 'confidence-pill conf-' + conf;
    var signalsEl = document.getElementById('leanSignals');
    signalsEl.innerHTML = '';
    (data.signals || []).forEach(function(s) {
      var li = document.createElement('li'); li.textContent = s; signalsEl.appendChild(li);
    });
    var caveatEl = document.getElementById('leanCaveat');
    if (data.caveat) { caveatEl.textContent = data.caveat; caveatEl.style.display = 'block'; }
    else { caveatEl.style.display = 'none'; }
    document.getElementById('biasCard').style.display = 'block';
  } else {
    document.getElementById('biasCard').style.display = 'none';
  }
  document.getElementById('results').style.display = 'block';
}

// Full Report — identical pattern to working ND extension
// Fetches jsPDF from local bundle, inlines it, opens blob via chrome.tabs.create
function openFullReport() {
  var d = _savedResult;
  if (!d) { showError('No results to report. Please run a check first.'); return; }
  _buildFullReport(d);
}

function _buildFullReport(d) {
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
  if (d.lean) plain += '\nPOLITICAL LEAN\n' + '-'.repeat(30) + '\n' + d.lean + (d.confidence ? ' (' + d.confidence + ' confidence)' : '') + '\n' + (d.signals||[]).join('\n') + '\n';
  if (d.fact_assessment) plain += '\nFACT CHECK ASSESSMENT\n' + '-'.repeat(30) + '\n' + d.fact_assessment + '\n';
  if (d.context_assessment) plain += '\nCONTEXT & FRAMING\n' + '-'.repeat(30) + '\n' + d.context_assessment + '\n';
  plain += '\n' + '='.repeat(50) + '\nGenerated by TruthPrism \u2014 app.truthprism.app\nPowered by Claude AI & Brave Search';

  var styleParts = [
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:820px;margin:0 auto;padding:32px 28px;background:#f4f6f9;color:#1a2a3a;}',
    'h1{font-size:28px;color:#667eea;margin-bottom:2px;font-weight:800;}',
    '.ts{font-size:14px;color:#888;margin-bottom:20px;}',
    'h2{font-size:15px;font-weight:700;color:#667eea;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #764ba2;padding-bottom:5px;margin:24px 0 10px;}',
    '.article-meta{background:white;border-left:5px solid #667eea;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.article-title{font-size:20px;font-weight:700;color:#1a2a3a;margin-bottom:5px;line-height:1.4;}',
    '.article-byline{font-size:14px;color:#555;margin-bottom:4px;}',
    '.article-url{font-size:13px;word-break:break-all;}.article-url a{color:#667eea;}',
    '.scores{display:flex;gap:14px;margin-bottom:16px;}',
    '.score-box{flex:1;background:white;border:1px solid #dde;border-radius:8px;padding:14px;text-align:center;}',
    '.score-lbl{font-size:11px;color:#888;margin-bottom:6px;font-weight:600;text-transform:uppercase;}',
    '.score-num{font-size:32px;font-weight:800;line-height:1;}',
    '.card{background:white;border-radius:8px;padding:14px 18px;margin-bottom:10px;font-size:15px;line-height:1.75;color:#333;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.card-hl{font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:8px;}',
    '.claim-card{background:white;border:1px solid #dde;border-radius:8px;padding:14px;margin-bottom:8px;}',
    '.claim-header{display:flex;justify-content:space-between;margin-bottom:6px;gap:10px;}',
    '.claim-text{font-size:15px;font-weight:600;color:#1a2a3a;flex:1;}',
    '.claim-verdict{font-size:14px;font-weight:700;white-space:nowrap;}',
    '.claim-finding{font-size:14px;color:#444;line-height:1.6;}',
    '.claim-sources{font-size:11px;color:#888;margin-top:4px;font-style:italic;}',
    '.pdf-hint{font-size:14px;color:#1a2a3a;background:linear-gradient(135deg,#667eea,#764ba2);background:#eef2ff;border:2px solid #667eea;border-radius:10px;padding:16px 18px;margin:24px 0 8px;line-height:1.6;display:flex;gap:14px;align-items:flex-start;box-shadow:0 2px 8px rgba(102,126,234,0.15);}',
    '.pdf-hint .share-icon{flex-shrink:0;width:28px;height:36px;color:#667eea;}',
    '.pdf-hint-text{flex:1;}',
    '.pdf-hint-title{font-weight:800;color:#5a3d9e;margin-bottom:4px;font-size:15px;}',
    '.pdf-hint kbd{display:inline-block;background:white;border:1px solid #c0c8e8;border-radius:5px;padding:1px 7px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:700;color:#5a3d9e;box-shadow:0 1px 0 rgba(0,0,0,0.05);}',
    '.footer{font-size:11px;color:#aaa;margin-top:28px;padding-top:14px;border-top:1px solid #dde;text-align:center;}',
    '@media print{.pdf-hint{display:none!important;}.tp-aa-btn{display:none!important;}body{background:white;}}',
    // Aa text-size toggle button
    '.tp-aa-btn{position:fixed;top:14px;right:14px;z-index:9999;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:6px 14px;font-size:14px;font-weight:700;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.2);}',
    '.tp-aa-btn:hover{background:rgba(0,0,0,0.75);}',
    '.tp-aa-btn.active{background:#667eea;border-color:rgba(255,255,255,0.4);}',
    // Large-text mode for report page
    'body.large-text .article-title{font-size:24px;}',
    'body.large-text .article-byline,body.large-text .article-url{font-size:16px;}',
    'body.large-text h2{font-size:17px;}',
    'body.large-text .score-lbl{font-size:13px;}',
    'body.large-text .score-num{font-size:38px;}',
    'body.large-text .card{font-size:17px;line-height:1.85;}',
    'body.large-text .card-hl{font-size:16px;}',
    'body.large-text .claim-text{font-size:17px;}',
    'body.large-text .claim-verdict{font-size:16px;}',
    'body.large-text .claim-finding{font-size:16px;line-height:1.7;}',
    'body.large-text .claim-sources{font-size:13px;}',
    'body.large-text .pdf-hint,body.large-text .pdf-hint kbd{font-size:16px;}',
    'body.large-text .pdf-hint-title{font-size:17px;}'
  ];
  var bodyParts = [
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
    (d.lean ? '<h2>Political Lean Assessment</h2><div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><span style="font-size:22px;font-weight:800;color:#e0e8f0;">' + esc(d.lean) + '</span>' + (d.confidence ? '<span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;background:#0a2030;color:#4da6ff;">' + esc(d.confidence) + ' confidence</span>' : '') + '</div><div style="position:relative;height:16px;border-radius:8px;background:linear-gradient(to right,#2040a0,#3060c0,#888,#c06030,#a02020);margin-bottom:12px;"><div style="position:absolute;top:50%;left:' + ({'Left':8,'Center-Left':28,'Center':50,'Center-Right':72,'Right':92}[d.lean]||50) + '%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:white;border:2px solid #333;"></div></div><div style="display:flex;justify-content:space-between;font-size:9px;color:#888;margin-bottom:10px;"><span>Left</span><span>Center-Left</span><span>Center</span><span>Center-Right</span><span>Right</span></div>' + (d.signals&&d.signals.length ? '<ul style="list-style:none;margin-bottom:8px;">' + d.signals.map(function(s){return '<li style="font-size:11px;color:#a0b4c8;padding:3px 0;">› '+esc(s)+'</li>';}).join('') + '</ul>' : '') + (d.caveat ? '<div style="font-size:11px;color:#f0c040;font-style:italic;padding-top:8px;border-top:1px solid #ddd;">' + esc(d.caveat) + '</div>' : '') + '</div>' : ''),
    ((d.factual_score_rationale||d.context_score_rationale) ? '<h2>Score Explanation</h2><div class="card">' + (d.factual_score_rationale ? '<div style="margin-bottom:5px;">Factual: ' + esc(d.factual_score_rationale) + '</div>' : '') + (d.context_score_rationale ? '<div>Context: ' + esc(d.context_score_rationale) + '</div>' : '') + '</div>' : ''),
    '<div class="pdf-hint">',
    '<svg class="share-icon" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '<path d="M12 1.5 L12 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    '<path d="M6.5 7 L12 1.5 L17.5 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    '<path d="M5 11 L3 11 Q2 11 2 12 L2 27 Q2 28 3 28 L21 28 Q22 28 22 27 L22 12 Q22 11 21 11 L19 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    '</svg>',
    '<div class="pdf-hint-text">',
    '<div class="pdf-hint-title">Want a PDF?</div>',
    'Tap Safari\u2019s share icon \u2192 tap <kbd>Options</kbd> at the top \u2192 select <kbd>PDF</kbd> \u2192 then Mail, Message, AirDrop, or save it.',
    '</div>',
    '</div>',
    '<div class="footer">Generated by TruthPrism &mdash; app.truthprism.app &mdash; Powered by Claude AI &amp; Brave Search</div>'
  ];

  var styleCss = styleParts.join('');
  var bodyHtml = bodyParts.join('');

  chrome.storage.local.set({
    tp_report_style: styleCss,
    tp_report_body: bodyHtml,
    tp_report_ts: Date.now()
  }, function() {
    chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
  });
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
  var db = document.getElementById('demoBanner');
  if (db) db.style.display = 'none';
  // Clear score boxes
  var fs = document.getElementById('factualScore');
  if (fs) { fs.textContent = ''; fs.style.background = ''; fs.style.color = ''; }
  var cs = document.getElementById('contextScore');
  if (cs) { cs.textContent = ''; cs.style.background = ''; cs.style.color = ''; }
  ['factualDesc','contextDesc','factualRationale','contextRationale'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = '';
  });
  // Clear lean gauge
  var bc = document.getElementById('biasCard');
  if (bc) bc.style.display = 'none';
  var lm = document.getElementById('leanMarker');
  if (lm) lm.style.left = '50%';
  var lv = document.getElementById('leanVerdict');
  if (lv) lv.textContent = '';
  var ls = document.getElementById('leanSignals');
  if (ls) ls.innerHTML = '';
  var lc = document.getElementById('leanCaveat');
  if (lc) { lc.textContent = ''; lc.style.display = 'none'; }
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


// ── Large text toggle ─────────────────────────────────────────────────────
function initTextToggle() {
  const btn = document.getElementById('textToggleBtn');
  if (!btn) return;
  // Restore saved preference (localStorage may throw in some Safari extension contexts)
  try {
    if (localStorage.getItem('tp_large_text') === '1') {
      document.body.classList.add('large-text');
      btn.classList.add('active');
    }
  } catch(e) {}
  btn.addEventListener('click', function() {
    const isLarge = document.body.classList.toggle('large-text');
    btn.classList.toggle('active', isLarge);
    try { localStorage.setItem('tp_large_text', isLarge ? '1' : '0'); } catch(e) {}
  });
}

