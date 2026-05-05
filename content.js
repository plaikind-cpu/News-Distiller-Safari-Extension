// News-Distiller content.js
// Multi-strategy article extraction. Mirrors the chrome.scripting.executeScript path in popup.js
// so that when popup.js falls back to chrome.tabs.sendMessage, behavior is consistent.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'getPageText') return false;
  try {
    // STRATEGY 1: JSON-LD structured data
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
        'main'
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
    sendResponse({
      text: cleaned.substring(0, 25000),
      url: window.location.href,
      title: document.title
    });
  } catch(e) {
    sendResponse({ text: '', error: e.message });
  }
  return true;
});
