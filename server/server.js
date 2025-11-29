import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Простейший API для теста
app.get('/api/users', (req, res) => {
  const q = req.query.q?.toLowerCase();
  const users = [
    { id: '1', username: 'Alice' },
    { id: '2', username: 'Bob' },
    { id: '3', username: 'Joker' }
  ];
  if (q) {
    return res.json(users.filter(u => u.username.toLowerCase().includes(q)));
  }
  res.json(users);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // можно ограничить доменом фронтенда
});

io.on('connection', socket => {
  console.log('new socket:', socket.id);

  socket.on('auth', token => {
    console.log('auth token', token);
    // простой mock user
    socket.user = { id: socket.id, username: `User-${socket.id.slice(0,4)}` };
    socket.emit('auth-ok', { user: socket.user });
  });

  socket.on('call-user', ({ toUserId, offer }) => {
    const target = Array.from(io.sockets.sockets.values())
      .find(s => s.user?.id === toUserId);
    if (target) {
      target.emit('incoming-call', { from: socket.user, fromSocketId: socket.id, offer });
    }
  });

  socket.on('accept-call', ({ toSocketId, answer }) => {
    const target = io.sockets.sockets.get(toSocketId);
    if (target) target.emit('call-accepted', { answer });
  });

  socket.on('reject-call', ({ toSocketId }) => {
    const target = io.sockets.sockets.get(toSocketId);
    if (target) target.emit('call-rejected');
  });

  socket.on('ice-candidate', ({ toSocketId, candidate }) => {
    const target = io.sockets.sockets.get(toSocketId);
    if (target) target.emit('ice-candidate', { candidate });
  });

  socket.on('end-call', ({ toSocketId }) => {
    const target = io.sockets.sockets.get(toSocketId);
    if (target) target.emit('call-ended');
  });

  socket.on('disconnect', () => {
    console.log('disconnected', socket.id);
  });
});

// Render задаёт порт через env
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
