// News-Distiller Safari Extension popup.js
const API_BASE = 'https://app.news-distiller.com';
const LEAN_POSITIONS = { 'Left': 8, 'Center-Left': 28, 'Center': 50, 'Center-Right': 72, 'Right': 92 };
let currentTab = null;
let lastResult = null;
let savedCode = '';
let reportVisible = false;

// Toast
function showToast(msg, duration) {
  duration = duration || 2000;
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, duration);
}

// Toggle access code section
function toggleAccess() {
  var body = document.getElementById('accBody');
  var chevron = document.getElementById('accChevron');
  var open = body.classList.contains('open');
  if (open) {
    body.classList.remove('open');
    chevron.classList.remove('open');
  } else {
    body.classList.add('open');
    chevron.classList.add('open');
  }
}

// Update code badge in nav
function updateCodeBadge() {
  var badge = document.getElementById('navCodeBadge');
  var accStatus = document.getElementById('accStatusBadge');
  if (savedCode) {
    badge.textContent = 'Code ✓';
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

// Init
async function init() {
  // Load saved code
  var stored = await chrome.storage.local.get('nd_code');
  savedCode = stored.nd_code || '';
  if (savedCode) {
    document.getElementById('codeInput').value = savedCode;
  }
  updateCodeBadge();

  // Char count listener
  document.getElementById('pasteArea').addEventListener('input', function() {
    var text = this.value;
    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('charCount').textContent = chars + ' chars · ~' + words + ' words';
  });

  // Get current tab
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    if (currentTab && currentTab.url) {
      var url = currentTab.url;
      // Pre-fill URL if it's a real web page
      if (url.startsWith('http')) {
        document.getElementById('urlInput').value = url;
      }
    }
  } catch(e) {
    console.log('Tab query error:', e);
  }
}

// Save code
async function saveCode() {
  var code = document.getElementById('codeInput').value.trim();
  savedCode = code;
  await chrome.storage.local.set({ nd_code: code });
  updateCodeBadge();
  if (code) {
    showToast('Code saved: ' + code.substring(0, 4) + '....');
  } else {
    showToast('Code cleared.');
  }
}

// Test code
async function testCode() {
  var code = document.getElementById('codeInput').value.trim() || savedCode;
  if (!code) {
    showToast('No code to test.', 2000);
    return;
  }
  showToast('Testing...', 3000);
  try {
    var resp = await fetch(API_BASE + '/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    });
    var d = await resp.json();
    if (d.valid) {
      showToast('✓ Valid! ' + (d.remaining !== undefined ? d.remaining + ' uses left.' : ''), 3000);
    } else if (d.free_remaining !== undefined) {
      showToast('No code — ' + d.free_remaining + ' free distillations left.', 3000);
    } else {
      showToast('✗ Code invalid or expired.', 3000);
    }
  } catch(e) {
    showToast('Network error testing code.', 3000);
  }
}

// Distill
async function distillPage() {
  showLoading(true);
  hideError();
  document.getElementById('resultsBox').classList.remove('visible');

  try {
    // Priority: pasted text > URL fetch
    var pastedText = document.getElementById('pasteArea').value.trim();
    var urlInput = document.getElementById('urlInput').value.trim();
    var pageText = pastedText;

    // Try to extract from current page if no paste and URL matches current tab
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

    var response = await fetch(API_BASE + '/api/distill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var d = await response.json();
      if (d.error === 'free_exhausted') {
        showError('Free distillations used up. Enter a Distiller Pack code or get one at pklmedialab.com.');
      } else {
        showError(d.error || d.message || 'Analysis failed. Please try again.');
      }
      showLoading(false);
      return;
    }

    // SSE stream
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
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
        if (msg.done && msg.result) {
          lastResult = msg.result;
          renderResults(msg.result);
        }
      }
    }
  } catch(e) {
    showError('Network error — please try again.');
  } finally {
    showLoading(false);
  }
}

// Render results
function renderResults(r) {
  document.getElementById('summaryEl').textContent = r.summary || '';

  // Political lean
  if (r.lean) {
    var pct = LEAN_POSITIONS[r.lean] !== undefined ? LEAN_POSITIONS[r.lean] : 50;
    document.getElementById('leanMarker').style.left = pct + '%';
    document.getElementById('leanVerdict').textContent = r.lean;
    document.getElementById('leanConfidence').textContent = r.confidence ? r.confidence + ' confidence' : '';
    document.getElementById('leanSection').style.display = 'block';
  } else {
    document.getElementById('leanSection').style.display = 'none';
  }

  // Full report sections
  var reportEl = document.getElementById('fullReport');
  reportEl.innerHTML = '';
  if (r.sections && r.sections.length > 0) {
    for (var i = 0; i < r.sections.length; i++) {
      var sec = r.sections[i];
      var div = document.createElement('div');
      div.className = 'report-section';
      var title = document.createElement('div');
      title.className = 'report-section-title';
      title.textContent = sec.title || '';
      div.appendChild(title);
      if (sec.points && sec.points.length > 0) {
        var ul = document.createElement('ul');
        ul.className = 'report-points';
        for (var j = 0; j < sec.points.length; j++) {
          var li = document.createElement('li');
          li.textContent = sec.points[j];
          ul.appendChild(li);
        }
        div.appendChild(ul);
      }
      reportEl.appendChild(div);
    }
    document.getElementById('toggleReportBtn').style.display = 'block';
  } else {
    document.getElementById('toggleReportBtn').style.display = 'none';
  }
  reportVisible = false;
  document.getElementById('toggleReportBtn').textContent = 'Show Full Report ▼';

  document.getElementById('resultsBox').classList.add('visible');
}

