const isTelegram = location.hostname.includes('web.telegram.org');
const isVK = location.hostname.includes('vk.com');
const processedIds = new Set();

console.log('[Content] Loaded on', location.hostname);

if (isVK) {
  const style = document.createElement('style');
  style.textContent = `video, audio { autoplay: false !important; -webkit-media-controls-auto-play-button: none !important; }`;
  document.head.appendChild(style);
  setInterval(() => document.querySelectorAll('video, audio').forEach(el => { el.muted = true; el.pause(); el.autoplay = false; }), 2000);
  new MutationObserver(m => m.forEach(mut => mut.addedNodes.forEach(node => {
    if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') { node.muted = true; node.pause(); node.autoplay = false; }
    else if (node.querySelectorAll) node.querySelectorAll('video, audio').forEach(el => { el.muted = true; el.pause(); el.autoplay = false; });
  }))).observe(document.body, { childList: true, subtree: true });
}

async function collectAllStylesDeep() {
  let combined = '';
  const origin = location.origin;

  // встроенные <style>
  document.querySelectorAll('style').forEach(s => combined += s.textContent + '\n');

  // внешние <link>
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  await Promise.all(links.map(async link => {
    try {
      const res = await fetch(link.href);
      const css = await res.text();
      combined += css + '\n';
    } catch(e) { console.warn('Failed fetch', link.href, e); }
  }));

  // динамические правила из document.styleSheets (дополнительно)
  Array.from(document.styleSheets).forEach(sheet => {
    try {
      Array.from(sheet.cssRules || sheet.rules || []).forEach(rule => combined += rule.cssText + '\n');
    } catch(e) {}
  });

  // преобразование url(...) в абсолютные
  combined = combined.replace(/url\(["']?([^)"']+)["']?\)/gi, (match, url) => {
    if (url.startsWith('http') || url.startsWith('data:')) return match;
    try { return `url("${new URL(url, origin).href}")`; } catch(e) { return match; }
  });
  return combined;
}

function getMessageId(el) {
  if (isTelegram) return `tg-${el.getAttribute('data-message-id') || ''}`;
  const msgId = el.getAttribute('data-msgid') || el.getAttribute('data-id');
  if (msgId) return `vk-${msgId}`;
  const text = el.querySelector('.MessageText')?.innerText || '';
  const time = el.querySelector('.ConvoMessageInfoWithoutBubbles__date')?.innerText || '';
  return `vk-${text}-${time}`;
}

function filterGroupToMessage(groupClone, targetId) {
  groupClone.querySelectorAll('.Message.message-list-item').forEach(msg => {
    if (msg.getAttribute('data-message-id') !== targetId) msg.remove();
  });
  groupClone.querySelectorAll('.UPrRM3Ks, .Avatar, [class*="avatar-container"]').forEach(el => el.style.height = '100%');
  groupClone.style.cssText = 'height:auto; min-height:0; max-height:none';
  return groupClone;
}

function extractMessage(el) {
  let html, text, sender, time, numericId = 0;

  if (isTelegram) {
    const group = el.closest('.sender-group-container');
    if (group) {
      const clone = group.cloneNode(true);
      html = filterGroupToMessage(clone, el.getAttribute('data-message-id')).outerHTML;
    } else html = el.cloneNode(true).outerHTML;
    text = el.querySelector('.text-content')?.innerText?.trim() || '';
    sender = (el.closest('.sender-group-container')?.querySelector('.sender-title')?.innerText || 'Telegram').trim();
    const t = el.querySelector('.message-time')?.innerText?.trim() || '';
    const [h,m] = t.split(':').map(Number);
    time = (isNaN(h)||isNaN(m)) ? Date.now() : new Date().setHours(h,m,0,0);

    // Извлекаем числовой ID из id="message-12345"
    const idMatch = el.id?.match(/message-(\d+)/);
    if (idMatch) numericId = parseInt(idMatch[1], 10);
  } else {
    const article = el.closest('article.ConvoHistory__messageBlock');
    html = article ? article.cloneNode(true).outerHTML : el.cloneNode(true).outerHTML;
    text = el.querySelector('.MessageText')?.innerText?.trim() || '';
    sender = el.querySelector('.PeerTitle__title')?.innerText?.trim() || 'VK';
    const t = el.querySelector('.ConvoMessageInfoWithoutBubbles__date')?.innerText?.trim() || '';
    const [h,m] = t.split(':').map(Number);
    time = (isNaN(h)||isNaN(m)) ? Date.now() : new Date().setHours(h,m,0,0);

    // Извлекаем числовой ID из data-itemkey или data-msgid
    const itemKey = article?.getAttribute('data-itemkey') || el.getAttribute('data-msgid');
    if (itemKey) numericId = parseInt(itemKey, 10);
  }

  return {
    id: getMessageId(el),
    text,
    sender,
    time,
    numericId,                    // <-- добавляем
    source: isTelegram ? 'telegram' : 'vk',
    elementHTML: html
  };
}

function scanMessages() {
  const selector = isTelegram ? '.Message.message-list-item, .message-list-item' : '.ConvoHistory__messageWrapper .ConvoMessageWithoutBubble, .im-mess-stack--mess';
  const newMsgs = [];
  document.querySelectorAll(selector).forEach(el => {
    try {
      const id = getMessageId(el);
      if (!processedIds.has(id)) { processedIds.add(id); newMsgs.push(extractMessage(el)); }
    } catch(e) {}
  });
  if (newMsgs.length) chrome.runtime.sendMessage({ type: 'NEW_MESSAGES', source: isTelegram ? 'telegram' : 'vk', messages: newMsgs });
}

setTimeout(scanMessages, 1000);
setInterval(scanMessages, 500);
new MutationObserver(() => scanMessages()).observe(document.body, { childList: true, subtree: true });
window.addEventListener('scroll', () => setTimeout(scanMessages, 300), { passive: true });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCAN_NOW') scanMessages();
  if (msg.type === 'COLLECT_STYLES') {
    collectAllStylesDeep().then(css => {
      chrome.runtime.sendMessage({ type: 'SAVE_STYLES', source: isTelegram ? 'telegram' : 'vk', css });
      sendResponse({ success: true });
    }).catch(err => sendResponse({ success: false }));
    return true;
  }
});