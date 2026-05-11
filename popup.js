// News-Distiller Safari Extension popup.js

const SERVER_URL = 'https://app.news-distiller.com';

const DEMO_RESULT = {
  summary: "Sir David Attenborough, the legendary British wildlife broadcaster and climate campaigner, celebrates his 100th birthday on May 8, 2026. Born in 1926, he has spent decades bringing intimate nature documentaries to hundreds of millions of viewers worldwide, becoming a beloved British icon. The milestone is being marked with special BBC broadcasts, concerts, museum events, and widespread public celebration across the UK.",
  sections: [
    { title: "Context / Background", points: [
        "Born in 1926 in suburban London, collected fossils as a child and studied zoology at Cambridge",
        "Started BBC career as manager before moving on-camera at age 30 after someone else got ill",
        "Has been making wildlife documentaries for over 70 years, witnessing major historical periods from Great Depression through WWII to present"
    ]},
    { title: "Key Findings", points: [
        "Celebrated across Britain as a national hero with fans gathering in animal costumes at Trafalgar Square",
        "Special events include BBC broadcasts, Royal Albert Hall concert, science museum exhibitions, and nature walks",
        "Famous for iconic moments like cuddling with gorillas in Rwanda (1978) and wrestling a Burmese python on live TV (1956)",
        "Colleagues describe him as an 'animal whisperer' who connects easily with everyone from scientists to field assistants"
    ]},
    { title: "Implications", points: [
        "Demonstrates the lasting cultural impact of educational broadcasting and nature documentary filmmaking",
        "Shows how one individual can shape public understanding and appreciation of wildlife across multiple generations",
        "Scientists continue to honor his legacy by naming species after him, including a parasitic wasp for his 100th birthday"
    ]}
  ],
  lean: "Center",
  confidence: "High",
  signals: [
    "Celebratory but factual tone about widely respected figure",
    "Focuses on biographical details and career achievements without political messaging"
  ],
  caveat: "This is a straightforward celebratory profile of a universally respected cultural figure with no detectable political bias."
};
const DEMO_URL   = "https://www.npr.org/2026/05/08/nx-s1-5802305/david-attenborough-celebrates-his-100th-birthday";
const DEMO_TITLE = "David Attenborough celebrates his 100th birthday — NPR";

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
  var sampleBtn = document.getElementById('sampleBtn');
  if (sampleBtn) sampleBtn.addEventListener('click', showDemo);
  initTextToggle();
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
      body: JSON.stringify({ code: code, platform: 'ios' })
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

        // STRATEGY 1: JSON-LD structured data (works on most major news sites — NYT, WaPo, Bloomberg,
        // Atlantic, Reuters, AP, Guardian, etc — even when paywall is up, since this is published for SEO).
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
          if (!node) return '';
          if (typeof node === 'string') return '';
          if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) {
              var r = walkForArticleBody(node[i]);
              if (r) return r;
            }
            return '';
          }
          if (typeof node === 'object') {
            // articleBody is the canonical schema.org field
            if (typeof node.articleBody === 'string' && node.articleBody.length > 500) {
              var body = node.articleBody;
              if (typeof node.headline === 'string') body = node.headline + '\n\n' + body;
              else if (typeof node.name === 'string') body = node.name + '\n\n' + body;
              return body;
            }
            // Nested @graph arrays (NYT and others use this)
            if (node['@graph']) {
              var r = walkForArticleBody(node['@graph']);
              if (r) return r;
            }
            // Sometimes wrapped in mainEntity / mainEntityOfPage
            if (node.mainEntity) {
              var r = walkForArticleBody(node.mainEntity);
              if (r) return r;
            }
            // Recurse into all values
            for (var k in node) {
              if (k === '@graph' || k === 'mainEntity') continue;
              var r = walkForArticleBody(node[k]);
              if (r) return r;
            }
          }
          return '';
        }

        // STRATEGY 2: Site-specific selectors that have proven reliable
        function findArticleBySiteSelectors() {
          var siteSelectors = [
            // NYT (current and legacy)
            '[data-testid="StandardArticleBody"]', 'section[name="articleBody"]',
            // WSJ
            'section.article-content', 'div.article-wrap',
            // WaPo
            '[data-qa="article-body"]', '.article-body',
            // Bloomberg
            '.body-content', '.body-copy',
            // Atlantic
            '[data-event-module="article body"]', 'section.l-article__body',
            // Generic high-priority
            'article[itemprop="articleBody"]', '[itemprop="articleBody"]',
            'article', '[role="article"]'
          ];
          for (var i = 0; i < siteSelectors.length; i++) {
            var els = document.querySelectorAll(siteSelectors[i]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              // Clone so we can safely strip junk
              var clone = el.cloneNode(true);
              clone.querySelectorAll('aside,nav,footer,header,figure figcaption,.ad,.ads,[class*="newsletter"],[class*="related"],[class*="recommend"],[aria-hidden="true"],[role="complementary"]').forEach(function(n){n.remove();});
              var t = (clone.innerText || '').trim();
              if (t.length > 500) return t;
            }
          }
          return '';
        }

        // STRATEGY 3: Densest <p> cluster (Reader-Mode-style heuristic).
        // Find the element whose direct <p> children have the most total text.
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

        // STRATEGY 4: Body fallback with junk stripped
        function findArticleByBodyFallback() {
          var clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,nav,footer,header,aside,form,iframe,[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"]').forEach(function(e){e.remove();});
          return (clone.innerText || '').trim();
        }

        // Try strategies in order, take the longest result that exceeds threshold.
        var attempts = [
          { name: 'json-ld', text: findArticleInJsonLd() },
          { name: 'site-selectors', text: findArticleBySiteSelectors() },
          { name: 'densest-paras', text: findArticleByDensestParas() }
        ];
        var best = '';
        var bestStrategy = '';
        for (var i = 0; i < attempts.length; i++) {
          if (attempts[i].text && attempts[i].text.length > best.length) {
            best = attempts[i].text;
            bestStrategy = attempts[i].name;
          }
        }
        // If nothing decent yet, fall back to body
        if (best.length < 500) {
          var fb = findArticleByBodyFallback();
          if (fb.length > best.length) { best = fb; bestStrategy = 'body-fallback'; }
        }

        var cleaned = best.replace(/\s+/g,' ').trim();
        return {
          text: 'Page Title: ' + document.title + '\nURL: ' + window.location.href + '\n\n' + cleaned,
          meta: { title: title, siteName: siteName, pubDate: pubDate, url: window.location.href },
          strategy: bestStrategy,
          textLength: cleaned.length
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
      body: JSON.stringify({ text: text.substring(0, 15000), code: code, style: 'executive', platform: 'ios' })
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

function showDemo() {
  var r = DEMO_RESULT;
  _savedResult = r;
  _savedMeta = { url: DEMO_URL, title: DEMO_TITLE };
  renderResults(r);
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
        '<div style="font-size:28px;font-weight:800;color:#0D6E6E;text-align:center;margin:12px 0 10px;">' + esc(d.lean) + '</div>';
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


  // Fully self-contained HTML — no external scripts or fonts
  var html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<title>News-Distiller Report</title>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
    '  max-width:820px;margin:0 auto;padding:32px 28px;background:#f4f6f9;color:#1a2a3a;}',
    'h1{font-size:28px;color:#0D6E6E;margin-bottom:2px;font-weight:800;}',
    '.report-ts{font-size:14px;color:#888;margin-bottom:20px;}',
    'h2{font-size:15px;font-weight:700;color:#0D6E6E;text-transform:uppercase;letter-spacing:.6px;',
    '  border-bottom:2px solid #11998E;padding-bottom:5px;margin:24px 0 10px;}',
    '.article-meta{background:white;border-left:5px solid #0D6E6E;border-radius:0 8px 8px 0;',
    '  padding:14px 18px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.article-title{font-size:20px;font-weight:700;color:#1a2a3a;margin-bottom:5px;line-height:1.4;}',
    '.article-byline{font-size:14px;color:#555;margin-bottom:4px;}',
    '.article-url{font-size:13px;word-break:break-all;} .article-url a{color:#0D6E6E;}',
    '.summary{background:white;border-radius:8px;padding:16px 18px;',
    '  font-size:14px;line-height:1.8;color:#2a3a4a;box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    'ul{margin:0 0 4px 0;padding-left:18px;}',
    'li{font-size:15px;color:#2a3a4a;line-height:1.75;margin-bottom:3px;padding-left:4px;}',
    '.lean-box{background:white;border-radius:8px;padding:18px;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.06);}',
    '.lean-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
    '.lean-label-sm{font-size:11px;font-weight:700;color:#0D6E6E;text-transform:uppercase;letter-spacing:.5px;}',
    '.signals{list-style:none;padding:0;margin:4px 0 10px;}',
    '.signals li{font-size:14px;color:#445566;padding:3px 0 3px 14px;position:relative;line-height:1.5;}',
    '.signals li::before{content:"\u203a";position:absolute;left:0;color:#0D6E6E;font-weight:700;}',
    '.caveat{font-size:14px;color:#cc8800;font-style:italic;margin-top:10px;',
    '  padding-top:10px;border-top:1px solid #eee;line-height:1.5;}',
    '.pdf-hint{font-size:14px;color:#1a2a3a;background:#eef2ff;border:2px solid #0D6E6E;border-radius:10px;padding:16px 18px;margin:24px 0 8px;line-height:1.6;display:flex;gap:14px;align-items:flex-start;box-shadow:0 2px 8px rgba(13,110,110,0.15);}',
    '.pdf-hint .share-icon{flex-shrink:0;width:28px;height:36px;color:#0D6E6E;}',
    '.pdf-hint-text{flex:1;}',
    '.pdf-hint-title{font-weight:800;color:#0D6E6E;margin-bottom:4px;font-size:15px;}',
    '.pdf-hint kbd{display:inline-block;background:white;border:1px solid #b8d8d8;border-radius:5px;padding:1px 7px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:700;color:#0D6E6E;box-shadow:0 1px 0 rgba(0,0,0,0.05);}',
    '.btn{padding:12px 24px;border:none;border-radius:8px;font-size:15px;font-weight:700;',
    '  cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;',
    '  transition:opacity .15s;}',
    '.footer{font-size:11px;color:#aaa;margin-top:28px;padding-top:14px;border-top:1px solid #dde;text-align:center;}',
    // Print styles — hide buttons, white background, show full content
    '@media print{',
    '  body{background:white;padding:20px;}',
    '  .pdf-hint{display:none!important;}',
    '  .nd-aa-btn{display:none!important;}',
    '  .article-meta,.summary,.lean-box{box-shadow:none;border:1px solid #ddd;}',
    '}',
    // Aa text-size toggle button
    '.nd-aa-btn{position:fixed;top:14px;right:14px;z-index:9999;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:6px 14px;font-size:14px;font-weight:700;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.2);}',
    '.nd-aa-btn:hover{background:rgba(0,0,0,0.75);}',
    '.nd-aa-btn.active{background:#0D6E6E;border-color:rgba(255,255,255,0.4);}',
    // Large-text mode for report page
    'body.large-text .article-title{font-size:24px;}',
    'body.large-text .article-byline,body.large-text .article-url{font-size:16px;}',
    'body.large-text .summary{font-size:17px;line-height:1.85;}',
    'body.large-text li{font-size:18px;line-height:1.85;}',
    'body.large-text h2{font-size:17px;}',
    'body.large-text .lean-label-sm{font-size:13px;}',
    'body.large-text .lean-verdict{font-size:20px;}',
    'body.large-text .signals li{font-size:17px;}',
    'body.large-text .caveat{font-size:16px;}',
    'body.large-text .pdf-hint,body.large-text .pdf-hint kbd{font-size:16px;}',
    'body.large-text .pdf-hint-title{font-size:17px;}',
    '</style></head><body>',
    '<button class="nd-aa-btn" id="ndAaBtn" type="button" aria-label="Toggle large text">Aa</button>',
    '<h1>News-Distiller Report</h1>',
    '<div class="report-ts">Generated: ' + timestamp + '</div>',
    metaHtml,
    '<h2>Executive Summary</h2>',
    '<div class="summary">' + esc(d.summary || '') + '</div>',
    sectionsHtml,
    leanHtml,
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
    '<\/script>',
    '<script>',
    'document.addEventListener("DOMContentLoaded",function(){',
    '  var b=document.getElementById("ndAaBtn");',
    '  if(!b)return;',
    '  try{if(localStorage.getItem("nd_large_text_report")==="1"){document.body.classList.add("large-text");b.classList.add("active");}}catch(e){}',
    '  b.addEventListener("click",function(){',
    '    var on=document.body.classList.toggle("large-text");',
    '    b.classList.toggle("active",on);',
    '    try{localStorage.setItem("nd_large_text_report",on?"1":"0");}catch(e){}',
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
  var db = document.getElementById('demoBanner');
  if (db) db.style.display = 'none';
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


// ── Large text toggle ─────────────────────────────────────────────────────
function initTextToggle() {
  const btn = document.getElementById('textToggleBtn');
  if (!btn) return;
  // Restore saved preference (localStorage may throw in some Safari extension contexts)
  try {
    if (localStorage.getItem('nd_large_text') === '1') {
      document.body.classList.add('large-text');
      btn.classList.add('active');
    }
  } catch(e) {}
  btn.addEventListener('click', function() {
    const isLarge = document.body.classList.toggle('large-text');
    btn.classList.toggle('active', isLarge);
    try { localStorage.setItem('nd_large_text', isLarge ? '1' : '0'); } catch(e) {}
  });
}

