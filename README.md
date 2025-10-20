# Synergy — Real-time Collaboration Suite

A full-stack demo for collaborative documents, whiteboards, video calls, chat, taskboards and file storage built with React + Vite (frontend), Node/Express (backend), Supabase (auth/storage/DB) and Yjs for CRDT-based realtime docs.


## Table of contents

- Project structure
- Features
- Requirements
- Environment variables
- Backend setup
- Yjs / realtime docs
- Troubleshooting

---

## Project structure

Top-level folders:

- `synergy-backend/` — Express backend, routes, models, Yjs persistence
- `synergy-frontend/` — React + Vite frontend app



---

## Features

- User authentication (Supabase Auth)
  
- Backend workspace APIs:
  
- Collaborative documents (Yjs + WebSocket)
  
- Yjs websocket server / persistence and persisted docs 


- Real-time chat (socket.io)

- Backend socket routing

- Kanban Taskboard
  - Backend task model helpers

- Video calls (WebRTC + simple-peer)
  
- Whiteboard (Konva + socket)
  
-

---

## Requirements

- Node.js 18
- npm (or yarn)
- A Supabase project (for Auth, storage, DB). 

---

## Environment variables

Frontend :

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_BACKEND_URL
- SMTP_* (for email sending from frontend/backed integration if used)

Backend :

- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- JWT_SECRET (or auth-related secrets, depending on middleware)
- SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS 



---

## Setup & run (development)

1. Clone repo / ensure you are in project root.

2. Backend

bash
cd synergy-backend
npm install
# start backend (express + socket.io)
npm start


3. Yjs Websocket server (optional / recommended for collaborative documents)

The repo supplies a Yjs websocket server and a persistent LevelDB folder:

- Start the Yjs websocket server:

bash
# from synergy-backend
npx y-websocket --port 1234


---

## Database / Supabase notes

- This project relies on Supabase for auth, storage and Postgres tables.
- The frontend uses the Supabase JS client (`supabase`) across many components such as [FileManager.jsx], [DocEditor.jsx] and [WorkspaceList.jsx]

- Important backend helper functions live in models:
  - [`createTaskList`] — [synergy-backend/models/task.js]

  - `User` model: [`User`] — [synergy-backend/models/User.js]

---

## Yjs / collaborative documents

- TipTap + Yjs are used on the frontend in [DocEditor.jsx]. The editor applies/saves snapshots to Supabase and also listens for Yjs updates.
- A WebSocket provider connects to the Yjs websocket server at `ws://localhost:1234` .
- Persistent Yjs state is stored in [synergy-backend/yjs-docs/]. The Yjs server script is [synergy-backend/y-websocket-server.js].

---

## Useful commands

- Start backend: `cd synergy-backend && npm start`
- Start Yjs websocket server : `cd synergy-backend && npx y-websocket --port 1234`


---


## Troubleshooting & tips

- CORS / proxies:
  - Backend sets CORS for the frontend origin in [synergy-backend/index.js](synergy-backend/index.js). Ensure `VITE_BACKEND_URL` and backend CORS origin match (default frontend dev is `http://localhost:5173`).
- Supabase 406 / PGRST116:
  - If you see 406 responses from Supabase REST endpoints when using `.single()` while a row may not exist, switch to `.maybeSingle()` or handle the "no row" case. See `AuthProvider.jsx` for where single/maybeSingle patterns are applied: [synergy-frontend/src/AuthProvider.jsx](synergy-frontend/src/AuthProvider.jsx).
- Yjs snapshots:
  - Snapshots are stored as binary/hex in the `documents` table and as files in `yjs-docs/`. If you see editor restore issues, check the snapshot conversion code in [DocEditor.jsx](synergy-frontend/src/components/features/DocEditor.jsx).
- Email invites:
  - Workspace invite code sending uses SMTP values from `.env`. Confirm `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are valid and `SMTP_SECURE` is set correctly. Backend invite logic lives in [synergy-backend/routes/workspace.js](synergy-backend/routes/workspace.js).

---

## Deployment notes

- For production you should:
  - Use secure, managed Supabase keys (service role key only on the backend).
  - Run the Yjs websocket server behind a process manager and configure the LevelDB persistence folder.
  - Set NODE_ENV=production and enable appropriate security headers / rate limiting (see [synergy-backend/index.js](synergy-backend/index.js) usage of `helmet`).
  - Serve frontend build static files via a CDN or static host and set `VITE_BACKEND_URL` to the production API.

---
