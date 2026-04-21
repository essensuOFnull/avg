let roomId = null, roomKey = null;
const messagesMap = new Map();
const urlParams = new URLSearchParams(window.location.search);
roomId = urlParams.get('roomId');
console.log('[Messenger] Started, roomId:', roomId);

function prefixSelector(selector, prefix) {
  let parts = [], current = '', depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map(part => {
    part = part.trim();
    if (part.startsWith('@')) return part;
    if (part === '') return '';
    if (part === ':root' || part === ':root ') return '#uni-messenger-root';
    return prefix + part;
  }).join(', ');
}

function transformCSS(css, className) {
  const prefix = `#uni-messenger-root .${className} `;
  let result = '', i = 0, n = css.length;
  const skipWS = () => { while (i < n && /\s/.test(css[i])) i++; };
  const parseBlock = () => { let block = '', depth = 1; i++; while (i < n && depth > 0) { const ch = css[i]; if (ch === '{') depth++; if (ch === '}') depth--; block += ch; i++; } return block.slice(0, -1); };
  const parseAtRule = () => { let at = '@'; i++; while (i < n && css[i] !== '{' && css[i] !== ';') at += css[i++]; if (css[i] === '{') { const block = parseBlock(); return `${at}{${transformCSS(block, className)}}`; } else { i++; return at + ';'; } };
  const parseRule = () => { let sel = ''; while (i < n && css[i] !== '{') sel += css[i++]; if (i >= n) return ''; i++; let block = '', depth = 1; while (i < n && depth > 0) { const ch = css[i]; if (ch === '{') depth++; if (ch === '}') depth--; if (depth > 0) block += ch; i++; } return `${prefixSelector(sel.trim(), prefix)}{${block}}`; };
  while (i < n) { skipWS(); if (i >= n) break; if (css[i] === '@') result += parseAtRule(); else result += parseRule(); }
  return result;
}

async function loadAndApplyStyles() {
  const tg = await chrome.storage.local.get('tg_raw_styles');
  const vk = await chrome.storage.local.get('vk_raw_styles');
  if (tg.tg_raw_styles) { const style = document.createElement('style'); style.textContent = transformCSS(tg.tg_raw_styles, 'tg-style'); document.head.appendChild(style); console.log('TG styles applied'); }
  if (vk.vk_raw_styles) { const style = document.createElement('style'); style.textContent = transformCSS(vk.vk_raw_styles, 'vk-style'); document.head.appendChild(style); console.log('VK styles applied'); }
}

function requestStylesCollection(retry = 0) {
  chrome.runtime.sendMessage({ type: 'REQUEST_STYLES_COLLECTION', roomId });
  setTimeout(() => {
    chrome.storage.local.get(['tg_raw_styles','vk_raw_styles'], res => {
      if ((!res.tg_raw_styles || !res.vk_raw_styles) && retry < 3) requestStylesCollection(retry+1);
    });
  }, 5000);
}

chrome.runtime.sendMessage({ type: 'GET_ROOM_INFO', roomId }, resp => {
  if (resp && resp.key) roomKey = resp.key;
  document.getElementById('room-info').textContent = `Комната ${roomId.slice(-4)} ${roomKey ? '🔐' : ''}`;
});

loadAndApplyStyles().then(() => chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId }));
setTimeout(() => {
  chrome.storage.local.get(['tg_raw_styles','vk_raw_styles'], res => { if (!res.tg_raw_styles || !res.vk_raw_styles) requestStylesCollection(); });
}, 2000);

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'MESSAGES_UPDATE' && msg.roomId === roomId) addMessages(msg.source, msg.messages);
});

async function addMessages(source, messages) {
  const container = document.getElementById('messages-container');
  for (const msg of messages) {
    if (messagesMap.has(msg.id)) continue;

    const encrypted = roomKey && msg.text.startsWith('[ENC]');
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${source === 'telegram' ? 'tg-style' : 'vk-style'}`;
    wrapper.dataset.id = msg.id;
    wrapper.dataset.time = msg.time;
    wrapper.dataset.numericId = msg.numericId;   // <-- сохраняем

    const header = document.createElement('div');
    header.className = 'message-header';
    const icon = document.createElement('img');
    icon.src = source === 'telegram' ? 'https://web.telegram.org/favicon.ico' : 'https://vk.com/favicon.ico';
    const label = document.createElement('span');
    label.className = 'source-label';
    label.textContent = source === 'telegram' ? 'Telegram' : 'VK';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = msg.time;
    const lock = document.createElement('span');
    lock.className = `lock-icon ${encrypted ? 'lock-closed' : 'lock-open'}`;
    lock.textContent = encrypted ? '🔒' : '🔓';
    header.append(icon, label, timeSpan, lock);
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = msg.elementHTML;
    wrapper.append(header, content);
    container.appendChild(wrapper);
    messagesMap.set(msg.id, wrapper);
    insertSorted(container, wrapper, msg.time, msg.numericId);   // <-- два параметра
  }
}

function insertSorted(container, el, time, numericId) {
  const children = Array.from(container.children);
  let lo = 0, hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midTime = parseInt(children[mid].dataset.time, 10) || 0;
    const midId = parseInt(children[mid].dataset.numericId, 10) || 0;

    if (midTime < time || (midTime === time && midId < numericId)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  container.insertBefore(el, children[lo] || null);
  container.scrollTop = container.scrollHeight;
}


document.getElementById('send-button').onclick = sendMessage;
document.getElementById('message-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
document.getElementById('refresh-btn').onclick = () => chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId });

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;
  let final = text;
  if (roomKey) final = '[ENC]' + await encryptMessage(text, roomKey);
  chrome.runtime.sendMessage({ type: 'SEND_MESSAGE', roomId, text: final });
  input.value = '';
  setTimeout(() => chrome.runtime.sendMessage({ type: 'REQUEST_SCAN', roomId }), 2000);
}

const scrollContainer = document.getElementById('messages-container');
let scrollTimeout;
scrollContainer.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const atTop = scrollTop <= 5;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 5;
    if (atTop || atBottom) chrome.runtime.sendMessage({ type: 'SCROLL_TABS', roomId, direction: atTop ? 'top' : 'bottom' });
  }, 150);
});

async function deriveKey(pwd, salt) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
async function encryptMessage(text, pwd) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pwd, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  const iv64 = btoa(String.fromCharCode(...iv));
  const salt64 = btoa(String.fromCharCode(...salt));
  return `${b64}:${iv64}:${salt64}`;
}