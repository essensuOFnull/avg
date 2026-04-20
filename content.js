const isTelegram = location.hostname.includes('web.telegram.org');
const isVK = location.hostname.includes('vk.com');
const processedIds = new Set();

console.log('[Content] Loaded on', location.hostname);

// Функция глубокого клонирования с вычисленными стилями
function cloneWithComputedStyles(element) {
  const clone = element.cloneNode(true);
  
  function applyStyles(source, target) {
    if (source.nodeType !== Node.ELEMENT_NODE) return;
    
    const computed = window.getComputedStyle(source);
    let styleString = '';
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      const value = computed.getPropertyValue(prop);
      // Пропускаем свойства, название или значение которых содержит 'blur'
      if (prop.toLowerCase().includes('blur') || value.toLowerCase().includes('blur')) {
        continue;
      }
      styleString += `${prop}: ${value}; `;
    }
    target.style.cssText = styleString;
    
    // Дополнительно удаляем классы, содержащие 'blurred' (если нужно)
    if (target.className && typeof target.className === 'string') {
      target.className = target.className.split(' ').filter(c => !c.toLowerCase().includes('blurred')).join(' ');
    }
    
    const sourceChildren = source.children;
    const targetChildren = target.children;
    for (let i = 0; i < sourceChildren.length; i++) {
      applyStyles(sourceChildren[i], targetChildren[i]);
    }
  }
  
  applyStyles(element, clone);
  return clone;
}

function getMessageId(el) {
  if (isTelegram) {
    const msgId = el.getAttribute('data-message-id') || '';
    return `tg-${msgId}`;
  } else {
    // Более надёжный ID для VK
    const msgId = el.getAttribute('data-msgid') || el.getAttribute('data-id');
    if (msgId) return `vk-${msgId}`;
    const text = el.querySelector('.MessageText')?.innerText || '';
    const time = el.querySelector('.ConvoMessageInfoWithoutBubbles__date')?.innerText || '';
    return `vk-${text}-${time}`;
  }
}

function extractMessage(el) {
  let text, time, sender;
  if (isTelegram) {
    const textEl = el.querySelector('.text-content');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.sender-title');
    sender = senderEl?.innerText?.trim() || 'Telegram';
    const timeEl = el.querySelector('.message-time');
    time = parseTelegramTime(timeEl?.innerText?.trim() || '');
  } else {
    const textEl = el.querySelector('.MessageText');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.PeerTitle__title');
    sender = senderEl?.innerText?.trim() || 'VK';
    const timeEl = el.querySelector('.ConvoMessageInfoWithoutBubbles__date');
    time = parseVKTime(timeEl?.innerText?.trim() || '');
  }
  
  // Клонируем с вычисленными стилями
  const cloned = cloneWithComputedStyles(el);
  
  return {
    id: getMessageId(el),
    text,
    sender,
    time,
    source: isTelegram ? 'telegram' : 'vk',
    elementHTML: cloned.outerHTML
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
    // Универсальный селектор для Telegram Web
    selector = '.Message.message-list-item, .message-list-item';
  } else {
    // VK: основной селектор сообщений
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

// Запускаем сканирование при загрузке и при изменениях DOM
setTimeout(scanMessages, 1000);
setInterval(scanMessages, 2000); // более частое сканирование

const observer = new MutationObserver(() => scanMessages());
observer.observe(document.body, { childList: true, subtree: true });

// Также реагируем на события скролла, т.к. новые сообщения могут подгружаться при прокрутке
window.addEventListener('scroll', () => {
  // Небольшая задержка, чтобы DOM обновился
  setTimeout(scanMessages, 300);
}, { passive: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCAN_NOW') {
    scanMessages();
  }
});