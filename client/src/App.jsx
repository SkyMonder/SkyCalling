import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

/*
  Примечания по env:
  - VITE_API_URL должен быть http(s) (например: https://skycalling.onrender.com or https://example.com/api)
  - VITE_SIGNALING_URL должен быть ws(s) (например: wss://skycalling.onrender.com:10000) либо оставляем пустым и клиент
    сам использует window.location -> ws/wss
*/

// Нормализуем API (если кто-то случайно поставил ws:// -> заменим на http://)
const rawApi = import.meta.env.VITE_API_URL;
const API = rawApi
  ? rawApi.replace(/^wss?:/, (m) => (m === 'ws:' ? 'http:' : 'https:'))
  : '/api';

// Нормализуем SIGNALING (если дали http(s) -> заменим на ws(s))
const rawSignaling = import.meta.env.VITE_SIGNALING_URL;
const SIGNALING = rawSignaling
  ? rawSignaling.replace(/^https?:/, (m) => (m === 'http:' ? 'ws:' : 'wss:'))
  : window.location.origin.replace(/^http/, 'ws');

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(token ? 'dashboard' : 'auth');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(true); // true — видео выключено по-умолчанию

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);   // объект MediaStream содержащий текущие локальные дорожки
  const remoteStreamRef = useRef(null);
  const currentPeerInfoRef = useRef({ userId: null, socketId: null }); // target info

  useEffect(() => {
    if (!token) return;

    const s = io(SIGNALING, { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => {
      console.log('socket connected', s.id);
      s.emit('auth', token);
    });

    s.on('auth-ok', ({ user, socketId }) => {
      console.log('auth-ok', user);
      setUser(user);
    });

    // incoming call from server (callee receives this)
    s.on('incoming-call', ({ from, fromSocketId, offer }) => {
      console.log('incoming-call', from, fromSocketId);
      setIncoming({ from, fromSocketId, offer });
      // store peer socket id for later use (accept/reject)
      currentPeerInfoRef.current = { userId: from?.id || null, socketId: fromSocketId || null };
    });

    // callee accepted our outgoing call -> we receive answer
    s.on('call-accepted', async ({ answer, fromSocketId }) => {
      console.log('call accepted', { fromSocketId });
      // store peer socket id
      if (fromSocketId) currentPeerInfoRef.current.socketId = fromSocketId;
      if (pcRef.current && answer) {
        try {
          await pcRef.current.setRemoteDescription(answer);
          setInCall(true);
        } catch (e) {
          console.warn('setRemoteDescription error', e);
        }
      }
    });

    s.on('call-rejected', () => {
      console.log('call rejected');
      alert('Call rejected');
      cleanupLocal();
    });

    s.on('ice-candidate', async ({ candidate }) => {
      if (candidate && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (e) {
          console.warn('addIceCandidate failed', e);
        }
      }
    });

    s.on('call-ended', () => {
      console.log('call-ended');
      cleanupLocal();
    });

    // renegotiation: remote requested to add tracks (e.g. enabled camera)
    s.on('renegotiate-offer', async ({ fromSocketId, offer }) => {
      console.log('renegotiate-offer', fromSocketId);
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(offer);
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        s.emit('renegotiate-answer', { toSocketId: fromSocketId, answer: pcRef.current.localDescription });
      } catch (e) {
        console.error('renegotiate-offer handling failed', e);
      }
    });

    s.on('renegotiate-answer', async ({ answer }) => {
      console.log('renegotiate-answer');
      if (pcRef.current && answer) {
        try {
          await pcRef.current.setRemoteDescription(answer);
        } catch (e) {
          console.warn('setRemoteDescription (renegotiate-answer) failed', e);
        }
      }
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  // --- helpers для WebRTC ---
  function createPeerConnection() {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const toSocketId =
          currentPeerInfoRef.current.socketId || (incoming && incoming.fromSocketId) || null;
        if (toSocketId && socketRef.current) {
          socketRef.current.emit('ice-candidate', { toSocketId, candidate: e.candidate });
        }
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      console.log('ontrack got stream', stream);
      remoteStreamRef.current = stream;
      const remoteVid = document.getElementById('remoteVideo');
      if (remoteVid) remoteVid.srcObject = stream;
    };

    pc.onconnectionstatechange = () => {
      console.log('pc connectionState', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupLocal();
      }
    };

    return pc;
  }

  async function ensureLocalStream({ audio = true, video = false } = {}) {
    // если stream уже есть и содержит нужные дорожки — возвращаем
    if (localStreamRef.current) {
      const hasAudio = localStreamRef.current.getAudioTracks().length > 0;
      const hasVideo = localStreamRef.current.getVideoTracks().length > 0;
      if ((audio ? hasAudio : true) && (video ? hasVideo : true)) {
        return localStreamRef.current;
      }
    }

    // запросим только те треки, которых не хватает
    const constraints = {};
    if (audio) constraints.audio = true;
    if (video) constraints.video = true;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      // если был старый stream — объединим дорожки
      if (localStreamRef.current) {
        // добавляем недостающие дорожки в существующий stream
        newStream.getTracks().forEach((t) => localStreamRef.current.addTrack(t));
      } else {
        localStreamRef.current = new MediaStream();
        newStream.getTracks().forEach((t) => localStreamRef.current.addTrack(t));
      }

      // покажем локальное видео (если есть)
      const localVid = document.getElementById('localVideo');
      if (localVid) localVid.srcObject = localStreamRef.current;

      return localStreamRef.current;
    } catch (e) {
      console.error('getUserMedia failed', e);
      throw e;
    }
  }

  // вызывается при старте исходящего звонка: включаем только микрофон (по ТЗ)
  async function callUser(targetUserId) {
    try {
      await ensureLocalStream({ audio: true, video: false }); // mic only
    } catch (e) {
      alert('Не удалось получить доступ к микрофону: ' + (e.message || e));
      return;
    }

    const pc = createPeerConnection();
    pcRef.current = pc;

    // добавляем аудио дорожки в RTCPeerConnection
    localStreamRef.current.getAudioTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));

    // create offer and send to server (server должен перекинуть конкретному пользователю)
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socketRef.current) {
        socketRef.current.emit('call-user', { toUserId: targetUserId, offer: pc.localDescription });
        // запомним userId (socket id присвоится когда придет call-accepted или incoming info)
        currentPeerInfoRef.current.userId = targetUserId;
      } else {
        console.error('socket not connected');
      }
    } catch (e) {
      console.error('createOffer failed', e);
    }
  }

  // принять вызов — включаем только микрофон, устанавливаем remote offer и отправляем answer
  async function acceptCall() {
    if (!incoming) return;
    try {
      await ensureLocalStream({ audio: true, video: false }); // mic only
    } catch (e) {
      alert('Не удалось получить доступ к микрофону: ' + (e.message || e));
      return;
    }

    const pc = createPeerConnection();
    pcRef.current = pc;

    // добавляем текущие локальные (аудио) треки
    localStreamRef.current.getAudioTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));

    try {
      await pc.setRemoteDescription(incoming.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('accept-call', { toSocketId: incoming.fromSocketId, answer: pc.localDescription });
      setIncoming(null);
      setInCall(true);
      // сохраняем собеседника
      currentPeerInfoRef.current = { userId: incoming.from?.id || null, socketId: incoming.fromSocketId };
    } catch (e) {
      console.error('acceptCall failed', e);
      alert('Ошибка при принятии звонка');
    }
  }

  function rejectCall() {
    if (incoming && socketRef.current) {
      socketRef.current.emit('reject-call', { toSocketId: incoming.fromSocketId });
    }
    setIncoming(null);
  }

  function cleanupLocal() {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch (e) { /* ignore */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) { /* ignore */ }
      });
      localStreamRef.current = null;
    }
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = null;
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;
    setInCall(false);
    setVideoOff(true);
    setMuted(false);
    currentPeerInfoRef.current = { userId: null, socketId: null };
  }

  function endCallLocal() {
    // уведомить собеседника
    const toSocketId = currentPeerInfoRef.current.socketId;
    if (toSocketId && socketRef.current) {
      socketRef.current.emit('end-call', { toSocketId });
    }
    cleanupLocal();
  }

  // переключает mute (микрофон)
  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
      setMuted((p) => !p);
    }
  }

  // переключение видео: если включаем — получаем video track, добавляем в pc и делаем ренеготиацию
  async function toggleVideo() {
    if (videoOff) {
      // включаем видео
      try {
        // получим видеодорожку (и добавим в локальный stream)
        await ensureLocalStream({ audio: true, video: true });

        // если есть RTCPeerConnection — добавим видеотрек и инициируем renegotiate
        const pc = pcRef.current;
        if (pc) {
          const newVideoTrack = localStreamRef.current.getVideoTracks()[0];
          if (newVideoTrack) {
            pc.addTrack(newVideoTrack, localStreamRef.current);
            // создаём offer для ренеготиации
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const toSocketId = currentPeerInfoRef.current.socketId || (incoming && incoming.fromSocketId) || null;
            if (toSocketId && socketRef.current) {
              socketRef.current.emit('renegotiate-offer', { toSocketId, offer: pc.localDescription });
            }
          }
        }

        setVideoOff(false);
      } catch (e) {
        console.error('toggleVideo on failed', e);
        alert('Не удалось включить камеру: ' + (e.message || e));
      }
    } else {
      // выключаем видео: удаляем video tracks из локального stream и сообщаем
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          try { t.stop(); } catch (e) { /* ignore */ }
          localStreamRef.current.removeTrack(t);
        });
        const pc = pcRef.current;
        // NOTE: removeTrack требуется иметь RTCRtpSender; мы упрощаем: закрываем/пересоздаём ПК — проще и надёжнее
        if (pc) {
          // инициируем renegotiate without video by creating offer after removing local track
          try {
            const senders = pc.getSenders();
            senders.forEach((s) => {
              if (s.track && s.track.kind === 'video') {
                try { pc.removeTrack(s); } catch (e) { /* ignore */ }
              }
            });
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const toSocketId = currentPeerInfoRef.current.socketId || (incoming && incoming.fromSocketId) || null;
            if (toSocketId && socketRef.current) {
              socketRef.current.emit('renegotiate-offer', { toSocketId, offer: pc.localDescription });
            }
          } catch (e) {
            console.warn('renegotiate after video stop failed', e);
          }
        }
      }
      setVideoOff(true);
      // обновим отображение локального видео
      const localVid = document.getElementById('localVideo');
      if (localVid) localVid.srcObject = localStreamRef.current || null;
    }
  }

  // --- auth / api methods ---
  async function register(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');
    try {
      const res = await fetch(API + '/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setPage('dashboard');
      } else {
        alert(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error('register error', err);
      alert('Ошибка сети при регистрации');
    }
  }

  async function login(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');
    try {
      const res = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setPage('dashboard');
      } else {
        alert(data.error || 'Login failed');
      }
    } catch (err) {
      console.error('login error', err);
      alert('Ошибка сети при входе');
    }
  }

  async function searchUsers() {
    try {
      const res = await fetch(API + `/users?q=${encodeURIComponent(search)}`);
      if (!res.ok) {
        console.warn('search users failed', res.status);
        const txt = await res.text();
        console.warn('response text', txt);
        alert('Поиск вернул ошибку');
        return;
      }
      const data = await res.json();
      setResults(data || []);
    } catch (err) {
      console.error('search error', err);
      alert('Ошибка сети при поиске');
    }
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setPage('auth');
    cleanupLocal();
  }

  // --- UI ---
  return (
    <div className="app" style={{ fontFamily: 'system-ui, Arial, sans-serif', padding: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>SkyCall</h1>
        {token && <button onClick={logout}>Logout</button>}
      </header>

      {page === 'auth' && (
        <div style={{ display: 'flex', gap: 20 }}>
          <form onSubmit={register} style={{ border: '1px solid #ddd', padding: 12 }}>
            <h3>Register</h3>
            <input name="username" placeholder="username" required />
            <br />
            <input name="password" placeholder="password" type="password" required />
            <br />
            <button>Register</button>
          </form>

          <form onSubmit={login} style={{ border: '1px solid #ddd', padding: 12 }}>
            <h3>Login</h3>
            <input name="username" placeholder="username" required />
            <br />
            <input name="password" placeholder="password" type="password" required />
            <br />
            <button>Login</button>
          </form>
        </div>
      )}

      {page === 'dashboard' && (
        <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
          <div style={{ width: 260 }}>
            <h3>Search users</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search by username" />
            <button onClick={searchUsers}>Search</button>
            <ul>
              {results.map((r) => (
                <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{r.username}</span>
                  <button onClick={() => callUser(r.id)}>Call</button>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <video id="localVideo" autoPlay muted playsInline style={{ width: 200, background: '#000' }} />
              <video id="remoteVideo" autoPlay playsInline style={{ flex: 1, background: '#000' }} />
            </div>

            <div style={{ marginTop: 8 }}>
              <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
              <button onClick={toggleVideo}>{videoOff ? 'Turn Camera On' : 'Turn Camera Off'}</button>
              <button onClick={endCallLocal}>End Call</button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div style={{ position: 'fixed', right: 12, bottom: 12, background: '#fff', border: '1px solid #ccc', padding: 12 }}>
          <div>Incoming call from {incoming.from?.username}</div>
          <div style={{ marginTop: 8 }}>
            <button onClick={acceptCall}>Accept</button>
            <button onClick={rejectCall}>Reject</button>
          </div>
        </div>
      )}

      <footer style={{ marginTop: 20 }}>
        <small>SkyCall — Demo WebRTC app</small>
      </footer>
    </div>
  );
}
