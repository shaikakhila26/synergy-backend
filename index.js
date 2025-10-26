// synergy-backend/src/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { WebSocketServer } from "ws";           // WS server
// CommonJS import via `createRequire`
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { setupWSConnection } = require("y-websocket");


import authRoutes from './routes/auth.js';
import helmet from 'helmet'; // 🔹 UPDATED: security headers
import workspaceRoutes from './routes/workspace.js'; // 🔹 NEW: workspace routes
import { createServer } from 'http';            // ⚡
import { Server } from 'socket.io';  
import chatRoutes from './routes/chat.js';           // ⚡
import taskboardRoutes from './routes/taskboard.js'; // 🔹 NEW: taskboard routes

dotenv.config();

const app = express();
const httpServer = createServer(app);           // ⚡ use http server

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// -------------------- Y-WebSocket --------------------
const wss = new WebSocketServer({ server: httpServer, path: '/yjs' });
wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
});
console.log('ENV PORT:', process.env.PORT);

console.log('🖌 Y-WebSocket ready at path /yjs');

// 🔹 UPDATED: Security headers
app.use(helmet());

// Middleware to attach io to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors({
  origin: CLIENT_URL,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
// attach supabase client to app for reuse in routes (optional)
app.set('supabase', supabase);


app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes); // 🔹 NEW: use workspace routes
app.use('/api/chat', chatRoutes);           // ⚡ NEW: use chat routes
app.use('/api/taskboard', taskboardRoutes); // 🔹 NEW: taskboard routes

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); // 🔹 UPDATED: prevent caching
  res.send('Synergy backend running!');
});

// Store lines per workspace to allow new users to sync
const workspaceLines = {};
const workspaceStickies = {};

// ⚡ Socket.io chat handling
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('joinWorkspace', (workspaceId) => {
    console.log(`Socket ${socket.id} requests to join workspace ${workspaceId}`);
    if (!workspaceId) return;
    const room = `workspace:${workspaceId}`;
    socket.join(room);
    console.log(`Socket ${socket.id} joined ${room}`);
  });

  socket.on('leaveWorkspace', (workspaceId) => {
    console.log(`Socket ${socket.id} requests to leave workspace ${workspaceId}`);
    if (!workspaceId) return;
    const room = `workspace:${workspaceId}`;
    socket.leave(room);
    console.log(`Socket ${socket.id} left ${room}`);
  });

  // join DM room
  socket.on('joinDM', ({ userA, userB }) => {
    if (!userA || !userB) return;
    const [a,b] = [userA, userB].sort();
    const room = `dm:${a}_${b}`;
    socket.join(room);
    console.log(`Socket ${socket.id} joined ${room}`);
  });

  // send workspace message
  socket.on('sendWorkspaceMessage', async (payload) => {
    console.log('sendWorkspaceMessage payload:', payload);
    // payload: { workspace_id, sender_id, text }
    try {
      const { workspace_id, sender_id, text } = payload;
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data, error } = await supabase
        .from('messages')
        .insert([{ workspace_id, sender_id, text }])
        .select()
        .single();

        console.log('Inserted workspace message data:', data, 'error:', error);

      if (error) {
        console.error('Insert message error:', error);
        return;
      }

      // broadcast to workspace room
      io.to(`workspace:${workspace_id}`).emit('newWorkspaceMessage', data);
    } catch (err) {
      console.error('sendWorkspaceMessage error', err);
    }
  });

  // send direct message
  socket.on('sendDirectMessage', async (payload) => {
    // payload: { sender_id, recipient_id, text }
    try {
      const { sender_id, recipient_id, text } = payload;
      // Persist message with thread_id = null and workspace_id = null (or you may set workspace_id)
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data, error } = await supa
        .from('messages')
        .insert([{ workspace_id: null, sender_id, text, thread_id: null }])
        .select()
        .single();

      if (error) {
        console.error('Insert DM error:', error);
        return;
      }

      // Broadcast to DM room
      const [a,b] = [sender_id, recipient_id].sort();
      const room = `dm:${a}_${b}`;
      io.to(room).emit('newDirectMessage', { ...data, recipient_id });
    } catch (err) {
      console.error('sendDirectMessage error', err);
    }
  });

