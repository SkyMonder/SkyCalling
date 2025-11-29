import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const API = (import.meta.env.VITE_API_URL) || '/api';
const SIGNALING = (import.meta.env.VITE_SIGNALING_URL) || window.location.origin.replace(/^http/, 'ws');

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(token ? 'dashboard' : 'auth');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  useEffect(() => {
    if (token) {
      const s = io(import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000", {
        transports: ["websocket"]
      });
      socketRef.current = s;

      s.on('connect', () => s.emit('auth', token));
      s.on('auth-ok', ({ user }) => setUser(user));
      s.on('incoming-call', ({ from, fromSocketId, offer }) => setIncoming({ from, fromSocketId, offer }));
      s.on('call-accepted', async ({ answer }) => {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(answer);
          setInCall(true);
        }
      });
      s.on('call-rejected', () => alert('Call rejected'));
      s.on('ice-candidate', async ({ candidate }) => {
        if (candidate && pcRef.current) {
          try { await pcRef.current.addIceCandidate(candidate); } catch (e) { console.warn(e); }
        }
      });
      s.on('call-ended', () => endCallLocal());

      return () => s.disconnect();
    }
  }, [token]);

  async function register(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');
    const res = await fetch(API + '/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setPage('dashboard');
    } else {
      alert(data.error || 'Registration failed');
    }
  }

  async function login(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');
    const res = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setPage('dashboard');
    } else {
      alert(data.error || 'Login failed');
    }
  }

  async function searchUsers() {
    const res = await fetch(API + `/users?q=${encodeURIComponent(search)}`);
    const data = await res.json();
    setResults(data);
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', {
          toSocketId: incoming ? incoming.fromSocketId : null,
          candidate: e.candidate
        });
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      const remoteVid = document.getElementById('remoteVideo');
      if (remoteVid) remoteVid.srcObject = stream;
      remoteStreamRef.current = stream;
    };

    return pc;
  }

  // Новая функция включения камеры вручную
  async function enableCamera() {
    if (!localStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStreamRef.current = stream;
        const localVid = document.getElementById('localVideo');
        if (localVid) localVid.srcObject = stream;

        if (pcRef.current) {
          stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
        }
      } catch (e) {
        console.error('Ошибка при включении камеры:', e);
        alert('Не удалось включить камеру');
      }
    }
  }

  async function callUser(targetId) {
    const pc = createPeerConnection();
    pcRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('call-user', { toUserId: targetId, offer: pc.localDescription });
  }

  async function acceptCall() {
    const pc = createPeerConnection();
    pcRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    await pc.setRemoteDescription(incoming.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current.emit('accept-call', { toSocketId: incoming.fromSocketId, answer: pc.localDescription });

    setIncoming(null);
    setInCall(true);
  }

  function rejectCall() {
    if (incoming) socketRef.current.emit('reject-call', { toSocketId: incoming.fromSocketId });
    setIncoming(null);
  }

  function endCallLocal() {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = null;
    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;
    setInCall(false);
  }

  function endCallRemote() {
    if (incoming && socketRef.current) {
      socketRef.current.emit('end-call', { toSocketId: incoming.fromSocketId });
    }
    endCallLocal();
  }

  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
      setMuted(prev => !prev);
    }
  }

  function toggleVideo() {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !t.enabled);
      setVideoOff(prev => !prev);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setPage('auth');
  }

  return (
    <div className='app'>
      <header className='topbar'>
        <h1>SkyCall</h1>
        {token && <div><button onClick={logout} className='btn'>Logout</button></div>}
      </header>

      {page === 'auth' && (
        <div className='auth'>
          <div className='card'>
            <h2>Register</h2>
            <form onSubmit={register}>
              <input name='username' placeholder='username' required />
              <input name='password' placeholder='password' type='password' required />
              <button className='btn'>Register</button>
            </form>
          </div>
          <div className='card'>
            <h2>Login</h2>
            <form onSubmit={login}>
              <input name='username' placeholder='username' required />
              <input name='password' placeholder='password' type='password' required />
              <button className='btn'>Login</button>
            </form>
          </div>
        </div>
      )}

      {page === 'dashboard' && (
        <div className='dashboard'>
          <div className='left'>
            <h3>Search users</h3>
            <div className='searchRow'>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder='search by username' />
              <button className='btn' onClick={searchUsers}>Search</button>
            </div>
            <ul className='users'>
              {results.map(r => (
                <li key={r.id}>
                  <span>{r.username}</span>
                  <button className='btn small' onClick={() => callUser(r.id)}>Call</button>
                </li>
              ))}
            </ul>
            <button className='btn' onClick={enableCamera}>
              {localStreamRef.current ? 'Камера включена' : 'Включить камеру'}
            </button>
          </div>
          <div className='right'>
            <div className='videoGrid'>
              <video id='localVideo' autoPlay muted playsInline className='local' />
              <video id='remoteVideo' autoPlay playsInline className='remote' />
            </div>
            <div className='controls'>
              <button className='btn' onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
              <button className='btn' onClick={toggleVideo}>{videoOff ? 'Turn Video On' : 'Turn Video Off'}</button>
              <button className='btn' onClick={endCallLocal}>End Call</button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div className='incoming'>
          <div className='modal'>
            <h3>Incoming call from {incoming.from.username}</h3>
            <div className='modalControls'>
              <button className='btn' onClick={acceptCall}>Accept</button>
              <button className='btn' onClick={rejectCall}>Reject</button>
            </div>
          </div>
        </div>
      )}

      <footer className='footer'>
        <small>SkyCall — Demo WebRTC app</small>
      </footer>
    </div>
  );
}

export default App;
