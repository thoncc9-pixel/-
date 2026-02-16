
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { WebcastPushConnection } = require("tiktok-live-connector");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static("public"));

/* RATE LIMIT */
const connectLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Too many attempts. กรุณารอสักครู่" }
});

app.use("/connect", connectLimiter);

const sessions = {};

wss.on("connection", (ws) => {
    const sessionId = uuidv4();
    ws.sessionId = sessionId;

    sessions[sessionId] = {
        tiktok: null,
        clients: new Set([ws]),
        lastMessageTime: 0
    };

    ws.send(JSON.stringify({ type: "session", sessionId }));

    ws.on("close", () => {
        if (sessions[sessionId]) {
            sessions[sessionId].clients.delete(ws);

            if (sessions[sessionId].clients.size === 0) {
                if (sessions[sessionId].tiktok) {
                    sessions[sessionId].tiktok.disconnect();
                }
                delete sessions[sessionId];
            }
        }
    });
});

app.post("/connect", async (req, res) => {
    const { url, sessionId } = req.body;

    if (!url || !sessionId) {
        return res.status(400).json({ error: "Missing data" });
    }

    const match = url.match(/@([^/]+)/);
    if (!match) {
        return res.status(400).json({ error: "Invalid URL" });
    }

    const username = match[1];

    if (!sessions[sessionId]) {
        return res.status(400).json({ error: "Session not found" });
    }

    if (sessions[sessionId].tiktok) {
        sessions[sessionId].tiktok.disconnect();
    }

    const tiktok = new WebcastPushConnection(username);
    sessions[sessionId].tiktok = tiktok;

    try {
        await tiktok.connect();

        tiktok.on("chat", data => {

            const now = Date.now();

            if (now - sessions[sessionId].lastMessageTime < 800) {
                return;
            }

            sessions[sessionId].lastMessageTime = now;

            const message = `${data.nickname}: ${data.comment}`;

            sessions[sessionId].clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "chat",
                        message
                    }));
                }
            });
        });

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: "Connect failed" });
    }
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
