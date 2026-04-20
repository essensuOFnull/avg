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

// Вспомогательная функция: оставить в клоне группы только указанное сообщение по ID
function filterGroupToMessage(groupClone, targetMessageId) {
  // Удаляем все сообщения, кроме нужного
  const messages = groupClone.querySelectorAll('.Message.message-list-item');
  for (const msg of messages) {
    const msgId = msg.getAttribute('data-message-id');
    if (msgId !== targetMessageId) {
      msg.remove();
    }
  }
  
  // Удаляем контейнер с аватаром, который растягивает группу
  const avatarContainers = groupClone.querySelectorAll('.UPrRM3Ks, .Avatar, [class*="avatar-container"]');
  avatarContainers.forEach(el => el.style.height="100%");
  
  // Сбрасываем фиксированные высоты
  groupClone.style.height = 'auto';
  groupClone.style.minHeight = '0';
  groupClone.style.maxHeight = 'none';
  
  return groupClone;
}

function extractMessage(el) {
  let text, time, sender;
  let clonedElement;

  if (isTelegram) {
    // Находим родительскую группу
    const group = el.closest('.sender-group-container');
    if (group) {
      // Клонируем группу с вычисленными стилями
      const groupClone = cloneWithComputedStyles(group);
      // Оставляем только нужное сообщение
      const msgId = el.getAttribute('data-message-id');
      clonedElement = filterGroupToMessage(groupClone, msgId);
    } else {
      // Если группы нет, клонируем само сообщение (запасной вариант)
      clonedElement = cloneWithComputedStyles(el);
    }

    const textEl = el.querySelector('.text-content');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.sender-title') || group?.querySelector('.sender-title');
    sender = senderEl?.innerText?.trim() || 'Telegram';
    const timeEl = el.querySelector('.message-time');
    time = parseTelegramTime(timeEl?.innerText?.trim() || '');
  } else {
    // VK остаётся без изменений
    const textEl = el.querySelector('.MessageText');
    text = textEl?.innerText?.trim() || '';
    const senderEl = el.querySelector('.PeerTitle__title');
    sender = senderEl?.innerText?.trim() || 'VK';
    const timeEl = el.querySelector('.ConvoMessageInfoWithoutBubbles__date');
    time = parseVKTime(timeEl?.innerText?.trim() || '');

    clonedElement = cloneWithComputedStyles(el);

    // Удаляем прелоадеры видео в VK
    if (isVK) {
      const loadingElements = clonedElement.querySelectorAll('.AttachVideoMessage__loading');
      loadingElements.forEach(elem => elem.remove());
    }
  }

  return {
    id: getMessageId(el),
    text,
    sender,
    time,
    source: isTelegram ? 'telegram' : 'vk',
    elementHTML: clonedElement.outerHTML
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