// Toggle full report
function toggleReport() {
  reportVisible = !reportVisible;
  var el = document.getElementById('fullReport');
  var btn = document.getElementById('toggleReportBtn');
  if (reportVisible) {
    el.classList.add('visible');
    btn.textContent = 'Hide Full Report ▲';
  } else {
    el.classList.remove('visible');
    btn.textContent = 'Show Full Report ▼';
  }
}

// Save PDF using jsPDF
function savePDF() {
  if (!lastResult) return;
  try {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var margin = 50;
    var y = margin;
    var pageW = doc.internal.pageSize.getWidth();
    var maxW = pageW - margin * 2;

    // Header
    doc.setFillColor(13, 110, 110);
    doc.rect(0, 0, pageW, 50, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text('News-Distiller', margin, 32);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('AI-Powered News Summary', margin, 44);

    y = 70;
    doc.setTextColor(30, 30, 30);

    // Summary
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(13, 110, 110);
    doc.text('Executive Summary', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);
    var summaryLines = doc.splitTextToSize(lastResult.summary || '', maxW);
    doc.text(summaryLines, margin, y);
    y += summaryLines.length * 14 + 16;

    // Lean
    if (lastResult.lean) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(13, 110, 110);
      doc.text('Political Lean', margin, y);
      y += 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(50, 50, 50);
      doc.text(lastResult.lean + (lastResult.confidence ? ' (' + lastResult.confidence + ' confidence)' : ''), margin, y);
      y += 20;
    }

    // Full report sections
    if (lastResult.sections && lastResult.sections.length > 0) {
      for (var i = 0; i < lastResult.sections.length; i++) {
        var sec = lastResult.sections[i];
        if (y > 700) { doc.addPage(); y = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(13, 110, 110);
        doc.text(sec.title || '', margin, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(50, 50, 50);
        if (sec.points) {
          for (var j = 0; j < sec.points.length; j++) {
            if (y > 720) { doc.addPage(); y = margin; }
            var ptLines = doc.splitTextToSize('• ' + sec.points[j], maxW - 10);
            doc.text(ptLines, margin + 8, y);
            y += ptLines.length * 12 + 4;
          }
        }
        y += 8;
      }
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Generated by News-Distiller (app.news-distiller.com) · PKL Media Lab', margin, doc.internal.pageSize.getHeight() - 20);

    doc.save('news-distiller-summary.pdf');
    showToast('PDF saved!');
  } catch(e) {
    // Fallback: copy to clipboard
    copyToClipboard();
  }
}

// Copy summary to clipboard
function copyToClipboard() {
  if (!lastResult) return;
  var text = 'NEWS-DISTILLER SUMMARY\n' + '='.repeat(40) + '\n\n' +
    (lastResult.summary || '') + '\n\n' +
    (lastResult.lean ? 'Political Lean: ' + lastResult.lean + '\n' : '') +
    '\nDistilled by News-Distiller (app.news-distiller.com)\n';
  navigator.clipboard.writeText(text).then(function() {
    showToast('Summary copied to clipboard!');
  }).catch(function() {
    showToast('Could not copy — use the Web App.');
  });
}

// Share result
async function shareResult() {
  if (!lastResult) return;
  var text = 'NEWS-DISTILLER SUMMARY\n\n' +
    (lastResult.summary || '') + '\n\n' +
    (lastResult.lean ? 'Political Lean: ' + lastResult.lean + '\n\n' : '') +
    'Distilled by News-Distiller (app.news-distiller.com)';

  if (navigator.share) {
    try {
      await navigator.share({ title: 'News-Distiller Summary', text: text });
    } catch(e) {
      copyToClipboard();
    }
  } else {
    // Try to generate PDF and share
    savePDF();
  }
}

// Reset
function resetUI() {
  document.getElementById('resultsBox').classList.remove('visible');
  document.getElementById('pasteArea').value = '';
  document.getElementById('urlInput').value = '';
  document.getElementById('charCount').textContent = '0 chars · ~0 words';
  hideError();
  lastResult = null;
  reportVisible = false;
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

init();
