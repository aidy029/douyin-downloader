// Keep a bounded, in-page cache of work objects already returned to this page.
// No cookies or responses are sent to the extension or to another server.
(() => {
  if (window.__mediaCollectorCache) return;
  const cache = window.__mediaCollectorCache = Object.create(null);
  const save = data => {
    let remaining = 30000;
    const seen = new WeakSet();
    function walk(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 18 || --remaining < 0 || seen.has(value)) return;
      seen.add(value);
      const id = value.aweme_id || value.awemeId;
      if (id && (value.video || value.images || value.imagePostInfo)) {
        cache[id] = value;
        const ids = Object.keys(cache);
        if (ids.length > 100) delete cache[ids[0]];
      }
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
    try { walk(data); } catch { /* page response is not an ordinary JSON object */ }
  };
  const relevant = url => /\/aweme\/v\d+\/web\//.test(String(url));
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    promise.then(response => {
      if (relevant(response.url)) response.clone().json().then(save).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    // responseURL belongs to the completed request, including reused XHR objects.
    if (!this.__collectorObserved) {
      this.__collectorObserved = true;
      this.addEventListener('load', () => {
        if (!relevant(this.responseURL)) return;
        try { save(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch { /* non JSON */ }
      });
    }
    return originalOpen.apply(this, args);
  };
})();
