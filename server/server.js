import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import mongoose from "mongoose";

// ====================== DB CONNECT ======================
mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// ======= USER MODEL =======
const UserSchema = new mongoose.Schema({
    username: String,
    password: String
});
const User = mongoose.model("User", UserSchema);

// ====================== APP ======================
const app = express();
app.use(cors());
app.use(express.json());

// ====================== AUTH API ======================

// REGISTER
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: "User exists" });

    const user = new User({ username, password });
    await user.save();

    res.json({ success: true });
});

// LOGIN
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });
    if (!user) return res.status(404).json({ error: "Invalid credentials" });

    res.json({
        id: user._id,
        username: user.username
    });
});

// ====================== USERS SEARCH ======================
app.get("/api/users", async (req, res) => {
    const q = (req.query.q || "").trim();

    if (!q) return res.json([]);

    const users = await User.find({
        username: { $regex: q, $options: "i" }
    });

    res.json(users.map(u => ({
        id: u._id,
        username: u.username
    })));
});

// ====================== SOCKET / WEBRTC ======================
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const onlineUsers = new Map();

// --- when connected ---
io.on("connection", socket => {
    console.log("Socket connected:", socket.id);

    // user connected
    socket.on("online", userId => {
        onlineUsers.set(userId, socket.id);
    });

    // call
    socket.on("call-user", ({ to, offer, from }) => {
        const target = onlineUsers.get(to);
        if (target)
            io.to(target).emit("incoming-call", { from, offer });
    });

    // answer
    socket.on("answer-call", ({ to, answer }) => {
        const target = onlineUsers.get(to);
        if (target)
            io.to(target).emit("call-answered", { answer });
    });

    // ICE
    socket.on("ice-candidate", ({ to, candidate }) => {
        const target = onlineUsers.get(to);
        if (target)
            io.to(target).emit("ice-candidate", candidate);
    });

    // disconnect
    socket.on("disconnect", () => {
        for (const [uid, sid] of onlineUsers.entries()) {
            if (sid === socket.id) onlineUsers.delete(uid);
        }
    });
});

// ====================== START ======================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
