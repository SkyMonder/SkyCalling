# SkyCall - Demo WebRTC app

## What is included
- `server/` - Node.js + Express + Socket.IO signaling server, simple auth (in-memory)
- `client/` - Vite + React frontend with registration/login, search, incoming call UI and call controls

## Run locally
1. Install dependencies for server and client:
   ```bash
   cd server
   npm install
   cd ../client
   npm install
   ```
2. Start server:
   ```bash
   cd server
   npm start
   ```
3. Start client in dev (from client folder):
   ```bash
   npm run dev
   ```
   Or build and serve static from server (recommended for deployment):
   ```bash
   cd client
   npm run build
   cp -r dist ../server/dist
   cd ../server
   npm start
   ```

## Deploy to Render (simple)
1. Create a new Web Service on Render.
2. Connect your GitHub repository containing this project.
3. Set the root to `server` and the build command to:
   ```bash
   cd ../client && npm install && npm run build && cp -r dist ../server/dist
   cd ../server && npm install
   ```
   And start command: `npm start`
4. Set environment variable `JWT_SECRET` to a strong secret.
5. If you prefer separate services: deploy `client` as a Static Site (build command `npm install && npm run build`, publish `dist`) and `server` as a Web Service. Make sure to set `VITE_API_URL` to your server URL in client environment settings.
