const $ = id => document.getElementById(id);
document.querySelector('header > span').textContent = `Chrome ${chrome.runtime.getManifest().version}`;
let works = [];
let savedDirectory = '抖音素材';
async function loadSettings() {
  const settings = await chrome.storage.local.get('outputDirectory');
  savedDirectory = settings.outputDirectory ?? '抖音素材';
  $('directory').value = savedDirectory;
  previewDirectory();
}
function previewDirectory() {
  const directory = $('directory').value.trim().replace(/\\/g, '/');
  $('directory-preview').textContent = `保存位置：Chrome 下载目录/${directory ? directory + '/' : ''}douyin-作品ID/`;
}
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '扩展未响应，请重新加载插件');
  return result.data;
}
async function load() {
  const stored = await chrome.storage.local.get('works');
  works = stored.works || [];
  render();
}
function button(label, action) {
  const el = document.createElement('button'); el.textContent = label;
  el.addEventListener('click', async () => {
    el.disabled = true;
    try { await action(); } catch (error) { status(error.message, true); } finally { el.disabled = false; }
  });
  return el;
}
function render() {
  $('count').textContent = works.length;
  $('list').replaceChildren();
  const query = $('search').value.trim().toLowerCase();
  const items = works.filter(work => `${work.title} ${work.author} ${work.id}`.toLowerCase().includes(query));
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = works.length ? '没有匹配的素材。试试作者或作品 ID。' : '还没有采集作品。打开抖音作品详情，点击上方按钮开始。';
    $('list').append(empty);
  }
  for (const work of items) {
    const row = document.createElement('article'); row.className = 'work';
    const cover = document.createElement('img'); cover.className = 'cover'; cover.alt = '作品封面'; cover.referrerPolicy = 'no-referrer';
    cover.addEventListener('error', () => { cover.removeAttribute('src'); cover.alt = '暂无封面'; }, { once: true });
    if (/^https?:\/\//.test(work.cover)) cover.src = work.cover;
    const body = document.createElement('div');
    const title = document.createElement('div'); title.className = 'title'; title.textContent = work.title;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${work.author || '作者未读取'} · ${work.type === 'note' ? `图文 ${work.images.length} 张` : '视频'} · ${work.comments.length} 条可见评论`;
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('下载素材', async () => {
      const results = await send({ type: 'download', id: work.id });
      const errors = results.filter(item => item.error);
      status(`已提交 ${results.length - errors.length} 个下载任务，请在 Chrome 下载列表查看完成状态。${errors.length ? '\n提交失败：' + errors.map(item => item.name + '：' + item.error).join('；') : ''}`, !!errors.length);
    }), button('原作品', () => chrome.tabs.create({ url: work.pageUrl })), button('删除记录', async () => { await send({ type: 'delete', id: work.id }); await load(); }));
    body.append(title, meta, actions); row.append(cover, body); $('list').append(row);
  }
}
$('collect').addEventListener('click', async () => {
  $('collect').disabled = true; status('正在读取当前作品…');
  try {
    const work = await send({ type: 'collect' }); await load();
    status(`已保存：${work.title}${work.warning ? '\n' + work.warning : ''}${work.type === 'video' && !work.videoUrl ? '\n尚未读取到视频地址，请播放后重新采集。' : ''}`);
  } catch (error) { status(error.message, true); } finally { $('collect').disabled = false; }
});
$('search').addEventListener('input', render);
$('directory').addEventListener('input', previewDirectory);
$('directory-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    savedDirectory = await send({ type: 'save-settings', directory: $('directory').value });
    $('directory').value = savedDirectory; previewDirectory();
    status('下载目录设置已保存，下次点击「下载素材」将自动按作品文件夹归档。');
  } catch (error) { status(error.message, true); }
});
$('download-settings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/downloads' }));
async function dismissWelcome() {
  await chrome.storage.local.set({ welcomeSeen: true });
  $('welcome').close();
}
$('welcome-dismiss').addEventListener('click', dismissWelcome);
$('welcome').addEventListener('cancel', event => { event.preventDefault(); dismissWelcome(); });
$('download-help-settings').addEventListener('click', async () => {
  await dismissWelcome();
  await chrome.tabs.create({ url: 'chrome://settings/downloads' });
});
chrome.storage.local.get('welcomeSeen').then(settings => {
  if (!settings.welcomeSeen) $('welcome').showModal();
});
$('open-downloads').addEventListener('click', () => chrome.downloads.showDefaultFolder());
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(works, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'douyin-library.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
chrome.storage.onChanged.addListener(changes => { if (changes.works) load().catch(error => status(error.message, true)); });
load().catch(error => status(error.message, true));
loadSettings().catch(error => status(error.message, true));
