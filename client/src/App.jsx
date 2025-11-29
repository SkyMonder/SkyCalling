import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

/**
 * Конфигурация:
 * В production задавай в .env:
 * VITE_API_URL=https://skycalling.onrender.com/api
 * VITE_SIGNALING_URL=https://skycalling.onrender.com
 *
 * По-умолчанию API будет: https://{origin}/api
 * SIGNALING по-умолчанию: origin (тот же домен), socket.io path /socket.io
 */
const API_BASE = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.host}/api`
const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || window.location.origin

function safeJson(res) {
  const ct = res.headers.get('content-type') || ''
  if (!res.ok) {
    // Попытка прочитать текст (полезно для отладки)
    return res.text().then((t) => {
      throw new Error(`HTTP ${res.status}: ${t}`)
    })
  }
  if (ct.includes('application/json')) return res.json()
  // если сервер прислал HTML (например index.html) — бросаем понятную ошибку
  return res.text().then((t) => {
    throw new Error('Expected JSON, got HTML/text: ' + (t.slice(0, 300)))
  })
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(token ? 'dashboard' : 'auth')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [incoming, setIncoming] = useState(null)
  const [inCall, setInCall] = useState(false)
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)

  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const currentPeerSocketRef = useRef(null) // socket id of remote peer in current call

  // подключаем socket когда есть токен
  useEffect(() => {
    if (!token) return
    const s = io(SIGNALING_URL, { path: '/socket.io', transports: ['websocket'] })
    socketRef.current = s

    s.on('connect', () => {
      s.emit('auth', token)
    })
    s.on('auth-ok', ({ user }) => setUser(user))
    s.on('incoming-call', ({ from, fromSocketId, offer }) => {
      setIncoming({ from, fromSocketId, offer })
    })
    s.on('call-accepted', async ({ answer, fromSocketId }) => {
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(answer)
          setInCall(true)
          currentPeerSocketRef.current = fromSocketId
        } catch (e) {
          console.error('setRemoteDescription error', e)
        }
      }
    })
    s.on('call-rejected', () => alert('Call rejected'))
    s.on('ice-candidate', async ({ candidate }) => {
      try {
        if (pcRef.current && candidate) await pcRef.current.addIceCandidate(candidate)
      } catch (e) {
        console.warn('addIceCandidate failed', e)
      }
    })
    s.on('call-ended', () => {
      cleanupCall()
    })

    // server may forward renegotiation offers/answers under custom events:
    s.on('renegotiate-offer', async ({ offer, fromSocketId }) => {
      // если мы уже в call и получаем reneg offer -> setRemote + createAnswer
      if (!pcRef.current) return
      await pcRef.current.setRemoteDescription(offer)
      const answer = await pcRef.current.createAnswer()
      await pcRef.current.setLocalDescription(answer)
      s.emit('renegotiate-answer', { toSocketId: fromSocketId, answer: pcRef.current.localDescription })
    })
    s.on('renegotiate-answer', async ({ answer }) => {
      if (!pcRef.current) return
      await pcRef.current.setRemoteDescription(answer)
    })

    return () => {
      try { s.disconnect() } catch(e){}
      socketRef.current = null
    }
  }, [token])

  // ========== helpers: peer connection and streams ==========
  function createPeerConnection() {
    const pc = new RTCPeerConnection()

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { toSocketId: currentPeerSocketRef.current, candidate: e.candidate })
      }
    }

    pc.ontrack = (e) => {
      const [stream] = e.streams
      remoteStreamRef.current = stream
      const remoteVid = document.getElementById('remoteVideo')
      if (remoteVid) remoteVid.srcObject = stream
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupCall()
      }
    }
    return pc
  }

  async function startLocalAudioOnly() {
    // Стартуем только с микрофоном (камера выключена)
    if (localStreamRef.current) return localStreamRef.current
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = s
      const localVid = document.getElementById('localVideo')
      if (localVid) {
        localVid.srcObject = s
        localVid.muted = true
      }
      return s
    } catch (e) {
      console.error('getUserMedia audio failed', e)
      throw e
    }
  }

  async function enableVideoDuringCall() {
    // Включаем камеру во время звонка — делаем renegotiation
    try {
      const vStream = await navigator.mediaDevices.getUserMedia({ video: true })
      // добавляем видеодорожки в localStreamRef и в PeerConnection
      if (!localStreamRef.current) localStreamRef.current = new MediaStream()
      vStream.getVideoTracks().forEach((t) => {
        localStreamRef.current.addTrack(t)
        if (pcRef.current) {
          try {
            pcRef.current.addTrack(t, localStreamRef.current)
          } catch (e) {
            console.warn('addTrack failed (may require renegotiation) ', e)
          }
        }
      })
      const localVid = document.getElementById('localVideo')
      if (localVid) localVid.srcObject = localStreamRef.current
      setVideoEnabled(true)

      // start renegotiation: createOffer, setLocalDescription, send to peer
      if (pcRef.current && socketRef.current && currentPeerSocketRef.current) {
        const offer = await pcRef.current.createOffer()
        await pcRef.current.setLocalDescription(offer)
        socketRef.current.emit('renegotiate-offer', { toSocketId: currentPeerSocketRef.current, offer: pcRef.current.localDescription })
      }
    } catch (e) {
      console.error('enableVideoDuringCall failed', e)
    }
  }

  function toggleMute() {
    if (!localStreamRef.current) return
    localStreamRef.current.getAudioTracks().forEach(t => (t.enabled = !t.enabled))
    setMuted((p) => !p)
  }

  function toggleVideo() {
    if (!videoEnabled) {
      enableVideoDuringCall()
    } else {
      // выключаем локально (остановим дорожки)
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.stop(); localStreamRef.current.removeTrack(t) })
        const localVid = document.getElementById('localVideo')
        if (localVid) localVid.srcObject = localStreamRef.current
      }
      setVideoEnabled(false)
      // note: желательно уведомить remote о renegotiation; пропущено простотой
    }
  }

  function cleanupCall() {
    if (pcRef.current) {
      try { pcRef.current.close() } catch(e) {}
      pcRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(t => t.stop())
      remoteStreamRef.current = null
    }
    const localVid = document.getElementById('localVideo'); if (localVid) localVid.srcObject = null
    const remoteVid = document.getElementById('remoteVideo'); if (remoteVid) remoteVid.srcObject = null
    setIncoming(null); setInCall(false); setVideoEnabled(false); currentPeerSocketRef.current = null
  }

  // ========== actions: register/login/search/call ==========
  async function register(e) {
    e.preventDefault()
    const form = new FormData(e.target)
    const body = { username: form.get('username'), password: form.get('password') }
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await safeJson(res)
      if (data.token) {
        localStorage.setItem('token', data.token)
        setToken(data.token)
        setPage('dashboard')
      } else {
        alert(data.error || 'Registration failed')
      }
    } catch (err) {
      alert('Register error: ' + err.message)
    }
  }

  async function login(e) {
    e.preventDefault()
    const form = new FormData(e.target)
    const body = { username: form.get('username'), password: form.get('password') }
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await safeJson(res)
      if (data.token) {
        localStorage.setItem('token', data.token)
        setToken(data.token)
        setPage('dashboard')
      } else {
        alert(data.error || 'Login failed')
      }
    } catch (err) {
      alert('Login error: ' + err.message)
    }
  }

  async function logout() {
    localStorage.removeItem('token')
    setToken('')
    setUser(null)
    setPage('auth')
  }

  async function searchUsers() {
    try {
      // убедимся, что API_BASE корректен и не содержит ws:// и т.п.
      const url = `${API_BASE.replace(/\/$/, '')}/users?q=${encodeURIComponent(search)}`
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      const data = await safeJson(res)
      setResults(data || [])
    } catch (err) {
      alert('Search error: ' + err.message)
    }
  }

  async function callUser(targetId) {
    try {
      await startLocalAudioOnly()
      const pc = createPeerConnection()
      pcRef.current = pc

      // добавляем локальные аудио дорожки в RTCPeerConnection
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current))

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      // уведомляем signaling
      if (socketRef.current) {
        socketRef.current.emit('call-user', { toUserId: targetId, offer: pc.localDescription })
      }
    } catch (e) {
      console.error('callUser failed', e)
      alert('Call failed: ' + (e.message || e))
    }
  }

  async function acceptCall() {
    if (!incoming) return
    try {
      await startLocalAudioOnly()
      const pc = createPeerConnection()
      pcRef.current = pc

      // attach local audio tracks
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current))

      // set remote (offer) from incoming
      await pc.setRemoteDescription(incoming.offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      // send answer back
      if (socketRef.current) {
        socketRef.current.emit('accept-call', { toSocketId: incoming.fromSocketId, answer: pc.localDescription })
      }
      currentPeerSocketRef.current = incoming.fromSocketId
      setIncoming(null)
      setInCall(true)
    } catch (e) {
      console.error('acceptCall failed', e)
      alert('Accept failed: ' + e.message)
    }
  }

  function rejectCall() {
    if (!incoming) return
    if (socketRef.current) socketRef.current.emit('reject-call', { toSocketId: incoming.fromSocketId })
    setIncoming(null)
  }

  function endCall() {
    if (socketRef.current && currentPeerSocketRef.current) {
      socketRef.current.emit('end-call', { toSocketId: currentPeerSocketRef.current })
    }
    cleanupCall()
  }

  // ========== render ==========
  return (
    <div className="app">
      <header className="topbar">
        <h1 style={{ color: '#dff' }}>SkyCall</h1>
        {token ? <div><button className="btn" onClick={logout}>Logout</button></div> : null}
      </header>

      {page === 'auth' && (
        <div className="auth">
          <div className="card" style={{ width: 360 }}>
            <h2>Register</h2>
            <form onSubmit={register}>
              <input name="username" placeholder="username" required />
              <input name="password" placeholder="password" type="password" required />
              <button className="btn">Register</button>
            </form>
          </div>

          <div className="card" style={{ width: 360 }}>
            <h2>Login</h2>
            <form onSubmit={login}>
              <input name="username" placeholder="username" required />
              <input name="password" placeholder="password" type="password" required />
              <button className="btn">Login</button>
            </form>
          </div>
        </div>
      )}

      {page === 'dashboard' && (
        <div className="dashboard">
          <div className="left">
            <h3 style={{ color: '#dff' }}>Search users</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search by username" />
              <button className="btn" onClick={searchUsers}>Search</button>
            </div>

            <ul className="users">
              {results.map((r) => (
                <li key={r.id}>
                  <span style={{ color: '#e6eef6' }}>{r.username}</span>
                  <div>
                    <button className="btn small" onClick={() => callUser(r.id)}>Call</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="right card">
            <div className="videoGrid">
              <video id="localVideo" autoPlay playsInline muted style={{ width: 320, height: 240, background: '#000' }} />
              <video id="remoteVideo" autoPlay playsInline style={{ width: 320, height: 240, background: '#000' }} />
            </div>

            <div className="controls">
              <button className="btn" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
              <button className="btn" onClick={toggleVideo}>{videoEnabled ? 'Turn camera off' : 'Turn camera on'}</button>
              <button className="btn" onClick={endCall}>End Call</button>
            </div>
          </div>
        </div>
      )}

      {incoming && (
        <div className="incoming">
          <div className="modal card">
            <h3>Incoming call from {incoming.from?.username || 'user'}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={acceptCall}>Accept</button>
              <button className="btn" onClick={rejectCall}>Reject</button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <small style={{ color: '#9aa' }}>SkyCall — demo</small>
      </footer>
    </div>
  )
}
