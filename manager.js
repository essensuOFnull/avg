// Управление комнатами
document.addEventListener('DOMContentLoaded', loadRooms);

document.getElementById('add-room').addEventListener('click', async () => {
  const tgUrl = document.getElementById('tg-url').value.trim();
  const vkUrl = document.getElementById('vk-url').value.trim();
  const key = document.getElementById('enc-key').value;
  
  if (!tgUrl || !vkUrl) {
    alert('Укажите обе ссылки');
    return;
  }
  
  const room = {
    id: Date.now().toString(),
    tgUrl,
    vkUrl,
    key: key || null
  };
  
  chrome.runtime.sendMessage({ type: 'SAVE_ROOM', room }, (response) => {
    if (response.success) {
      loadRooms();
      document.getElementById('tg-url').value = '';
      document.getElementById('vk-url').value = '';
      document.getElementById('enc-key').value = '';
    }
  });
});

function loadRooms() {
  chrome.runtime.sendMessage({ type: 'GET_ROOMS' }, (rooms) => {
    const container = document.getElementById('rooms-list');
    container.innerHTML = '';
    
    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">Нет комнат</div>';
      return;
    }
    
    rooms.forEach(room => {
      const div = document.createElement('div');
      div.className = 'room-item';
      div.innerHTML = `
        <div><strong>Telegram:</strong> ${extractChatName(room.tgUrl)}</div>
        <div><strong>VK:</strong> ${extractChatName(room.vkUrl)}</div>
        <div><strong>Шифрование:</strong> ${room.key ? '✅' : '❌'}</div>
        <button class="open-messenger" data-room-id="${room.id}">Открыть мессенджер</button>
      `;
      container.appendChild(div);
    });
    
    // Добавляем обработчики на кнопки "Открыть мессенджер"
    document.querySelectorAll('.open-messenger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.dataset.roomId;
        const room = rooms.find(r => r.id === roomId);
        if (room) {
          chrome.runtime.sendMessage({ type: 'OPEN_MESSENGER', room });
        }
      });
    });
  });
}

function extractChatName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('telegram')) {
      return parsed.pathname.split('/').pop() || 'Чат';
    } else {
      const sel = parsed.searchParams.get('sel');
      return sel ? `c${sel}` : 'Чат';
    }
  } catch {
    return 'Чат';
  }
}