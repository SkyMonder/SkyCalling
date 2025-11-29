import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL;
const SIGNALING = import.meta.env.VITE_SIGNALING_URL;

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

  // --- INIT SOCKET ---
  useEffect(() => {
    if (!token) return;

    const socket = io(SIGNALING, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('auth', token);
    });

    socket.on('auth-ok', ({ user }) => setUser(user));

    socket.on('incoming-call', ({ from, fromSocketId, offer }) => {
      setIncoming({ from, fromSocketId, offer });
    });

    socket.on('call-accepted', async ({ answer }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(answer);
        setInCall(true);
      }
    });

    socket.on('call-rejected', () => alert('Call rejected'));

    socket.on('ice-candidate', async ({ candidate }) => {
      if (candidate && pcRef.current) {
        await pcRef.current.addIceCandidate(candidate).catch(console.warn);
      }
    });

    socket.on('call-ended', () => endCallLocal());

    return () => socket.disconnect();
  }, [token]);

  // --- AUTH ---
  async function register(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');

    const res = await fetch(`${API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setPage('dashboard');
    } else alert(data.error || 'Registration failed');
  }

  async function login(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const username = form.get('username');
    const password = form.get('password');

    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setPage('dashboard');
    } else alert(data.error || 'Login failed');
  }

  // --- SEARCH USERS ---
  async function searchUsers() {
    const res = await fetch(`${API}/users?q=${encodeURIComponent(search)}`);
    const data = await res.json();
    setResults(data);
  }

  // --- CALL LOGIC ---
  function createPeerConnection() {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', {
          toSocketId: incoming?.fromSocketId || null,
          candidate: e.candidate
        });
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      const remoteVid = document.getElementById('remoteVideo');
      if (remoteVid) {
        remoteVid.srcObject = stream;
        remoteStreamRef.current = stream;
      }
    };

    return pc;
  }

  async function startLocalStream({ video = false } = {}) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    localStreamRef.current = s;
    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = s;
  }

  async function callUser(targetId) {
    await startLocalStream({ video: false });
    const pc = createPeerConnection();
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach((t) =>
      pc.addTrack(t, localStreamRef.current)
    );

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current.emit('call-user', {
      toUserId: targetId,
      offer: pc.localDescription
    });
  }

  async function acceptCall() {
    await startLocalStream({ video: false });
    const pc = createPeerConnection();
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach((t) =>
      pc.addTrack(t, localStreamRef.current)
    );

    await pc.setRemoteDescription(incoming.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current.emit('accept-call', {
      toSocketId: incoming.fromSocketId,
      answer: pc.localDescription
    });

    setIncoming(null);
    setInCall(true);
  }

  function rejectCall() {
    if (incoming) socketRef.current.emit('reject-call', { toSocketId: incoming.fromSocketId });
    setIncoming(null);
  }

  function endCallLocal() {
    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = null;

    const remoteVid = document.getElementById('remoteVideo');
    if (remoteVid) remoteVid.srcObject = null;

    setInCall(false);
    setMuted(false);
    setVideoOff(true);
  }

  function toggleMute() {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
      setMuted((prev) => !prev);
    }
  }

  async function toggleVideo() {
    if (!localStreamRef.current) {
      await startLocalStream({ video: true });
      setVideoOff(false);
      return;
    }
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setVideoOff((prev) => !prev);
  }

  function logout() {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    setPage('auth');
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>SkyCall</h1>
        {token && <button className="btn" onClick={logout}>Logout</button>}
      </header>

      {page === 'auth' && (
        <div className="auth">
          <form onSubmit={register}>
            <input name="username" placeholder="Username" required />
            <input name="password" placeholder="Password" type="password" required />
            <button className="btn">Register</button>
          </form>

          <form onSubmit={login}>
            <input name="username" placeholder="Username" required />
            <input name="password" placeholder="Password" type="password" required />
            <button className="btn">Login</button>
          </form>
        </div>
      )}

      {page === 'dashboard' && (
        <div className="dashboard">
          <div className="left">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users" />
            <button className="btn" onClick={searchUsers}>Search</button>
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  {r.username} <button className="btn small" onClick={() => callUser(r.id)}>Call</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="right">
            <video id="localVideo" autoPlay muted playsInline />
            <video id="remoteVideo" autoPlay playsInline />
            <div>
              <button className="btn" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
              <button className="btn" onClick={toggleVideo}>{videoOff ? 'Turn Video On' : 'Turn Video Off'}</button>
              <button className="btn" onClick={endCallLocal}>End Call</button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div className="incoming">
          <div>
            Incoming call from {incoming.from.username}
            <button onClick={acceptCall}>Accept</button>
            <button onClick={rejectCall}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
