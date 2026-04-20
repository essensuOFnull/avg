const activeRooms = new Map();

// Отслеживаем закрытие окон мессенджера
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [roomId, room] of activeRooms.entries()) {
    if (room.windowId === windowId) {
      console.log(`[Background] Messenger window closed for room ${roomId}, closing tabs`);
      chrome.tabs.remove([room.tgTabId, room.vkTabId]).catch(() => {});
      activeRooms.delete(roomId);
      break;
    }
  }
});

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
    // Вызываем асинхронную функцию, но сразу отвечаем, что запрос принят
    openUnifiedMessenger(message.room)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Background] Failed to open messenger:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // указывает, что sendResponse будет вызван асинхронно
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

  if (message.type === 'SCROLL_TABS') {
    const { roomId, direction } = message;
    const room = activeRooms.get(roomId);
    if (room) {
      scrollTabTo(room.tgTabId, direction);
      scrollTabTo(room.vkTabId, direction);
    }
  }
});

async function forceScanTab(tabId) {
  try {
    console.log('[Background] Force scanning tab', tabId);
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_NOW' }).catch(() => {});
  } catch (e) {
    console.error('[Background] Force scan error', e);
  }
}

async function scrollTabTo(tabId, direction) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (dir) => {
        if (dir === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (dir === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
        const container = document.querySelector('.messages-container') || document.body;
        if (dir === 'top') container.scrollTop = 0;
        else container.scrollTop = container.scrollHeight;
      },
      args: [direction]
    });
  } catch (e) {
    console.error('[Background] Scroll tab error', e);
  }
}

async function openUnifiedMessenger(room) {
  console.log('[Background] Opening messenger for room', room);
  
  try {
    if (!room.tgUrl || !room.vkUrl) {
      throw new Error('Missing Telegram or VK URL');
    }

    // Создаём вкладки (без muted)
    const tgTab = await chrome.tabs.create({ url: room.tgUrl, active: true });
    const vkTab = await chrome.tabs.create({ url: room.vkUrl, active: true });
    
    // Отключаем звук отдельным вызовом
    await chrome.tabs.update(tgTab.id, { muted: true });
    await chrome.tabs.update(vkTab.id, { muted: true });
    
    console.log('[Background] Created and muted tabs:', tgTab.id, vkTab.id);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const groupId = await chrome.tabs.group({ tabIds: [tgTab.id, vkTab.id] });
    await chrome.tabGroups.update(groupId, { collapsed: true, title: 'UniMessenger Background' });
    
    const roomId = Date.now().toString();
    
    const messengerWindow = await chrome.windows.create({
      url: `messenger.html?roomId=${roomId}`,
      type: 'popup',
      width: 900,
      height: 700
    });
    
    console.log('[Background] Messenger window created:', messengerWindow.id);
    
    activeRooms.set(roomId, {
      id: roomId,
      tgTabId: tgTab.id,
      vkTabId: vkTab.id,
      key: room.key,
      windowId: messengerWindow.id
    });
    
    console.log('[Background] Room registered:', roomId);
  } catch (error) {
    console.error('[Background] Error in openUnifiedMessenger:', error);
    throw error;
  }
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