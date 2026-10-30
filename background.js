importScripts('extract.js', 'download-status.js');
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const operation = queue.then(() => handle(message));
  queue = operation.catch(() => {});
  operation.then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
  return true;
});
async function records() { return (await chrome.storage.local.get('works')).works || []; }
function outputDirectory(value) {
  const directory = String(value ?? '抖音素材').trim().replace(/\\/g, '/');
  if (!directory) return '';
  const segments = directory.split('/');
  if (directory.length > 150 || segments.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('请输入下载根目录下的子目录，例如：抖音素材/收藏。不能填写盘符、绝对路径或 ..');
  }
  return segments.join('/');
}
async function readTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['observe.js'] });
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: extractCurrentWork });
  return injection?.result;
}
async function readDetailFallback(sourceUrl, previous) {
  const url = new URL(sourceUrl);
  const id = url.searchParams.get('modal_id');
  if (!/^\d+$/.test(id || '')) return previous;
  const detail = await chrome.tabs.create({ url: `https://www.douyin.com/video/${id}`, active: false });
  try {
    // The independent detail URL avoids jingxuan/user routes that ignore modal_id.
    for (let attempt = 0; attempt < 20; attempt++) {
      const tab = await chrome.tabs.get(detail.id);
      if (tab.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await readTab(detail.id);
      if (result?.id === id) return result;
    }
    return { error: `${result?.error || previous?.error || '作品详情未加载'} 如需登录或验证，请直接打开 https://www.douyin.com/video/${id} 完成后再采集。` };
  } finally { await chrome.tabs.remove(detail.id).catch(() => {}); }
}
async function handle(message) {
  if (message.type === 'save-settings') {
    const directory = outputDirectory(message.directory);
    await chrome.storage.local.set({ outputDirectory: directory });
    return directory;
  }
  if (message.type === 'collect') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?douyin\.com\//.test(tab.url || '')) throw new Error('请在 Chrome 中打开抖音作品页，再点击插件采集');
    let work = await readTab(tab.id);
    if (!work?.id) work = await readDetailFallback(tab.url, work);
    if (work?.error) throw new Error(work.error);
    if (!work?.id) throw new Error('采集失败，请刷新作品页后重试');
    const list = await records();
    await chrome.storage.local.set({ works: [work, ...list.filter(item => item.id !== work.id)] });
    return work;
  }
  if (message.type === 'delete') {
    await chrome.storage.local.set({ works: (await records()).filter(item => item.id !== message.id) });
    return;
  }
  if (message.type === 'download') {
    const work = (await records()).find(item => item.id === message.id);
    if (!work) throw new Error('素材记录不存在');
    const directory = outputDirectory((await chrome.storage.local.get('outputDirectory')).outputDirectory);
    const folder = [directory, `douyin-${work.id}`].filter(Boolean).join('/');
    const files = [];
    if (work.cover) files.push([work.cover, 'cover.jpg']);
    if (work.videoUrl) files.push([work.videoUrl, 'video.mp4']);
    work.images.forEach((url, index) => files.push([url, `image_${String(index + 1).padStart(2, '0')}.jpg`]));
    files.push(['data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(work, null, 2)), 'meta.json']);
    const results = [];
    for (const [url, name] of files) {
      if (!/^https?:\/\//.test(url) && !url.startsWith('data:application/json;')) continue;
      try {
        const id = await chrome.downloads.download({ url, filename: `${folder}/${name}`, saveAs: false, conflictAction: 'uniquify' });
        results.push({ name, id });
      } catch (error) { results.push({ name, error: error.message }); }
    }
    const batches = (await chrome.storage.local.get('downloadBatches')).downloadBatches || [];
    batches.push({ id: crypto.randomUUID(), title: work.title || work.id, folder, files: results, finished: false });
    await chrome.storage.local.set({ downloadBatches: batches });
    await reconcileDownloads();
    return results;
  }
  throw new Error('不支持的操作');
}
