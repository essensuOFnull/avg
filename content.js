const isTelegram = location.hostname.includes('web.telegram.org');
const isVK = location.hostname.includes('vk.com');
const processedIds = new Set();

console.log('[Content] Loaded on', location.hostname);

// --- БЛОК ОТКЛЮЧЕНИЯ АВТОВОСПРОИЗВЕДЕНИЯ ДЛЯ VK (без изменений) ---
if (isVK) {
  const style = document.createElement('style');
  style.textContent = `
    video, audio {
      autoplay: false !important;
      -webkit-media-controls-auto-play-button: none !important;
    }
  `;
  document.head.appendChild(style);
  
  function pauseAllMedia() {
    document.querySelectorAll('video, audio').forEach(el => {
      el.muted = true;
      el.pause();
      el.autoplay = false;
    });
  }
  setInterval(pauseAllMedia, 2000);
  
  const mediaObserver = new MutationObserver((mutations) => {
    mutations.forEach(mut => {
      mut.addedNodes.forEach(node => {
        if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
          node.muted = true;
          node.pause();
          node.autoplay = false;
        } else if (node.querySelectorAll) {
          node.querySelectorAll('video, audio').forEach(el => {
            el.muted = true;
            el.pause();
            el.autoplay = false;
          });
        }
      });
    });
  });
  mediaObserver.observe(document.body, { childList: true, subtree: true });
}
// -------------------------------------------------

// Функция для извлечения всех стилей текущей страницы
function getAllStyles() {
  let styleText = '';
  try {
    const styleSheets = document.styleSheets;
    for (let sheet of styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (rules) {
          for (let rule of rules) {
            styleText += rule.cssText + '\n';
          }
        }
      } catch (e) {
        // Межсайтовые таблицы стилей недоступны – игнорируем
        console.warn('[Content] Cannot access stylesheet:', e);
      }
    }
  } catch (e) {}
  
  // Добавляем инлайн-стили, определённые в <style>
  document.querySelectorAll('style').forEach(style => {
    styleText += style.textContent + '\n';
  });
  
  return styleText;
}

// Однократно собираем стили страницы
const pageStyles = getAllStyles();
console.log('[Content] Collected styles length:', pageStyles.length);

function getMessageId(el) {
  if (isTelegram) {
    const msgId = el.getAttribute('data-message-id') || '';
    return `tg-${msgId}`;
  } else {
    const msgId = el.getAttribute('data-msgid') || el.getAttribute('data-id');
    if (msgId) return `vk-${msgId}`;
    const text = el.querySelector('.MessageText')?.innerText || '';
    const time = el.querySelector('.ConvoMessageInfoWithoutBubbles__date')?.innerText || '';
    return `vk-${text}-${time}`;
  }
}

function filterGroupToMessage(groupClone, targetMessageId) {
  const messages = groupClone.querySelectorAll('.Message.message-list-item');
  for (const msg of messages) {
    const msgId = msg.getAttribute('data-message-id');
    if (msgId !== targetMessageId) {
      msg.remove();
    }
  }
  
  const avatarContainers = groupClone.querySelectorAll('.UPrRM3Ks, .Avatar, [class*="avatar-container"]');
  avatarContainers.forEach(el => el.style.height = "100%");
  
  groupClone.style.height = 'auto';
  groupClone.style.minHeight = '0';
  groupClone.style.maxHeight = 'none';
  
  return groupClone;
}

