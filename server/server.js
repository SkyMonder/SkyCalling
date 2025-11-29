// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // можно ограничить по домену
    methods: ["GET","POST"]
  }
});

app.use(express.json());

// ==== API ====
// Пример: регистрация, логин, поиск пользователей
let users = []; // В проде нужно БД
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if(users.find(u => u.username === username)) return res.json({error: 'User exists'});
  const token = Math.random().toString(36).substr(2);
  const user = { username, password, id: users.length + 1, token };
  users.push(user);
  res.json({token, user});
});

app.post('/api/login', (req,res)=>{
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password===password);
  if(!user) return res.json({error:'Invalid login'});
  res.json({token:user.token, user});
});

app.get('/api/users', (req,res)=>{
  const q = (req.query.q||'').toLowerCase();
  const result = users.filter(u => u.username.toLowerCase().includes(q));
  res.json(result);
});

// ==== Статика фронтенда ====
app.use(express.static(path.join(__dirname, './client/dist')));
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, './client/dist/index.html'));
});

// ==== Socket.IO ====
let sockets = {};

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('auth', token => {
    const user = users.find(u => u.token===token);
    if(user){
      sockets[socket.id] = user;
      socket.emit('auth-ok', {user});
    }
  });

  socket.on('call-user', ({ toUserId, offer }) => {
    const targetSocketId = Object.keys(sockets).find(sid => sockets[sid].id === toUserId);
    if(targetSocketId){
      io.to(targetSocketId).emit('incoming-call', { from: sockets[socket.id], fromSocketId: socket.id, offer });
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
    delete sockets[socket.id];
  });
});

// ==== Запуск сервера ====
const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log(`Server running on ${PORT}`));
