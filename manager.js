document.addEventListener('DOMContentLoaded', loadRooms);
document.getElementById('add-room').addEventListener('click', () => {
  const tgUrl = document.getElementById('tg-url').value.trim();
  const vkUrl = document.getElementById('vk-url').value.trim();
  const key = document.getElementById('enc-key').value;
  if (!tgUrl || !vkUrl) return alert('Укажите обе ссылки');
  chrome.runtime.sendMessage({ type: 'SAVE_ROOM', room: { id: Date.now().toString(), tgUrl, vkUrl, key: key || null } }, resp => {
    if (resp.success) { loadRooms(); document.getElementById('tg-url').value = ''; document.getElementById('vk-url').value = ''; document.getElementById('enc-key').value = ''; }
  });
});
function loadRooms() {
  chrome.runtime.sendMessage({ type: 'GET_ROOMS' }, rooms => {
    const container = document.getElementById('rooms-list');
    container.innerHTML = '';
    if (!rooms || !rooms.length) { container.innerHTML = '<div style="padding:16px;text-align:center;color:#999;">Нет комнат</div>'; return; }
    rooms.forEach(room => {
      const div = document.createElement('div');
      div.className = 'room-item';
      div.innerHTML = `<div><strong>Telegram:</strong> ${extractChatName(room.tgUrl)}</div><div><strong>VK:</strong> ${extractChatName(room.vkUrl)}</div><div><strong>Шифрование:</strong> ${room.key ? '✅' : '❌'}</div><button class="open-messenger" data-room-id="${room.id}">Открыть мессенджер</button>`;
      container.appendChild(div);
    });
    document.querySelectorAll('.open-messenger').forEach(btn => btn.addEventListener('click', e => {
      const room = rooms.find(r => r.id === e.target.dataset.roomId);
      if (room) chrome.runtime.sendMessage({ type: 'OPEN_MESSENGER', room });
    }));
  });
}
function extractChatName(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('telegram')) return u.pathname.split('/').pop() || 'Чат';
    const sel = u.searchParams.get('sel');
    return sel ? `c${sel}` : 'Чат';
  } catch { return 'Чат'; }
}