export default function CallModal({ from, onAccept, onReject }) {
    return (
        <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 24
        }}>
            <div style={{ background: "#222", padding: 20, borderRadius: 8 }}>
                <h3>Входящий вызов от: {from}</h3>
                <button onClick={onAccept}>Принять</button>
                <button onClick={onReject}>Отклонить</button>
            </div>
        </div>
    );
}
