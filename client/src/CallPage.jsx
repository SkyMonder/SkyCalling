import React from "react";

export default function CallPage({ myId, peerId }) {
    return (
        <div style={{ padding: 20 }}>
            <h1>Видео-звонок</h1>
            <p>Вы: {myId}</p>
            <p>Собеседник: {peerId}</p>

            <p>Тут подключается WebRTC после стабильного сокет-соединения</p>
        </div>
    );
}