function extractMessage(el) {
  let text, time, sender;
  let htmlContent;

  if (isTelegram) {
    const group = el.closest('.sender-group-container');
    if (group) {
      const groupClone = group.cloneNode(true); // обычное клонирование
      const msgId = el.getAttribute('data-message-id');
      htmlContent = filterGroupToMessage(groupClone, msgId).outerHTML;
    } else {
      htmlContent = el.cloneNode(true).outerHTML;
    }

    const textEl = el.querySelector('.text-content');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.sender-title') || group?.querySelector('.sender-title');
    sender = senderEl?.innerText?.trim() || 'Telegram';
    const timeEl = el.querySelector('.message-time');
    time = parseTelegramTime(timeEl?.innerText?.trim() || '');
  } else {
    // VK: клонируем статью целиком (для сохранения иконок)
    const article = el.closest('article.ConvoHistory__messageBlock');
    htmlContent = article ? article.cloneNode(true).outerHTML : el.cloneNode(true).outerHTML;

    const textEl = el.querySelector('.MessageText');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.PeerTitle__title');
    sender = senderEl?.innerText?.trim() || 'VK';
    const timeEl = el.querySelector('.ConvoMessageInfoWithoutBubbles__date');
    time = parseVKTime(timeEl?.innerText?.trim() || '');
  }

  return {
    id: getMessageId(el),
    text,
    sender,
    time,
    source: isTelegram ? 'telegram' : 'vk',
    elementHTML: htmlContent,
    styles: pageStyles // передаём собранные стили страницы
  };
}

function parseTelegramTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return Date.now();
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function parseVKTime(timeStr) {
  const clean = timeStr.trim();
  const [hours, minutes] = clean.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return Date.now();
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function scanMessages() {
  console.log('[Content] Scanning messages on', location.hostname);
  let selector;
  if (isTelegram) {
    selector = '.Message.message-list-item, .message-list-item';
  } else {
    selector = '.ConvoHistory__messageWrapper .ConvoMessageWithoutBubble, .im-mess-stack--mess';
  }
  
  const messages = document.querySelectorAll(selector);
  console.log(`[Content] Found ${messages.length} potential message elements`);
  const newMessages = [];
  
  messages.forEach(el => {
    try {
      const id = getMessageId(el);
      if (!processedIds.has(id)) {
        processedIds.add(id);
        newMessages.push(extractMessage(el));
      }
    } catch (e) {
      console.warn('[Content] Error extracting message', e);
    }
  });
  
  if (newMessages.length > 0) {
    console.log(`[Content] Sending ${newMessages.length} new messages`);
    chrome.runtime.sendMessage({
      type: 'NEW_MESSAGES',
      source: isTelegram ? 'telegram' : 'vk',
      messages: newMessages
    });
  }
}

setTimeout(scanMessages, 1000);
setInterval(scanMessages, 2000);

const observer = new MutationObserver(() => scanMessages());
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('scroll', () => {
  setTimeout(scanMessages, 300);
}, { passive: true });

// Функция сбора ВСЕХ стилей страницы с заменой относительных путей
function collectAllStylesWithAbsoluteUrls() {
  const origin = location.origin;
  let combinedCSS = '';
  
  // 1. Встроенные <style>
  document.querySelectorAll('style').forEach(style => {
    combinedCSS += style.textContent + '\n';
  });
  
  // 2. Стили из CSSStyleSheet (доступные)
  const sheets = Array.from(document.styleSheets);
  sheets.forEach(sheet => {
    try {
      const rules = Array.from(sheet.cssRules || sheet.rules || []);
      rules.forEach(rule => {
        combinedCSS += rule.cssText + '\n';
      });
    } catch (e) {
      // Пропускаем заблокированные CORS-листы
    }
  });
  
  // Заменяем все url(...) на абсолютные, если они не http(s)/data
  combinedCSS = combinedCSS.replace(/url\(["']?([^)"']+)["']?\)/gi, (match, url) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
      return match;
    }
    const absoluteUrl = new URL(url, origin).href;
    return `url("${absoluteUrl}")`;
  });
  
  return combinedCSS;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCAN_NOW') {
    scanMessages();
  }
  if (message.type === 'COLLECT_STYLES') {
    const css = collectAllStylesWithAbsoluteUrls();
    const source = isTelegram ? 'telegram' : 'vk';
    const storageKey = `${source}_styles`;
    chrome.storage.local.set({ [storageKey]: css }, () => {
      sendResponse({ success: true });
    });
    return true; // для асинхронного sendResponse
  }
});