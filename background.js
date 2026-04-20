const activeRooms = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received:', message.type, sender.tab?.id);
  
  if (message.type === 'NEW_MESSAGES') {
    const roomId = findRoomByTabId(sender.tab.id);
    console.log('[Background] Messages from tab', sender.tab.id, 'room', roomId);
    if (roomId) {
      chrome.runtime.sendMessage({
        type: 'MESSAGES_UPDATE',
        roomId,
        source: message.source,
        messages: message.messages
      }).catch(() => {});
    }
  }
  
  if (message.type === 'SEND_MESSAGE') {
    const { roomId, text } = message;
    console.log('[Background] Send message to room', roomId);
    const room = activeRooms.get(roomId);
    if (room) {
      sendMessageToTab(room.tgTabId, text);
      sendMessageToTab(room.vkTabId, text);
    }
  }
  
  if (message.type === 'GET_ROOMS') {
    chrome.storage.local.get('rooms', (data) => {
      sendResponse(data.rooms || []);
    });
    return true;
  }
  
  if (message.type === 'SAVE_ROOM') {
    chrome.storage.local.get('rooms', (data) => {
      const rooms = data.rooms || [];
      rooms.push(message.room);
      chrome.storage.local.set({ rooms }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  if (message.type === 'OPEN_MESSENGER') {
    openUnifiedMessenger(message.room);
  }
  
  if (message.type === 'GET_ROOM_INFO') {
    const { roomId } = message;
    const room = activeRooms.get(roomId);
    if (room) {
      sendResponse({ key: room.key });
    } else {
      sendResponse({ error: 'Room not found' });
    }
  }
  
  if (message.type === 'REQUEST_SCAN') {
    const { roomId } = message;
    const room = activeRooms.get(roomId);
    if (room) {
      forceScanTab(room.tgTabId);
      forceScanTab(room.vkTabId);
    }
  }
});

async function forceScanTab(tabId) {
  try {
    console.log('[Background] Force scanning tab', tabId);
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_NOW' }).catch(() => {});
  } catch (e) {
    console.error('[Background] Force scan error', e);
  }
}

async function openUnifiedMessenger(room) {
  console.log('[Background] Opening messenger for room', room);
  const tgTab = await chrome.tabs.create({ url: room.tgUrl, active: true });
  const vkTab = await chrome.tabs.create({ url: room.vkUrl, active: true });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const groupId = await chrome.tabs.group({ tabIds: [tgTab.id, vkTab.id] });
  await chrome.tabGroups.update(groupId, { collapsed: true, title: 'UniMessenger Background' });
  
  const roomId = Date.now().toString();
  activeRooms.set(roomId, {
    id: roomId,
    tgTabId: tgTab.id,
    vkTabId: vkTab.id,
    key: room.key
  });
  
  await chrome.windows.create({
    url: `messenger.html?roomId=${roomId}`,
    type: 'popup',
    width: 900,
    height: 700
  });
}

function findRoomByTabId(tabId) {
  for (const [roomId, room] of activeRooms.entries()) {
    if (room.tgTabId === tabId || room.vkTabId === tabId) {
      return roomId;
    }
  }
  return null;
}

async function sendMessageToTab(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msgText) => {
        console.log('[Content] Sending message:', msgText);
        const isTelegram = location.hostname.includes('web.telegram.org');
        if (isTelegram) {
          const input = document.querySelector('[contenteditable="true"]');
          if (input) {
            input.focus();
            document.execCommand('insertText', false, msgText);
            setTimeout(() => {
              const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true });
              input.dispatchEvent(event);
            }, 100);
          }
        } else {
          // VK: расширенный поиск поля ввода
          const input = document.querySelector('[contenteditable="true"][role="textbox"]') 
                     || document.querySelector('[contenteditable="true"]')
                     || document.querySelector('.im-chat-input--text')
                     || document.querySelector('#im_editable0');
          if (input) {
            input.focus();
            document.execCommand('insertText', false, msgText);
            setTimeout(() => {
              const sendBtn = document.querySelector('.im-send-btn') 
                           || document.querySelector('button[aria-label="Отправить"]')
                           || document.querySelector('.im-send-button')
                           || document.querySelector('button[type="submit"]');
              if (sendBtn) {
                sendBtn.click();
              } else {
                const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true });
                input.dispatchEvent(event);
              }
            }, 100);
          } else {
            console.error('[Content] VK input not found');
          }
        }
      },
      args: [text]
    });
  } catch (e) {
    console.error('[Background] Ошибка отправки сообщения:', e);
  }
}