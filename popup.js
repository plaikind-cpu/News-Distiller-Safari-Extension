var API = 'https://app.news-distiller.com';
var LEAN = {'Left':8,'Center-Left':28,'Center':50,'Center-Right':72,'Right':92};
var currentTab = null;
var lastResult = null;
var savedCode = '';

function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function updateStatus() {
  var st = document.getElementById('codeStatus');
  if (savedCode) {
    st.textContent = 'Code active: ' + savedCode.substring(0,4) + '....';
    st.className = 'status ok';
  } else {
    st.textContent = 'No code — using free distillations.';
    st.className = 'status';
  }
}

function saveCode() {
  savedCode = document.getElementById('codeInput').value.trim();
  chrome.storage.local.set({nd_code: savedCode});
  updateStatus();
  toast(savedCode ? 'Code saved!' : 'Code cleared.');
}

function testCode() {
  var code = document.getElementById('codeInput').value.trim() || savedCode;
  if (!code) { toast('No code to test.'); return; }
  toast('Testing...');
  fetch(API + '/api/status', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({code: code})})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.valid) toast('Code valid! ' + (d.remaining !== undefined ? d.remaining + ' left.' : ''));
      else toast('Code invalid or expired.');
    })
    .catch(function() { toast('Network error.'); });
}

function distill() {
  showLoading(true);
  hideError();
  document.getElementById('resultsBox').style.display = 'none';
  var pastedText = document.getElementById('pasteArea').value.trim();
  if (pastedText) {
    callAPI(pastedText);
    return;
  }
  if (currentTab) {
    chrome.tabs.sendMessage(currentTab.id, {action:'getPageText'}, function(resp) {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript({target:{tabId:currentTab.id},files:['content.js']}, function() {
          chrome.tabs.sendMessage(currentTab.id, {action:'getPageText'}, function(resp2) {
            if (resp2 && resp2.text && resp2.text.length > 200) { callAPI(resp2.text); }
            else { showError('Could not extract article text. Paste the article text in the box above.'); showLoading(false); }
          });
        });
        return;
      }
      if (resp && resp.text && resp.text.length > 200) { callAPI(resp.text); }
      else { showError('Could not extract article text. Paste the article text in the box above.'); showLoading(false); }
    });
  } else {
    showError('Could not get current tab. Paste the article text above.');
    showLoading(false);
  }
}

function callAPI(text) {
  var body = {text: text, style: 'executive'};
  if (savedCode) body.code = savedCode;
  fetch(API + '/api/distill', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
    .then(function(r) {
      if (!r.ok) { return r.json().then(function(d) { throw new Error(d.error || d.message || 'API error'); }); }
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function read() {
        reader.read().then(function(chunk) {
          if (chunk.done) { showLoading(false); return; }
          buf += decoder.decode(chunk.value, {stream:true});
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function(line) {
            if (!line.startsWith('data: ')) return;
            var p = line.slice(6).trim();
            if (!p) return;
            try {
              var msg = JSON.parse(p);
              if (msg.error) { showError(msg.error); showLoading(false); }
              if (msg.done && msg.result) { lastResult = msg.result; renderResult(msg.result); showLoading(false); }
            } catch(e) {}
          });
          read();
        });
      }
      read();
    })
    .catch(function(e) { showError(e.message || 'Network error.'); showLoading(false); });
}

function renderResult(r) {
  document.getElementById('summaryEl').textContent = r.summary || '';
  if (r.lean) {
    var pct = LEAN[r.lean] !== undefined ? LEAN[r.lean] : 50;
    document.getElementById('leanDot').style.left = pct + '%';
    document.getElementById('leanVerdict').textContent = r.lean + (r.confidence ? ' (' + r.confidence + ')' : '');
    document.getElementById('leanBox').style.display = 'block';
  } else {
    document.getElementById('leanBox').style.display = 'none';
  }
  document.getElementById('resultsBox').style.display = 'block';
}

function copyResult() {
  if (!lastResult) return;
  var text = 'NEWS-DISTILLER SUMMARY\n\n' + (lastResult.summary || '') + '\n\n' + (lastResult.lean ? 'Political Lean: ' + lastResult.lean + '\n\n' : '') + 'app.news-distiller.com';
  navigator.clipboard.writeText(text).then(function() { toast('Copied!'); }).catch(function() { toast('Could not copy.'); });
}

function reset() {
  document.getElementById('resultsBox').style.display = 'none';
  document.getElementById('pasteArea').value = '';
  hideError();
  lastResult = null;
}

function showLoading(on) {
  document.getElementById('loadingBox').style.display = on ? 'block' : 'none';
  document.getElementById('distillBtn').disabled = on;
}

function showError(msg) {
  var el = document.getElementById('errorBox');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorBox').style.display = 'none';
}

// Init
chrome.storage.local.get('nd_code', function(s) {
  savedCode = s.nd_code || '';
  if (savedCode) document.getElementById('codeInput').value = savedCode;
  updateStatus();
});
chrome.tabs.query({active:true, currentWindow:true}, function(tabs) {
  if (tabs && tabs[0]) {
    currentTab = tabs[0];
    var url = currentTab.url || '';
    document.getElementById('urlDisplay').textContent = url.length > 55 ? url.substring(0,55) + '...' : (url || 'No URL');
  }
});
