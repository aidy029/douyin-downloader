// Persist batches so tracking survives popup closure and worker sleep.
async function reconcileDownloads() {
  const batches = (await chrome.storage.local.get('downloadBatches')).downloadBatches || [];
  for (const batch of batches.filter(item => !item.finished)) {
    const states = await Promise.all(batch.files.map(async file => {
      if (file.error) return { ...file, state: 'interrupted' };
      const [item] = await chrome.downloads.search({ id: file.id });
      return { ...file, state: item?.state || 'interrupted', error: item?.error || (!item ? '下载记录已删除' : '') };
    }));
    if (states.some(item => item.state === 'in_progress')) continue;
    batch.finished = true;
    batch.files = states;
    const failed = states.filter(item => item.state !== 'complete');
    const notice = {
      batchId: batch.id, failed: failed.length, at: Date.now(),
      title: failed.length ? '素材下载未全部完成' : '素材下载完成',
      message: `${batch.title.slice(0, 60)}\n${states.length - failed.length}/${states.length} 个文件已保存${failed.length ? '；失败：' + failed.map(item => item.name).join('、') : ''}\n${batch.folder}`
    };
    await chrome.storage.local.set({ downloadBatches: batches, latestDownloadNotice: notice });
    try {
      await chrome.notifications.create(`download-${batch.id}`, {
        type: 'basic', iconUrl: chrome.runtime.getURL('images/notification.png'),
        title: notice.title, message: notice.message
      });
    } catch { /* The persisted notice remains visible if notifications are blocked. */ }
  }
  await chrome.storage.local.set({ downloadBatches: [...batches.filter(item => !item.finished), ...batches.filter(item => item.finished).slice(-50)] });
}
function scheduleDownloadCheck() {
  queue = queue.then(reconcileDownloads).catch(error => console.error('下载状态检查失败', error));
}
chrome.downloads.onChanged.addListener(delta => { if (delta.state || delta.error) scheduleDownloadCheck(); });
chrome.downloads.onErased.addListener(scheduleDownloadCheck);
chrome.runtime.onStartup.addListener(scheduleDownloadCheck);
chrome.runtime.onInstalled.addListener(scheduleDownloadCheck);
chrome.notifications.onClicked.addListener(async notificationId => {
  if (!notificationId.startsWith('download-')) return;
  const batches = (await chrome.storage.local.get('downloadBatches')).downloadBatches || [];
  const batch = batches.find(item => `download-${item.id}` === notificationId);
  const file = batch?.files.find(item => item.state === 'complete');
  if (file) { try { await chrome.downloads.show(file.id); } catch { chrome.downloads.showDefaultFolder(); } }
  else chrome.tabs.create({ url: 'chrome://downloads/' });
});
