import http from 'http';
import { WebSocketServer } from 'ws';
// 👇 use a relative path into node_modules (this works even in newer y-websocket)
import { setupWSConnection } from './node_modules/y-websocket/bin/utils.js';

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});

const PORT = 1234;
server.listen(PORT, () => {
  console.log(`✅ Y-WebSocket server running on ws://localhost:${PORT}`);
});
