// News-Distiller Full Report page
// Reads pre-built styleCss + bodyHtml from chrome.storage.local and injects them.
// Wires the Aa text-size toggle with try/catch around localStorage (Safari extension safe).

(function() {
  function injectReport() {
    chrome.storage.local.get(['nd_report_style', 'nd_report_body', 'nd_report_ts'], function(result) {
      if (chrome.runtime.lastError || !result.nd_report_body) {
        document.getElementById('content').innerHTML =
          '<div style="font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#888;">' +
          'No report found. Please run a distill first.</div>';
        return;
      }
      // Apply dynamic styles
      var styleEl = document.getElementById('dyn-style');
      if (styleEl && result.nd_report_style) {
        styleEl.textContent = result.nd_report_style;
      }
      // Inject body content
      document.getElementById('content').innerHTML = result.nd_report_body;
      // Clean up storage so next load doesn't show stale data
      try { chrome.storage.local.remove(['nd_report_style', 'nd_report_body', 'nd_report_ts']); } catch(e) {}
    });
  }

  function initAaToggle() {
    var btn = document.getElementById('ndAaBtn');
    if (!btn) return;
    try {
      if (localStorage.getItem('nd_large_text_report') === '1') {
        document.body.classList.add('large-text');
        btn.classList.add('active');
      }
    } catch(e) {}
    btn.addEventListener('click', function() {
      var on = document.body.classList.toggle('large-text');
      btn.classList.toggle('active', on);
      try { localStorage.setItem('nd_large_text_report', on ? '1' : '0'); } catch(e) {}
    });
  }

  function init() {
    initAaToggle();
    injectReport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
