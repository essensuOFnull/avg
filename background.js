const activeRooms = new Map();

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [roomId, room] of activeRooms.entries()) {
    if (room.windowId === windowId) {
      chrome.tabs.remove([room.tgTabId, room.vkTabId]).catch(() => {});
      activeRooms.delete(roomId);
      break;
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_STYLES_COLLECTION') {
    const room = activeRooms.get(message.roomId);
    if (room) {
      chrome.tabs.sendMessage(room.tgTabId, { type: 'COLLECT_STYLES' }).catch(() => {});
      chrome.tabs.sendMessage(room.vkTabId, { type: 'COLLECT_STYLES' }).catch(() => {});
    }
  }
  if (message.type === 'SAVE_STYLES') {
    const key = message.source === 'telegram' ? 'tg_raw_styles' : 'vk_raw_styles';
    chrome.storage.local.set({ [key]: message.css }, () => console.log(`Saved ${message.source} styles`));
    return;
  }
  if (message.type === 'NEW_MESSAGES') {
    const roomId = findRoomByTabId(sender.tab.id);
    if (roomId) chrome.runtime.sendMessage({ type: 'MESSAGES_UPDATE', roomId, source: message.source, messages: message.messages });
  }
  if (message.type === 'SEND_MESSAGE') {
    const room = activeRooms.get(message.roomId);
    if (room) {
      sendMessageToTab(room.tgTabId, message.text);
      sendMessageToTab(room.vkTabId, message.text);
    }
  }
  if (message.type === 'GET_ROOMS') {
    chrome.storage.local.get('rooms', data => sendResponse(data.rooms || []));
    return true;
  }
  if (message.type === 'SAVE_ROOM') {
    chrome.storage.local.get('rooms', data => {
      const rooms = data.rooms || [];
      rooms.push(message.room);
      chrome.storage.local.set({ rooms }, () => sendResponse({ success: true }));
    });
    return true;
  }
  if (message.type === 'OPEN_MESSENGER') {
    openUnifiedMessenger(message.room).then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === 'GET_ROOM_INFO') {
    const room = activeRooms.get(message.roomId);
    sendResponse(room ? { key: room.key } : { error: 'Room not found' });
  }
  if (message.type === 'REQUEST_SCAN') {
    const room = activeRooms.get(message.roomId);
    if (room) {
      chrome.tabs.sendMessage(room.tgTabId, { type: 'SCAN_NOW' }).catch(() => {});
      chrome.tabs.sendMessage(room.vkTabId, { type: 'SCAN_NOW' }).catch(() => {});
    }
  }
  if (message.type === 'SCROLL_TABS') {
    const room = activeRooms.get(message.roomId);
    if (room) {
      scrollTabTo(room.tgTabId, message.direction);
      scrollTabTo(room.vkTabId, message.direction);
    }
  }
});

async function openUnifiedMessenger(room) {
  const tgTab = await chrome.tabs.create({ url: room.tgUrl, active: true });
  const vkTab = await chrome.tabs.create({ url: room.vkUrl, active: true });
  await chrome.tabs.update(tgTab.id, { muted: true });
  await chrome.tabs.update(vkTab.id, { muted: true });
  await new Promise(r => setTimeout(r, 3000));
  await chrome.tabs.group({ tabIds: [tgTab.id, vkTab.id] });
  const roomId = Date.now().toString();
  const win = await chrome.windows.create({ url: `messenger.html?roomId=${roomId}`, type: 'popup', width: 900, height: 700 });
  activeRooms.set(roomId, { id: roomId, tgTabId: tgTab.id, vkTabId: vkTab.id, key: room.key, windowId: win.id });
}

function findRoomByTabId(tabId) {
  for (const [id, room] of activeRooms.entries())
    if (room.tgTabId === tabId || room.vkTabId === tabId) return id;
  return null;
}

async function sendMessageToTab(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => {
      const isTel = location.hostname.includes('web.telegram.org');
      const input = isTel ? document.querySelector('[contenteditable="true"]') : (document.querySelector('[contenteditable="true"][role="textbox"]') || document.querySelector('[contenteditable="true"]') || document.querySelector('.im-chat-input--text') || document.querySelector('#im_editable0'));
      if (!input) return;
      input.focus();
      document.execCommand('insertText', false, msg);
      setTimeout(() => {
        if (isTel) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        } else {
          const btn = document.querySelector('.im-send-btn, button[aria-label="Отправить"], .im-send-button, button[type="submit"]');
          btn ? btn.click() : input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
      }, 100);
    },
    args: [text]
  });
}

async function scrollTabTo(tabId, dir) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (direction) => {
      const container = document.querySelector('.messages-container') || document.body;
      if (direction === 'top') container.scrollTop = 0;
      else container.scrollTop = container.scrollHeight;
    },
    args: [dir]
  });
}