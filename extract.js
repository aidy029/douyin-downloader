// Self-contained: Chrome serializes this function into the selected tab.
async function extractCurrentWork() {
  try {
  const url = new URL(location.href);
  if (url.hostname !== 'www.douyin.com' && url.hostname !== 'douyin.com') throw new Error('请先打开抖音作品页');
  const id = url.searchParams.get('modal_id') || url.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1];
  if (!/^\d+$/.test(id || '')) throw new Error('请打开一个视频或图文作品后再采集');
  const http = value => {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
  };
  const first = value => {
    if (typeof value === 'string') return http(value);
    if (Array.isArray(value)) return value.map(http).find(Boolean) || '';
    const list = value?.url_list || value?.urlList || [];
    return list.map(http).find(Boolean) || '';
  };
  let work = window.__mediaCollectorCache?.[id] || null;
  const seen = new WeakSet();
  let budget = 50000;
  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 35 || seen.has(node) || --budget < 0) return;
    seen.add(node);
    if (String(node.aweme_id || node.awemeId || '') === id && (node.video || node.images || node.imagePostInfo)) work = node;
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  for (const key of ['RENDER_DATA', 'SIGI_STATE', '__UNIVERSAL_DATA_FOR_REHYDRATION__']) {
    const raw = document.getElementById(key)?.textContent;
    if (!raw) continue;
    try { walk(JSON.parse(key === 'RENDER_DATA' ? decodeURIComponent(raw) : raw)); } catch { /* DOM fallback below */ }
  }
  for (const key of ['_ROUTER_DATA', '__INITIAL_STATE__', '__NEXT_DATA__']) {
    try { walk(window[key]); } catch { /* unavailable page state */ }
  }
  // SPA modals often have no hydration script/global: the mounted React props
  // hold the current work. Match the ID, never the first recommendation.
  if (!work) {
    const nodes = [...document.querySelectorAll('video,[data-e2e="aweme-detail"],[data-e2e="feed-active-video"],[role="dialog"]')];
    for (const el of nodes) {
      let ancestor = el;
      for (let level = 0; ancestor && level < 10 && !work; level++, ancestor = ancestor.parentElement) {
        for (const key of Object.keys(ancestor)) {
          if (/^__react(?:Props|Fiber|InternalInstance)\$/.test(key)) {
            try { walk(ancestor[key]); } catch { /* inaccessible framework prop */ }
          }
        }
      }
    }
  }
  if (!work) {
    // Same-origin request in the user's page session, with a hard timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&aweme_id=${id}`, { credentials: 'include', signal: controller.signal });
      if (response.ok) { budget = 50000; walk(await response.json()); }
    } catch { /* login/verification/API restrictions: report missing media below */ }
    finally { clearTimeout(timer); }
  }
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const players = [...document.querySelectorAll('video')].filter(visible);
  // Never use arbitrary page images/videos: recommendation feeds can contain other works.
  const player = players.length === 1 ? players[0] : null;
  const video = work?.video;
  const images = (work?.images || work?.imagePostInfo?.images || []).map(image => first(image.display_image || image.displayImage || image)).filter(Boolean);
  const videoUrl = images.length ? '' : first(video?.play_addr || video?.playAddr) || first(video?.bit_rate?.[0]?.play_addr) || first(video?.download_addr) || http(player?.currentSrc || player?.src || player?.querySelector('source')?.src);
  const cover = first(video?.cover || video?.origin_cover || video?.originCover) || images[0] || http(player?.poster) || http(meta('og:image'));
  const comments = [...document.querySelectorAll('[data-e2e="comment-item"]')].filter(visible).slice(0, 100).map(el => el.innerText.trim()).filter(Boolean);
  if (!videoUrl && !images.length) throw new Error(`作品 ${id} 未读取到可下载媒体。请刷新作品页（让新版插件监听数据），完成登录 / 验证并播放后重试。页面播放器可能使用 blob 地址，封面不代表采集成功。`);
  return {
    id, title: work?.desc || meta('og:title') || document.title,
    author: work?.author?.nickname || '', type: images.length || url.pathname.startsWith('/note/') ? 'note' : 'video',
    pageUrl: `https://www.douyin.com/${images.length || url.pathname.startsWith('/note/') ? 'note' : 'video'}/${id}`,
    cover, videoUrl, images, comments, collectedAt: new Date().toISOString(),
    warning: !work ? '使用页面可见媒体；未找到结构化作品数据，请核对预览。' : ''
  };
  } catch (error) { return { error: error.message }; }
}
