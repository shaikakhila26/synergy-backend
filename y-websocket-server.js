// server.js
import { setupWSConnection } from 'y-websocket/bin/utils.js';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

const port = 1234;
const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});

server.listen(port, () => {
  console.log(`Y-WebSocket Server running on ws://localhost:${port}`);
});
