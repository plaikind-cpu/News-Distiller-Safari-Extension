// News-Distiller content.js
// Extracts article text from the current page

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageText') {
    try {
      let text = '';
      // Try article-specific selectors first
      const selectors = [
        'article',
        '[class*="article-body"]',
        '[class*="story-body"]',
        '[class*="post-content"]',
        '[class*="entry-content"]',
        '[class*="article-content"]',
        '[class*="story-content"]',
        'main'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          text = el.innerText.trim();
          if (text.length > 500) break;
        }
      }
      // Fallback to body
      if (text.length < 500) {
        text = document.body.innerText.trim();
      }
      sendResponse({ text: text.substring(0, 25000), url: window.location.href, title: document.title });
    } catch(e) {
      sendResponse({ text: '', error: e.message });
    }
  }
  return true;
});