// --- inside io.on('connection', socket) ---
/**
 * Video call / meeting signaling
 *
 * Room namespace: `call:<roomId>`
 *
 * Protocol:
 * - Client A emits 'joinCallRoom' with { roomId, userId, metadata }
 * - Server adds socket to room and responds to A with 'all-users' -> [socketId, ...existing]
 * - Server broadcasts 'user-joined' to other sockets in that room (optional notification)
 * - Client A creates initiator SimplePeer for each existing socket, sends offer via 'signal'
 * - Server forwards 'signal' messages as { to, from, signal }
 * - If a socket leaves/disconnects, server emits 'user-left' to room
 */

socket.on('joinCallRoom', ({ roomId, userId, metadata } = {}) => {
  try {
    if (!roomId) return;
    const roomName = `call:${roomId}`;
    socket.join(roomName);

    // gather existing sockets in the room (exclude the joining socket)
    const clients = io.sockets.adapter.rooms.get(roomName) || new Set();
    const existing = Array.from(clients).filter(id => id !== socket.id);

    // send the list of existing sockets to the newly joined client
    socket.emit('all-users', { existing, you: socket.id });

    // notify others that a new user joined (useful for notifications UI)
    socket.to(roomName).emit('user-joined', { socketId: socket.id, userId, metadata });

    console.log(`Socket ${socket.id} joined call room ${roomName}. existing members:`, existing);
  } catch (err) {
    console.error('joinCallRoom error', err);
  }
});

socket.on('signal', ({ to, signal } = {}) => {
  try {
    if (!to) return;
    // forward to the targeted socket
    io.to(to).emit('signal', { from: socket.id, signal });
  } catch (err) {
    console.error('signal forward error', err);
  }
});

socket.on('leaveCallRoom', ({ roomId } = {}) => {
  try {
    if (!roomId) return;
    const roomName = `call:${roomId}`;
    socket.leave(roomName);
    socket.to(roomName).emit('user-left', { socketId: socket.id });
    console.log(`Socket ${socket.id} left call room ${roomName}`);
  } catch (err) {
    console.error('leaveCallRoom error', err);
  }
});

// handle disconnect globally (notify any call rooms)
socket.on('disconnecting', () => {
  try {
    const rooms = socket.rooms; // Set of rooms socket is in
    for (const room of rooms) {
      if (room.startsWith('call:')) {
        socket.to(room).emit('user-left', { socketId: socket.id });
      }
    }
  } catch (err) {
    console.error('disconnecting handler error', err);
  }
});
/*
socket.on("draw", (line) => {
    socket.broadcast.emit("draw", line);
  });

  socket.on("clear", () => {
    socket.broadcast.emit("clear");
  });
*/
/*
socket.on("joinRoom", (workspaceId) => {
    socket.join(workspaceId);
    console.log(`${socket.id} joined workspace ${workspaceId}`);

    // Send existing lines to new user
    if (workspaceLines[workspaceId]) {
      socket.emit("syncLines", workspaceLines[workspaceId]);
    } else {
      workspaceLines[workspaceId] = [];
    }
  });

  socket.on("draw", ({ workspaceId, line }) => {
    workspaceLines[workspaceId].push(line);
    socket.to(workspaceId).emit("draw", line);
  });

  socket.on("undo", ({ workspaceId }) => {
    workspaceLines[workspaceId].pop();
    io.to(workspaceId).emit("syncLines", workspaceLines[workspaceId]);
  });

  socket.on("clear", ({ workspaceId }) => {
    workspaceLines[workspaceId] = [];
    io.to(workspaceId).emit("syncLines", []);
  });

*/


socket.on("joinRoom", (workspaceId) => {
  const room = `workspace:${workspaceId}`;
  socket.join(room);
  console.log(`${socket.id} joined workspace ${workspaceId}`);

  if (!workspaceLines[workspaceId]) workspaceLines[workspaceId] = [];
  if (!workspaceStickies[workspaceId]) workspaceStickies[workspaceId] = [];
  // Send existing lines to the new user
  socket.emit("syncLines", workspaceLines[workspaceId]);
  socket.emit("syncStickies", workspaceStickies[workspaceId]);
});

