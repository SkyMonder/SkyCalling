import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST"]
  }
});

// ==== CORS ====
app.use(cors({
  origin: 'https://skycallingconnect.onrender.com',
  methods: ['GET','POST','OPTIONS'],
  credentials: true
}));

app.use(express.json());

// ==== API ====
let users = [];
app.post('/api/register', (req, res) => { /* ... */ });
app.post('/api/login', (req,res)=>{ /* ... */ });
app.get('/api/users', (req,res)=>{ /* ... */ });

// ==== Статика фронтенда ====
app.use(express.static(path.join(__dirname, './client/dist')));
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, './client/dist/index.html'));
});

// ==== Socket.IO ====
let sockets = {};
io.on('connection', socket => { /* ... */ });

// ==== Запуск ====
const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log(`Server running on ${PORT}`));
