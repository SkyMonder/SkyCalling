import React, { useEffect, useState } from "react";
import io from "socket.io-client";
import CallModal from "./CallModal";
import CallPage from "./CallPage";

const socket = io("https://skycalling.onrender.com:10000", {
    transports: ["websocket"]
});

export default function App() {
    const [userId, setUserId] = useState("");
    const [inputId, setInputId] = useState("");

    const [incomingCall, setIncomingCall] = useState(null);
    const [activeCall, setActiveCall] = useState(null);

    // РЕГИСТРАЦИЯ СОКЕТА
    useEffect(() => {
        if (!userId) return;
        socket.emit("register", userId);
    }, [userId]);

    // ПОЛУЧЕНИЕ ВХОДЯЩЕГО
    useEffect(() => {
        socket.on("incoming-call", (data) => {
            console.log("INCOMING CALL:", data);
            setIncomingCall(data);
        });

        socket.on("call-rejected", () => {
            alert("Звонок отклонён");
            setActiveCall(null);
        });

        socket.on("call-accepted", ({ from }) => {
            setActiveCall(from);
        });

        return () => {
            socket.off("incoming-call");
            socket.off("call-rejected");
            socket.off("call-accepted");
        };
    }, []);

    const callUser = () => {
        socket.emit("call-user", {
            from: userId,
            to: inputId
        });
        setActiveCall(inputId);
    };

    return (
        <div style={{ padding: 20 }}>
            {!userId && (
                <>
                    <h2>Введите ваш ID:</h2>
                    <input value={inputId} onChange={(e) => setInputId(e.target.value)} />
                    <button onClick={() => setUserId(inputId)}>OK</button>
                </>
            )}

            {userId && !activeCall && (
                <>
                    <h2>Ваш ID: {userId}</h2>
                    <input placeholder="Кого вызвать?" value={inputId} onChange={e => setInputId(e.target.value)} />
                    <button onClick={callUser}>Позвонить</button>
                </>
            )}

            {incomingCall && (
                <CallModal
                    from={incomingCall.from}
                    onAccept={() => {
                        socket.emit("call-accepted", {
                            from: incomingCall.from,
                            to: userId
                        });
                        setActiveCall(incomingCall.from);
                        setIncomingCall(null);
                    }}
                    onReject={() => {
                        socket.emit("call-rejected", {
                            from: incomingCall.from,
                            to: userId
                        });
                        setIncomingCall(null);
                    }}
                />
            )}

            {activeCall && (
                <CallPage
                    myId={userId}
                    peerId={activeCall}
                    socket={socket}
                />
            )}
        </div>
    );
}
