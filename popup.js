const SERVER_URL = 'https://app.truthprism.app';

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['accessCode']);

  if (data.accessCode) {
    document.getElementById('accessCode').value = data.accessCode;
    showAuthStatus('✓ Prism Code configured', 'ok');
    collapseAuth();
    checkRemaining(data.accessCode);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    const short = tab.url.length > 55 ? tab.url.substring(0, 55) + '...' : tab.url;
    document.getElementById('pageUrl').textContent = '📄 ' + short;
  }

  document.getElementById('authHeader').addEventListener('click', () => {
    const body = document.getElementById('authBody');
    const toggle = document.getElementById('authToggle');
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    toggle.textContent = hidden ? '▼' : '▶';
  });

  document.getElementById('saveCodeBtn').addEventListener('click', saveCode);
  document.getElementById('testCodeBtn').addEventListener('click', testCode);
  document.getElementById('checkBtn').addEventListener('click', checkCurrentPage);
  document.getElementById('checkCustomBtn').addEventListener('click', checkCustomText);
  document.getElementById('saveBtn').addEventListener('click', saveReport);
  document.getElementById('newCheckBtn').addEventListener('click', resetResults);
  document.getElementById('fullReportBtn').addEventListener('click', openFullReport);
});

function collapseAuth() {
  document.getElementById('authBody').style.display = 'none';
  document.getElementById('authToggle').textContent = '▶';
}

function expandAuth() {
  document.getElementById('authBody').style.display = 'block';
  document.getElementById('authToggle').textContent = '▼';
}

function showAuthStatus(msg, type) {
  const el = document.getElementById('authStatus');
  el.textContent = msg;
  el.className = 'auth-status ' + (type || '');
}

async function saveCode() {
  const code = document.getElementById('accessCode').value.trim();
  if (!code) { showAuthStatus('Please enter a Prism Code', 'error'); return; }
  await chrome.storage.local.set({ accessCode: code });
  showAuthStatus('✓ Prism Code saved!', 'ok');
  setTimeout(collapseAuth, 800);
  checkRemaining(code);
}

async function testCode() {
  const code = document.getElementById('accessCode').value.trim();
  if (!code) { showAuthStatus('Enter Prism Code first', 'error'); return; }
  showAuthStatus('Testing...', '');
  try {
    const r = await fetch(`${SERVER_URL}/api/check-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    const d = await r.json();
    if (d.success) {
      showAuthStatus('✓ Prism Code verified!', 'ok');
      if (d.remaining !== undefined && d.remaining !== null) showRemaining(d.remaining);
    } else {
      showAuthStatus('✗ ' + (d.error || 'Invalid code'), 'error');
    }
  } catch(e) {
    showAuthStatus('✗ Cannot connect', 'error');
  }
}

async function checkRemaining(code) {
  try {
    const r = await fetch(`${SERVER_URL}/api/check-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    const d = await r.json();
    if (d.remaining !== undefined && d.remaining !== null) showRemaining(d.remaining);
  } catch(e) {}
}

function showRemaining(remaining) {
  const banner = document.getElementById('remainingBanner');
  if (remaining === null || remaining === undefined) { banner.style.display = 'none'; return; }
  banner.style.display = 'block';
  if (remaining <= 0) {
    banner.style.background = '#2a1010';
    banner.style.border = '1px solid #6a2020';
    banner.style.color = '#f08080';
    banner.innerHTML = '⚠️ Checks used up — <a href="https://app.truthprism.app/checkout" target="_blank" style="color:#f08080;">buy a Prism Pack</a>';
  } else if (remaining <= 3) {
    banner.style.background = '#2a1f00';
    banner.style.border = '1px solid #4a3a00';
    banner.style.color = '#f0d060';
    banner.textContent = `⚠️ ${remaining} check${remaining !== 1 ? 's' : ''} remaining`;
  } else {
    banner.style.background = '#0f2a1a';
    banner.style.border = '1px solid #1a4a2a';
    banner.style.color = '#55dd99';
    banner.textContent = `✓ ${remaining} checks remaining`;
  }
}

async function getAccessCode() {
  const data = await chrome.storage.local.get(['accessCode']);
  if (!data.accessCode) {
    showError('Please save your Prism Code first. Get one at truthprism.app');
    expandAuth();
    return null;
  }
  return data.accessCode;
}

const PAYWALLED_DOMAINS = [
  'nytimes.com', 'wsj.com', 'washingtonpost.com', 'ft.com',
  'bloomberg.com', 'economist.com', 'newyorker.com', 'theatlantic.com',
  'wired.com', 'thetimes.co.uk', 'telegraph.co.uk', 'barrons.com'
];

async function checkCurrentPage() {
  const code = await getAccessCode();
  if (!code) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showError('Could not access current tab'); return; }

  // Check for known paywalled sites before attempting
  try {
    const hostname = new URL(tab.url).hostname.replace('www.', '');
    if (PAYWALLED_DOMAINS.some(d => hostname.includes(d))) {
      showError('⚠️ ' + hostname + ' is a paywalled site — article text cannot be retrieved automatically. Copy and paste the article text into Check Custom Text below.');
      return;
    }
  } catch(e) {}

  showLoading(true);
  hideError();
  hideResults();

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selectors = ['article', '[role="main"]', '.article-content',
          '.article-body', '.post-content', '.story-body', '.entry-content',
          'main', '#main-content', '#content'];
        let text = '';
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText.length > 200) { text = el.innerText; break; }
        }
        if (!text) {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,nav,footer,header,aside').forEach(e => e.remove());
          text = clone.innerText;
        }
        text = text.replace(/\s+/g, ' ').trim();
        return `Page Title: ${document.title}\nURL: ${window.location.href}\n\n${text}`;
      }
    });

    const pageText = results[0]?.result;
    if (!pageText) throw new Error('Could not extract text from page');
    await runStreamingCheck(pageText, code);
  } catch (err) {
    showError(err.message);
    showLoading(false);
  }
}

