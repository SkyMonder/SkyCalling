import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Хранилище пользователей и сокетов
const users = {};     // userId → socketId
const sockets = {};   // socketId → userId

// ---------- SOCKET.IO ----------
io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("register", (userId) => {
        users[userId] = socket.id;
        sockets[socket.id] = userId;
        console.log("REGISTER:", userId, "→", socket.id);
    });

    // Исходящий звонок
    socket.on("call-user", ({ from, to }) => {
        console.log(`CALL: ${from} → ${to}`);
        const targetSocket = users[to];

        if (!targetSocket) {
            socket.emit("call-error", "Пользователь не в сети");
            return;
        }

        io.to(targetSocket).emit("incoming-call", {
            from,
            socketId: socket.id
        });
    });

    // Принятие
    socket.on("call-accepted", ({ from, to }) => {
        const targetSocket = users[from];
        if (targetSocket) io.to(targetSocket).emit("call-accepted", { from: to });
    });

    // Отклонение
    socket.on("call-rejected", ({ from, to }) => {
        const targetSocket = users[from];
        if (targetSocket) io.to(targetSocket).emit("call-rejected", { from: to });
    });

    socket.on("disconnect", () => {
        const uid = sockets[socket.id];
        delete users[uid];
        delete sockets[socket.id];
        console.log("Disconnected:", socket.id);
    });
});

server.listen(10000, () => {
    console.log("Server running on port 10000");
});