socket.on("draw", ({ workspaceId, line }) => {
  if (!workspaceLines[workspaceId]) workspaceLines[workspaceId] = [];
  workspaceLines[workspaceId].push(line);
  // broadcast to everyone including sender
  console.log(`DRAW -> workspace ${workspaceId}, total lines: ${workspaceLines[workspaceId].length}`);
  console.log(`[SERVER] Broadcasting syncLines to room: ${workspaceId}`);
  io.to(`workspace:${workspaceId}`).emit("syncLines", workspaceLines[workspaceId]);
});

socket.on("undo", ({ workspaceId }) => {
  if (!workspaceLines[workspaceId]) workspaceLines[workspaceId] = [];
  const removed = workspaceLines[workspaceId].pop();
  console.log(`[SERVER] UNDO in workspace ${workspaceId}, removed:`, removed);
  io.to(workspaceId).emit("syncLines", workspaceLines[workspaceId]);
});
  

socket.on("clear", ({ workspaceId }) => {
  workspaceLines[workspaceId] = [];
  workspaceStickies[workspaceId] = [];
   console.log(`CLEAR -> workspace ${workspaceId}`);
  io.to(workspaceId).emit("syncLines", []);
  io.to(workspaceId).emit("syncStickies", []);

});

socket.on("addSticky", ({ workspaceId, sticky }) => {
  if (!workspaceStickies[workspaceId]) workspaceStickies[workspaceId] = [];
  workspaceStickies[workspaceId].push(sticky);
  io.to(`workspace:${workspaceId}`).emit("syncStickies", workspaceStickies[workspaceId]);
});

socket.on("removeSticky", ({ workspaceId, stickyId }) => {
  if (!workspaceStickies[workspaceId]) return;
  workspaceStickies[workspaceId] = workspaceStickies[workspaceId].filter(s => s.id !== stickyId);
  io.to(`workspace:${workspaceId}`).emit("syncStickies", workspaceStickies[workspaceId]);

});

socket.on("updateSticky", ({ workspaceId, sticky }) => {
  if (!workspaceStickies[workspaceId]) return;
  workspaceStickies[workspaceId] = workspaceStickies[workspaceId].map(s =>
    s.id === sticky.id ? sticky : s
  );
  io.to(`workspace:${workspaceId}`).emit("syncStickies", workspaceStickies[workspaceId]);
});



// workspaceUsers = { workspaceId: { userId: { user, sockets: Set<socketId> } } }
const workspaceUsers = {};

socket.on("joinPresenceRoom", (workspaceId, user) => {
  socket.join(`presence-${workspaceId}`);
  workspaceUsers[workspaceId] = workspaceUsers[workspaceId] || {};

  if (!workspaceUsers[workspaceId][user.id]) {
    workspaceUsers[workspaceId][user.id] = { user, sockets: new Set() };
  }
  workspaceUsers[workspaceId][user.id].sockets.add(socket.id);

  // Send online users excluding self
  const online = Object.values(workspaceUsers[workspaceId])
    .map(u => u.user)
    

  io.to(`presence-${workspaceId}`).emit("presenceUpdate", online);
});

socket.on("leavePresenceRoom", (workspaceId) => {
  const wsUsers = workspaceUsers[workspaceId];
  if (!wsUsers) return;

  for (const uid in wsUsers) {
    wsUsers[uid].sockets.delete(socket.id);
    if (wsUsers[uid].sockets.size === 0) delete wsUsers[uid];
  }

  const online = Object.values(wsUsers).map(u => u.user);
  io.to(`presence-${workspaceId}`).emit("presenceUpdate", online);
});

socket.on("disconnectPresenceRoom", () => {
  for (const wsId in workspaceUsers) {
    const wsUsers = workspaceUsers[wsId];
    for (const uid in wsUsers) {
      wsUsers[uid].sockets.delete(socket.id);
      if (wsUsers[uid].sockets.size === 0) delete wsUsers[uid];
    }
    const online = Object.values(wsUsers).map(u => u.user);
    io.to(`presence-${wsId}`).emit("presenceUpdate", online);
  }
});

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});


const PORT = process.env.PORT ;   // ✅ Render assigns its own port
httpServer.listen(PORT, () => {
  console.log(`✅ Y-WebSocket + Backend running on ${process.env.CLIENT_URL} via port ${PORT}`);
});

