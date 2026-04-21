// После получения roomInfo
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'REQUEST_STYLES_COLLECTION', roomId });
}, 1500);

let roomId = null;
let roomKey = null;
const messagesMap = new Map();

const urlParams = new URLSearchParams(window.location.search);
roomId = urlParams.get('roomId');

console.log('[Messenger] Started, roomId:', roomId);

chrome.runtime.sendMessage({ type: 'GET_ROOM_INFO', roomId }, (response) => {
  if (response && response.key) {
    roomKey = response.key;
    document.getElementById('room-info').textContent = `Комната ${roomId.slice(-4)} ${roomKey ? '🔐' : ''}`;
    console.log('[Messenger] Room info received, key:', !!roomKey);
  } else {
    document.getElementById('room-info').textContent = `Комната ${roomId.slice(-4)} (нет данных)`;
  }
});

setTimeout(() => {
  console.log('[Messenger] Requesting initial scan');
  chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });
}, 2000);

setInterval(() => {
  if (roomId) {
    chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });
  }
}, 5000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MESSAGES_UPDATE' && message.roomId === roomId) {
    console.log('[Messenger] Received messages update', message.source, message.messages.length);
    addMessages(message.source, message.messages);
  }
});

async function addMessages(source, messages) {
  const container = document.getElementById('messages-container');
  
  // Загружаем стили для источника
  const storageKey = `${source}_styles`;
  const styles = await new Promise(resolve => {
    chrome.storage.local.get(storageKey, result => resolve(result[storageKey] || ''));
  });
  
  for (const msg of messages) {
    if (messagesMap.has(msg.id)) continue;
    
    let encrypted = false;
    if (roomKey && msg.text.startsWith('[ENC]')) {
      encrypted = true;
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.dataset.id = msg.id;
    wrapper.dataset.time = msg.time;
    
    // Заголовок сообщения (упрощённый)
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const sourceIcon = document.createElement('img');
    sourceIcon.src = source === 'telegram' 
      ? 'https://web.telegram.org/favicon.ico' 
      : 'https://vk.com/favicon.ico';
    sourceIcon.alt = source;
    
    const sourceLabel = document.createElement('span');
    sourceLabel.className = 'source-label';
    sourceLabel.textContent = source === 'telegram' ? 'Telegram' : 'VK';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const lockSpan = document.createElement('span');
    lockSpan.className = `lock-icon ${encrypted ? 'lock-closed' : 'lock-open'}`;
    lockSpan.textContent = encrypted ? '🔒' : '🔓';
    
    header.appendChild(sourceIcon);
    header.appendChild(sourceLabel);
    header.appendChild(timeSpan);
    header.appendChild(lockSpan);
    wrapper.appendChild(header);
    
    // Создаём iframe
    const iframe = document.createElement('iframe');
    iframe.className = 'message-iframe';
    iframe.sandbox = 'allow-same-origin';
    
    wrapper.appendChild(iframe);
    container.appendChild(wrapper);
    
    // Подгонка высоты после загрузки
    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        const height = doc.body.scrollHeight;
        iframe.style.height = height + 'px';
      } catch (e) {}
    };
    // HTML для iframe
    const baseUrl = source === 'telegram' ? 'https://web.telegram.org' : 'https://vk.com';
    const docType = '<!DOCTYPE html>';
    const html = `
      <html>
        <head>
          <base href="${baseUrl}">
          <meta name="color-scheme" content="dark">
          <style>
            html, body { 
              margin: 0; 
              padding: 0; 
              background: #0e1621 !important;
              overflow:hidden;
            }
            ${styles}
          </style>
        </head>
        <body>${msg.elementHTML}</body>
      </html>
    `;
    
    iframe.srcdoc = docType + html;
    
    messagesMap.set(msg.id, wrapper);
    insertSorted(container, wrapper, msg.time);
  }
}

function insertSorted(container, newEl, time) {
  const children = Array.from(container.children);
  let low = 0, high = children.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const childTime = parseInt(children[mid].dataset.time) || 0;
    if (childTime < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  container.insertBefore(newEl, children[low] || null);
  container.scrollTop = container.scrollHeight;
}

document.getElementById('send-button').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });
});

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;
  
  let finalText = text;
  if (roomKey) {
    finalText = '[ENC]' + await encryptMessage(text, roomKey);
  }
  
  console.log('[Messenger] Sending message:', finalText.substring(0, 50));
  chrome.runtime.sendMessage({ type: 'SEND_MESSAGE', roomId, text: finalText });
  input.value = '';
  
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });
  }, 2000);
}

const scrollContainer = document.getElementById('messages-container');
let scrollTimeout;

scrollContainer.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isAtTop = scrollTop <= 5;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5;
    
    if (isAtTop || isAtBottom) {
      const direction = isAtTop ? 'top' : 'bottom';
      console.log(`[Messenger] Reached ${direction}, syncing tabs`);
      chrome.runtime.sendMessage({ 
        type: 'SCROLL_TABS', 
        roomId, 
        direction 
      });
    }
  }, 150);
});

// Крипто-функции (без изменений)
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMessage(text, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );
  const encryptedArr = new Uint8Array(encrypted);
  const encryptedBase64 = btoa(String.fromCharCode(...encryptedArr));
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const saltBase64 = btoa(String.fromCharCode(...salt));
  return `${encryptedBase64}:${ivBase64}:${saltBase64}`;
}

async function decryptMessage(encryptedDataString, password) {
  const [encryptedBase64, ivBase64, saltBase64] = encryptedDataString.split(':');
  const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}