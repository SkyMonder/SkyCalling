import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// --- CORS ---
app.use(cors({
  origin: "https://skycallingconnect.onrender.com",
  credentials: true,
  methods: ["GET","POST","OPTIONS"]
}));

// --- JSON parsing ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Users memory ---
let users = [];
let sockets = {};

// --- API ---
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if(users.find(u=>u.username===username)) return res.status(400).json({ error: "Username exists" });
  users.push({ username, password, id: Date.now().toString() });
  res.json({ ok: true, token: username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u=>u.username===username && u.password===password);
  if(!user) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ ok:true, token: username });
});

app.get("/api/users", (req, res) => {
  const q = req.query.q?.toLowerCase() || "";
  const filtered = users.filter(u=>u.username.toLowerCase().includes(q));
  res.json(filtered);
});

// --- Serve frontend ---
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req,res)=> {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// --- WebSocket / Socket.io ---
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

io.on("connection", socket => {
  socket.on("auth", (username) => {
    sockets[username] = socket.id;
  });

  socket.on("call-user", ({ toUserId, offer }) => {
    const target = sockets[toUserId];
    if(target) io.to(target).emit("incoming-call", { from: toUserId, offer, fromSocketId: socket.id });
  });

  socket.on("accept-call", ({ toSocketId, answer }) => {
    io.to(toSocketId).emit("call-accepted", { answer });
  });

  socket.on("reject-call", ({ toSocketId }) => {
    io.to(toSocketId).emit("call-rejected");
  });

  socket.on("ice-candidate", ({ toSocketId, candidate }) => {
    io.to(toSocketId).emit("ice-candidate", { candidate });
  });

  socket.on("end-call", ({ toSocketId }) => {
    io.to(toSocketId).emit("call-ended");
  });
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
