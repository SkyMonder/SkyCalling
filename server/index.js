const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Simple in-memory store (for demo only)
const USERS = []; // { id, username, passwordHash }
const SOCKETS = {}; // userId -> socketId

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: 'username and password required' });
  if(USERS.find(u => u.username === username)) return res.status(400).json({ error: 'username exists' });
  const passwordHash = await bcrypt.hash(password, 8);
  const id = Date.now().toString();
  USERS.push({ id, username, passwordHash });
  const token = jwt.sign({ id, username }, JWT_SECRET);
  res.json({ token, user: { id, username } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = USERS.find(x => x.username === username);
  if(!u) return res.status(400).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if(!ok) return res.status(400).json({ error: 'invalid credentials' });
  const token = jwt.sign({ id: u.id, username: u.username }, JWT_SECRET);
  res.json({ token, user: { id: u.id, username: u.username } });
});

app.get('/api/users', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = USERS.filter(u => u.username.toLowerCase().includes(q)).map(u=>({ id: u.id, username: u.username }));
  res.json(results);
});

// Serve frontend build if present
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (require('fs').existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('auth', (token) => {
    try {
      const data = jwt.verify(token, JWT_SECRET);
      socket.user = data;
      SOCKETS[data.id] = socket.id;
      io.to(socket.id).emit('auth-ok', { user: data });
      console.log('authenticated', data.username);
    } catch(e) {
      io.to(socket.id).emit('auth-failed');
    }
  });

  socket.on('call-user', ({ toUserId, offer }) => {
    const toSocket = SOCKETS[toUserId];
    if (toSocket) {
      io.to(toSocket).emit('incoming-call', { from: socket.user, fromSocketId: socket.id, offer });
    } else {
      io.to(socket.id).emit('user-unavailable');
    }
  });

  socket.on('accept-call', ({ toSocketId, answer }) => {
    io.to(toSocketId).emit('call-accepted', { answer, by: socket.user });
  });

  socket.on('reject-call', ({ toSocketId }) => {
    io.to(toSocketId).emit('call-rejected', { by: socket.user });
  });

  socket.on('ice-candidate', ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit('ice-candidate', { candidate, from: socket.user });
  });

  socket.on('end-call', ({ toSocketId }) => {
    io.to(toSocketId).emit('call-ended', { by: socket.user });
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      delete SOCKETS[socket.user.id];
    }
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('Server listening on', PORT));
