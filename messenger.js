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

// Запрашиваем первоначальное сканирование
setTimeout(() => {
  console.log('[Messenger] Requesting initial scan');
  chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });
}, 2000);

// Регулярное сканирование (можно оставить как есть)
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

function addMessages(source, messages) {
  const container = document.getElementById('messages-container');
  
  messages.forEach(async (msg) => {
    if (messagesMap.has(msg.id)) return;
    
    let displayText = msg.text;
    let encrypted = false;
    if (roomKey && msg.text.startsWith('[ENC]')) {
      try {
        displayText = await decryptMessage(msg.text.substring(5), roomKey);
        encrypted = true;
      } catch (e) {
        displayText = '[Ошибка расшифровки]';
      }
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.dataset.id = msg.id;
    wrapper.dataset.time = msg.time;
    
    // Вставляем оригинальный HTML без санитизации
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-original-content';
    contentDiv.innerHTML = msg.elementHTML; // отключена защита
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const sourceIcon = document.createElement('img');
    sourceIcon.src = source === 'telegram' 
      ? 'https://web.telegram.org/favicon.ico' 
      : 'https://vk.com/favicon.ico';
    sourceIcon.alt = source;
    
    // Добавляем текстовую метку источника (по желанию)
    const sourceLabel = document.createElement('span');
    sourceLabel.className = 'source-label';
    sourceLabel.textContent = source === 'telegram' ? 'Telegram' : 'VK';
    sourceLabel.style.marginLeft = '6px';
    sourceLabel.style.fontSize = '12px';
    sourceLabel.style.color = '#8d9aa9';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const lockSpan = document.createElement('span');
    lockSpan.className = `lock-icon ${encrypted ? 'lock-closed' : 'lock-open'}`;
    lockSpan.textContent = encrypted ? '🔒' : '🔓';
    lockSpan.style.marginLeft = 'auto';
    
    header.appendChild(sourceIcon);
    header.appendChild(sourceLabel);
    header.appendChild(timeSpan);
    header.appendChild(lockSpan);
    
    wrapper.appendChild(header);
    wrapper.appendChild(contentDiv);
    
    messagesMap.set(msg.id, wrapper);
    insertSorted(container, wrapper, msg.time);
  });
}

// Оптимизированная вставка с сортировкой по времени
function insertSorted(container, newEl, time) {
  const children = Array.from(container.children);
  // Бинарный поиск для ускорения
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

// ========== СИНХРОНИЗАЦИЯ ПРОКРУТКИ ==========
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
// =========================================

// Crypto functions (без изменений)
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