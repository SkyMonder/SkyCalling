import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || '/api';
const SIGNALING = import.meta.env.VITE_WS_URL || window.location.origin;

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(token ? 'dashboard' : 'auth');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [incoming, setIncoming] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(true);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  useEffect(() => {
    if (token) {
      const socket = io(SIGNALING, { transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('auth', token));
      socket.on('auth-ok', ({ user }) => setUser(user));

      socket.on('incoming-call', ({ from, fromSocketId, offer }) => {
        setIncoming({ from, fromSocketId, offer });
      });

      socket.on('call-accepted', async ({ answer }) => {
        if (pcRef.current) await pcRef.current.setRemoteDescription(answer);
        setInCall(true);
      });

      socket.on('call-rejected', () => alert('Call rejected'));

      socket.on('ice-candidate', async ({ candidate }) => {
        if (candidate && pcRef.current) {
          try { await pcRef.current.addIceCandidate(candidate); } catch(e) { console.warn(e); }
        }
      });

      socket.on('call-ended', () => endCallLocal());

      return () => socket.disconnect();
    }
  }, [token]);

  async function register(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');
    const res = await fetch(API + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

  async function startLocalStream(video = false) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    localStreamRef.current = s;
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = s;
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection();
    pc.onicecandidate = e => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', { 
          toSocketId: incoming ? incoming.fromSocketId : null, 
          candidate: e.candidate 
        });
      }
    };
    pc.ontrack = e => {
      const [stream] = e.streams;
      const remoteVid = document.getElementById('remoteVideo');
      if (remoteVid) {
        remoteVid.srcObject = stream;
        remoteStreamRef.current = stream;
      }
    };
    return pc;
  }

  async function callUser(targetId) {
    await startLocalStream(false); // микрофон включен, камера выключена
    const pc = createPeerConnection();
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('call-user', { toUserId: targetId, offer: pc.localDescription });
  }

  async function acceptCall() {
    await startLocalStream(false);
    const pc = createPeerConnection();
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
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
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
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

  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
      setMuted(prev => !prev);
    }
  }

  async function toggleVideo() {
    if (videoOff) {
      await startLocalStream(true); // включаем камеру
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !muted);
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = true);
    } else if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = false);
    }
    setVideoOff(prev => !prev);
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
        {token && <button onClick={logout} className='btn'>Logout</button>}
      </header>

      {page === 'auth' && (
        <div className='auth'>
          <div className='card'>
            <h2>Register</h2>
            <form onSubmit={register}>
              <input name='username' placeholder='username' required />
              <input name='password' type='password' placeholder='password' required />
              <button className='btn'>Register</button>
            </form>
          </div>
          <div className='card'>
            <h2>Login</h2>
            <form onSubmit={login}>
              <input name='username' placeholder='username' required />
              <input name='password' type='password' placeholder='password' required />
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
            <h3>Incoming call from {incoming.from}</h3>
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
