import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: "https://skycallingconnect.onrender.com",
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

// FIX — без этого login/register НЕ РАБОТАЮТ
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// USERS MEMORY
let users = [];
let sockets = {};

// --- API ---
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Exists" });
  }
  users.push({ username, password });
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid" });
  res.json({ ok: true });
});

app.get("/api/users", (req, res) => {
  const q = req.query.q?.toLowerCase() || "";
  const filtered = users.filter(u => u.username.toLowerCase().includes(q));
  res.json(filtered);
});

// STATIC FRONTEND (важно!)
app.use(express.static(path.join(__dirname, "client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

// --- WebSocket ---
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  path: "/socket.io/"
});

io.on("connection", (socket) => {
  socket.on("register", (username) => {
    sockets[username] = socket.id;
  });

  socket.on("call", ({ to, from }) => {
    if (sockets[to]) {
      io.to(sockets[to]).emit("incoming_call", { from });
    }
  });

  socket.on("signal", (data) => {
    if (sockets[data.to]) {
      io.to(sockets[data.to]).emit("signal", data);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Running on " + PORT));