async function checkCustomText() {
  const code = await getAccessCode();
  if (!code) return;
  const text = document.getElementById('customText').value.trim();
  if (!text) { showError('Please enter some text to fact-check'); return; }
  showLoading(true);
  hideError();
  hideResults();
  await runStreamingCheck(text, code);
}

// ── Streaming check ────────────────────────────────────────────────────────
let _savedResult = null;

async function runStreamingCheck(text, code) {
  _savedResult = null;
  let summaryHeadline = '';
  let summaryText = '';
  let claimsReceived = 0;
  let totalClaims = 0;

  try {
    const resp = await fetch(`${SERVER_URL}/api/check-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_text: text.substring(0, 10000), access_code: code })
    });

    if (!resp.ok) {
      const ed = await resp.json().catch(() => ({}));
      throw new Error(ed.error || 'Failed to connect — please try again.');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    function read() {
      return reader.read().then(({ done, value }) => {
        if (done) { showLoading(false); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === 'error') {
              showError(msg.message); showLoading(false);
            } else if (msg.type === 'summary') {
              summaryHeadline = msg.headline || '';
              summaryText = msg.executive_summary || '';
              setStep(1, 'done'); setStep(2, 'active');
              document.getElementById('summaryHeadline').textContent = summaryHeadline;
              document.getElementById('summaryText').textContent = summaryText;
              document.getElementById('summaryCard').style.display = 'block';
              document.getElementById('results').style.display = 'block';
            } else if (msg.type === 'claim_count') {
              totalClaims = msg.total;
              updateStep2(`Verifying 0/${totalClaims} claims`);
            } else if (msg.type === 'claim') {
              claimsReceived++;
              updateStep2(`Claim ${claimsReceived}/${totalClaims} verified`);
            } else if (msg.type === 'assessment') {
              setStep(2, 'done'); setStep(3, 'active');
              displayResults({
                score: msg.factual_score,
                context_score: msg.context_score,
                headline: summaryHeadline,
                executive_summary: summaryText,
                fact_assessment: msg.fact_assessment,
                context_assessment: msg.context_assessment,
                factual_score_rationale: msg.factual_score_rationale,
                context_score_rationale: msg.context_score_rationale,
                framing_issues: msg.framing_issues,
                omissions: msg.omissions,
                balance_note: msg.balance_note,
                verified_claims: msg.verified_claims
              });
              if (msg.remaining !== undefined) showRemaining(msg.remaining);
              setStep(3, 'done'); setStep(4, 'done');
            } else if (msg.type === 'done') {
              if (msg.truncated) {
                document.getElementById('truncatedWarn').style.display = 'block';
              }
              showLoading(false);
            }
          } catch(e) {}
        });
        return read();
      }).catch(e => { showError('Failed to connect — please try again.'); showLoading(false); });
    }
    await read();
  } catch(err) {
    showError(err.message);
    showLoading(false);
  }
}

function setStep(n, state) {
  const el = document.getElementById('step' + n);
  const dot = document.getElementById('s' + n + 'dot');
  if (!el || !dot) return;
  if (state === 'active') {
    el.style.color = '#a78bfa';
    dot.style.background = '#a78bfa';
    dot.style.boxShadow = '0 0 5px rgba(167,139,250,0.6)';
  } else if (state === 'done') {
    el.style.color = '#1D9E75';
    dot.style.background = '#1D9E75';
    dot.style.boxShadow = 'none';
  }
}

function updateStep2(text) {
  const el = document.getElementById('step2');
  if (el) {
    const dot = document.getElementById('s2dot');
    el.innerHTML = '';
    if (dot) { dot.style.background = '#a78bfa'; el.appendChild(dot); }
    el.appendChild(document.createTextNode(' ' + text));
    el.style.color = '#a78bfa';
  }
}

// ── Display results ────────────────────────────────────────────────────────
function displayResults(data) {
  _savedResult = data;
  const factual = data.score || 0;
  const context = data.context_score || 0;

  document.getElementById('factualScore').textContent = factual + '/10';
  document.getElementById('factualScore').style.color = getScoreColor(factual);
  document.getElementById('factualDesc').textContent = getScoreDesc(factual);
  document.getElementById('contextScore').textContent = context + '/10';
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
    document.getElementById('factualRationale').textContent = data.factual_score_rationale ? 'Factual Score: ' + data.factual_score_rationale : '';
    document.getElementById('contextRationale').textContent = data.context_score_rationale ? 'Context Score: ' + data.context_score_rationale : '';
    document.getElementById('scoreExplainCard').style.display = 'block';
  }
  document.getElementById('results').style.display = 'block';
}

function openFullReport() {
  const d = _savedResult;
  if (!d) return;
  const timestamp = new Date().toLocaleString();
  function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function scoreColor(s) { return s>=8?'#22c55e':s>=6?'#f59e0b':'#ef4444'; }

  let claimsHtml = '';
  (d.verified_claims || []).forEach(c => {
    const vcolor = c.verdict==='Supported'?'#22c55e':c.verdict==='False'?'#ef4444':c.verdict==='Partially Supported'?'#f59e0b':'#94a3b8';
    claimsHtml += `<div style="background:#f8fafc;border:1px solid #dde;border-radius:6px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:600;color:#1a2a3a;flex:1;margin-right:10px;">${esc(c.claim)}</div>
        <div style="font-size:12px;font-weight:700;color:${vcolor};white-space:nowrap;">${esc(c.verdict)}</div>
      </div>
      <div style="font-size:13px;color:#444;line-height:1.6;">${esc(c.finding||'')}</div>
      ${c.source_summary?`<div style="font-size:11px;color:#888;margin-top:4px;font-style:italic;">Sources: ${esc(c.source_summary)}</div>`:''}
    </div>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TruthPrism Report</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#f5f7fa;color:#1a2a3a;}
h1{font-size:20px;}h2{font-size:14px;margin:18px 0 8px;color:#1a2a3a;border-bottom:1px solid #dde;padding-bottom:4px;}
.scores{display:flex;gap:14px;margin:14px 0;}.score-box{flex:1;background:white;border:1px solid #dde;border-radius:8px;padding:12px;text-align:center;}
.score-lbl{font-size:11px;color:#888;margin-bottom:4px;}.score-num{font-size:30px;font-weight:700;}
.card{background:white;border:1px solid #dde;border-radius:8px;padding:14px;margin-bottom:10px;font-size:14px;line-height:1.7;color:#333;font-style:italic;}
.save-btn{display:inline-block;padding:10px 20px;background:#667eea;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin:14px 0;}
.meta{font-size:11px;color:#999;margin-top:20px;}
</style></head><body>
<h1>TruthPrism Analysis Report</h1>
<p style="font-size:12px;color:#666;">${timestamp}</p>
<div class="scores">
<div class="score-box"><div class="score-lbl" style="color:#60a5fa;font-weight:700;">Factual Score</div><div class="score-num" style="color:${scoreColor(d.score||0)}">${d.score||'—'}/10</div></div>
<div class="score-box"><div class="score-lbl" style="color:#a78bfa;font-weight:700;">Context Score</div><div class="score-num" style="color:${scoreColor(d.context_score||0)}">${d.context_score||'—'}/10</div></div>
</div>
${d.executive_summary?`<h2>Executive Summary</h2><div class="card" style="font-style:normal;">${d.headline?`<div style="font-weight:600;margin-bottom:6px;">${esc(d.headline)}</div>`:''}${esc(d.executive_summary)}</div>`:''}
${claimsHtml?`<h2>Claims Checked</h2>${claimsHtml}`:''}
${d.fact_assessment?`<h2>Fact Check Assessment</h2><div class="card">${esc(d.fact_assessment)}</div>`:''}
${d.context_assessment?`<h2>Context &amp; Framing</h2><div class="card">${esc(d.context_assessment)}</div>`:''}
${(d.factual_score_rationale||d.context_score_rationale)?`<h2>Score Explanation</h2><div class="card" style="font-style:normal;">${d.factual_score_rationale?`<div style="margin-bottom:5px;">Factual Score: ${esc(d.factual_score_rationale)}</div>`:''}${d.context_score_rationale?`<div>Context Score: ${esc(d.context_score_rationale)}</div>`:''}</div>`:''}
<button class="save-btn" onclick="saveIt()">💾 Save as Text File</button>
<div class="meta">Generated by TruthPrism — app.truthprism.app — Powered by Claude AI &amp; Brave Search</div>
<script>
function saveIt(){
  var out='TRUTHPRISM REPORT\\nGenerated: ${timestamp}\\n\\nFACTUAL SCORE: ${d.score||'—'}/10\\nCONTEXT SCORE: ${d.context_score||'—'}/10\\n\\n'+document.body.innerText;
  var a=document.createElement('a');a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(out);a.download='truthprism-report.txt';a.click();
}
<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  chrome.tabs.create({ url: URL.createObjectURL(blob) });
}

function resetResults() {
  document.getElementById('results').style.display = 'none';
  document.getElementById('checkBtn').style.display = 'block';
  document.getElementById('errorMsg').style.display = 'none';
  document.getElementById('customText').value = '';
  ['summaryCard','factAssessCard','contextCard','scoreExplainCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Reset steps
  [1,2,3,4].forEach(n => setStep(n, 'reset'));
  _savedResult = null;
}

async function saveReport() {
  const d = _savedResult;
  if (!d) return;
  const timestamp = new Date().toLocaleString();
  let output = `TRUTHPRISM ANALYSIS REPORT\nGenerated: ${timestamp}\n\n`;
  output += `FACTUAL SCORE: ${d.score||'—'}/10\nCONTEXT SCORE: ${d.context_score||'—'}/10\n\n`;
  if (d.headline) output += `HEADLINE: ${d.headline}\n\n`;
  if (d.executive_summary) output += `EXECUTIVE SUMMARY:\n${d.executive_summary}\n\n`;
  if (d.fact_assessment) output += `FACT CHECK ASSESSMENT:\n${d.fact_assessment}\n\n`;
  if (d.context_assessment) output += `CONTEXT & FRAMING:\n${d.context_assessment}\n\n`;
  if (d.factual_score_rationale) output += `${d.factual_score_rationale}\n`;
  if (d.context_score_rationale) output += `${d.context_score_rationale}\n`;
  output += '\n---\nGenerated by TruthPrism — app.truthprism.app';
  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: `truthprism-${Date.now()}.txt`, saveAs: true });
}

function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'block' : 'none';
  document.getElementById('checkBtn').style.display = show ? 'none' : 'block';
  document.getElementById('checkCustomBtn').disabled = show;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  showLoading(false);
}

function hideError() { document.getElementById('errorMsg').style.display = 'none'; }
function hideResults() { document.getElementById('results').style.display = 'none'; }

function getScoreColor(score) {
  if (!score) return '#6688aa';
  if (score >= 8) return '#1D9E75';
  if (score >= 6) return '#CC8800';
  if (score >= 4) return '#E05050';
  return '#CC2222';
}

function getScoreDesc(score) {
  if (!score) return '';
  if (score >= 9) return 'Highly Accurate';
  if (score >= 7) return 'Generally Credible';
  if (score >= 5) return 'Mixed';
  if (score >= 3) return 'Low Credibility';
  return 'Very Low';
}
