import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || '/api';
const SIGNALING = import.meta.env.VITE_SIGNALING_URL || window.location.origin;

function App() {
  const [token, setToken] = useState(localStorage.getItem('token')||'');
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
  const [videoOff, setVideoOff] = useState(true); // камера изначально выключена

  useEffect(()=>{
    if(token){
      const s = io(SIGNALING, { transports: ["websocket"] });
      socketRef.current = s;

      s.on('connect', ()=> s.emit('auth', token));
      s.on('auth-ok', ({ user })=> setUser(user));

      s.on('incoming-call', ({ from, fromSocketId, offer })=>{
        setIncoming({ from, fromSocketId, offer });
      });

      s.on('call-accepted', async ({ answer }) => {
        if(pcRef.current){
          await pcRef.current.setRemoteDescription(answer);
          setInCall(true);
        }
      });

      s.on('call-rejected', ()=> alert('Call rejected'));
      s.on('ice-candidate', async ({ candidate }) => {
        if(candidate && pcRef.current){
          try{ await pcRef.current.addIceCandidate(candidate);}catch(e){console.warn(e)}
        }
      });

      s.on('call-ended', endCallLocal);
      return ()=> s.disconnect();
    }
  }, [token]);

  async function startLocalStream({ audio=true, video=false }){
    const s = await navigator.mediaDevices.getUserMedia({ audio, video });
    localStreamRef.current = s;
    const localVid = document.getElementById('localVideo');
    if(localVid) localVid.srcObject = s;
  }

  function createPeerConnection(){
    const pc = new RTCPeerConnection();
    pc.onicecandidate = (e)=>{
      if(e.candidate){
        socketRef.current.emit('ice-candidate', { toSocketId: incoming ? incoming.fromSocketId : null, candidate: e.candidate });
      }
    };
    pc.ontrack = (e)=>{
      const [stream] = e.streams;
      const remoteVid = document.getElementById('remoteVideo');
      if(remoteVid){
        remoteVid.srcObject = stream;
        remoteStreamRef.current = stream;
      }
    };
    return pc;
  }

  async function callUser(targetId){
    await startLocalStream({ audio: true, video: false }); // микрофон включен, камера выключена
    const pc = createPeerConnection();
    pcRef.current = pc;
    localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('call-user', { toUserId: targetId, offer: pc.localDescription });
  }

  async function acceptCall(){
    await startLocalStream({ audio: true, video: false });
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

  function toggleVideo(){
    if(localStreamRef.current){
      localStreamRef.current.getVideoTracks().forEach(t=> t.enabled = !t.enabled);
      setVideoOff(prev => !prev);
    }
  }

  function endCallLocal(){
    if(pcRef.current) pcRef.current.close();
    if(localStreamRef.current){
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    const localVid = document.getElementById('localVideo');
    if(localVid) localVid.srcObject = null;
    const remoteVid = document.getElementById('remoteVideo');
    if(remoteVid) remoteVid.srcObject = null;
    setInCall(false);
  }

  // остальные функции login/register/search/controls такие же, только убрал лишнюю кнопку видео
  // ...
}

export default App;
