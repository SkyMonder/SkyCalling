// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST"]
  }
});

// In-memory users storage (demo)
const users = new Map(); // key: username, value: { password, id, socketId }

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// --- REST API ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (users.has(username)) return res.status(400).json({ error: "User exists" });

  const id = crypto.randomUUID();
  const token = generateToken();
  users.set(username, { password, id, token, socketId: null });
  res.json({ token, user: { id, username } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user || user.password !== password) return res.status(400).json({ error: "Invalid credentials" });
  const token = generateToken();
  user.token = token;
  res.json({ token, user: { id: user.id, username } });
});

app.get('/api/users', (req, res) => {
  const q = req.query.q?.toLowerCase() || '';
  const result = [];
  for (const [username, u] of users.entries()) {
    if (username.toLowerCase().includes(q)) result.push({ id: u.id, username });
  }
  res.json(result);
});

// --- Socket.io signaling ---
io.on('connection', socket => {
  console.log("Socket connected:", socket.id);

  socket.on('auth', token => {
    for (const [username, user] of users.entries()) {
      if (user.token === token) {
        user.socketId = socket.id;
        socket.user = user;
        socket.emit('auth-ok', { user: { id: user.id, username } });
        break;
      }
    }
  });

  socket.on('call-user', ({ toUserId, offer }) => {
    const target = [...users.values()].find(u => u.id === toUserId);
    if (target?.socketId) {
      io.to(target.socketId).emit('incoming-call', { from: socket.user, fromSocketId: socket.id, offer });
    }
  });

  socket.on('accept-call', ({ toSocketId, answer }) => {
    io.to(toSocketId).emit('call-accepted', { answer });
  });

  socket.on('reject-call', ({ toSocketId }) => {
    io.to(toSocketId).emit('call-rejected');
  });

  socket.on('ice-candidate', ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit('ice-candidate', { candidate });
  });

  socket.on('end-call', ({ toSocketId }) => {
    io.to(toSocketId).emit('call-ended');
  });

  socket.on('disconnect', () => {
    if (socket.user) socket.user.socketId = null;
    console.log("Socket disconnected:", socket.id);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
