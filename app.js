const API_BASE = 'https://nextalk-production.up.railway.app';
const SOCKET_URL = API_BASE;

let token = localStorage.getItem('nextalk_token');
let me = localStorage.getItem('nextalk_user');
let socket = null;
let currentChat = null;
let peer = null;
let localStream = null;
let mediaRecorder = null;
let recChunks = [];
let recInterval = null;
let recSeconds = 0;

const $ = (id) => document.getElementById(id);

function initials(name) {
  return (name || '?').slice(0, 1).toUpperCase();
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

$('btn-login').onclick = async () => {
  $('auth-error').textContent = '';
  try {
    const d = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('auth-user').value.trim(), password: $('auth-pass').value })
    });
    startSession(d);
  } catch (e) { $('auth-error').textContent = e.message; }
};

$('btn-register').onclick = async () => {
  $('auth-error').textContent = '';
  try {
    const d = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: $('auth-user').value.trim(), password: $('auth-pass').value })
    });
    startSession(d);
  } catch (e) { $('auth-error').textContent = e.message; }
};

$('auth-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('btn-login').click();
});

function startSession(d) {
  token = d.token; me = d.username;
  localStorage.setItem('nextalk_token', token);
  localStorage.setItem('nextalk_user', me);
  enterApp();
}

function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('me-name').textContent = me;
  $('me-avatar').textContent = initials(me);
  connectSocket();
}

$('btn-logout').onclick = () => {
  if (socket) socket.disconnect();
  localStorage.clear();
  location.reload();
};

function connectSocket() {
  socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
  });
  socket.on('presence', (users) => renderOnline(users.filter(u => u !== me)));

  socket.on('message', (msg) => {
    if (currentChat && (msg.sender === currentChat || msg.receiver === currentChat)) {
      renderMessage(msg);
    }
  });

  socket.on('call-offer', async ({ from, offer }) => {
    if (!confirm(`Panggilan masuk dari ${from}. Terima?`)) {
      socket.emit('call-end', { to: from });
      return;
    }
    await openChat(from);
    await setupPeer(from);
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('call-answer', { to: from, answer });
  });

  socket.on('call-answer', async ({ answer }) => { await peer.setRemoteDescription(answer); });
  socket.on('ice-candidate', async ({ candidate }) => {
    if (peer && candidate) { try { await peer.addIceCandidate(candidate); } catch {} }
  });
  socket.on('call-end', () => endCall());
}

function renderOnline(users) {
  const el = $('online-list');
  el.innerHTML = '';
  if (!users.length) {
    el.innerHTML = '<div class="empty-note">Tidak ada kontak online</div>';
    return;
  }
  users.forEach(u => el.appendChild(contactRow(u, true)));
}

function contactRow(username, online) {
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `
    <div class="avatar">${initials(username)}</div>
    <span>${username}</span>
    ${online ? '<span class="status-dot"></span>' : ''}
  `;
  row.onclick = () => openChat(username);
  return row;
}

let searchTimer;
$('search-input').oninput = (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const el = $('search-results');
  if (!q) { el.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
    const users = await res.json();
    el.innerHTML = '';
    const filtered = users.filter(u => u.username !== me);
    if (!filtered.length) { el.innerHTML = '<div class="empty-note">Tidak ditemukan</div>'; return; }
    filtered.forEach(u => el.appendChild(contactRow(u.username, false)));
  }, 220);
};

async function openChat(username) {
  currentChat = username;
  $('chat-empty').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  $('chat-with').textContent = username;
  $('chat-avatar').textContent = initials(username);
  $('chat-status').textContent = 'Online';
  $('messages').innerHTML = '';

  const hist = await (await fetch(`${API_BASE}/api/history/${me}/${username}`)).json();
  hist.forEach(renderMessage);
  $('msg-input').focus();
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg ' + (msg.sender === me ? 'me' : 'them');

  if (msg.type === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = msg.content;
    div.appendChild(audio);
  } else {
    div.textContent = msg.content;
  }

  const t = document.createElement('span');
  t.className = 'time';
  const d = new Date(msg.created_at || Date.now());
  t.textContent = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  div.appendChild(t);

  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function sendText() {
  const text = $('msg-input').value.trim();
  if (!text || !currentChat) return;
  socket.emit('message', { to: currentChat, type: 'text', content: text });
  $('msg-input').value = '';
}

$('btn-send').onclick = sendText;
$('msg-input').onkeydown = (e) => { if (e.key === 'Enter') sendText(); };

$('btn-record').onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
  if (!currentChat) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    recChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recChunks, { type: mime });
      const reader = new FileReader();
      reader.onload = () => socket.emit('message', { to: currentChat, type: 'audio', content: reader.result });
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recInterval);
      $('rec-status').classList.add('hidden');
    };
    mediaRecorder.start();
    recSeconds = 0;
    $('rec-status').classList.remove('hidden');
    $('rec-time').textContent = '0s';
    recInterval = setInterval(() => {
      recSeconds++;
      $('rec-time').textContent = recSeconds + 's';
      if (recSeconds >= 120) mediaRecorder.stop();
    }, 1000);
  } catch { alert('Mikrofon tidak diizinkan.'); }
};

async function setupPeer(remoteUser) {
  const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  peer = new RTCPeerConnection(cfg);
  peer.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { to: remoteUser, candidate: e.candidate });
  };
  peer.ontrack = (e) => { $('remote-audio').srcObject = e.streams[0]; };
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
  $('btn-voice-call').classList.add('hidden');
  $('btn-end-call').classList.remove('hidden');
  $('chat-status').textContent = 'Dalam panggilan';
}

$('btn-voice-call').onclick = async () => {
  if (!currentChat) return;
  await setupPeer(currentChat);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('call-offer', { to: currentChat, offer });
};

function endCall() {
  if (peer) { peer.close(); peer = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $('remote-audio').srcObject = null;
  $('btn-voice-call').classList.remove('hidden');
  $('btn-end-call').classList.add('hidden');
  if (currentChat) $('chat-status').textContent = 'Online';
}

$('btn-end-call').onclick = () => {
  if (currentChat) socket.emit('call-end', { to: currentChat });
  endCall();
};

if (token && me) enterApp();