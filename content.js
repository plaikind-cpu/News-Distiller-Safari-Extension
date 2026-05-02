chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageText') {
    try {
      // Remove script/style elements from consideration
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());

      // Get text content
      let text = clone.innerText || clone.textContent || '';

      // Clean up whitespace
      text = text.replace(/\s+/g, ' ').trim();

      // Limit to ~15000 chars
      if (text.length > 15000) {
        text = text.substring(0, 15000);
      }

      sendResponse({
        text: text,
        title: document.title,
        url: window.location.href
      });
    } catch (e) {
      sendResponse({ text: '', title: document.title, url: window.location.href, error: e.message });
    }
  }
  return true; // keep channel open for async
});
