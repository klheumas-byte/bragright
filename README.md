# BragRight

BragRight is a React + Flask + MongoDB Atlas app for player match tracking and admin moderation.

## Stack

- Frontend: React, Vite, React Router
- Backend: Flask, PyMongo
- Database: MongoDB Atlas

## Project Structure

```text
bragright/
  client/   React frontend
  server/   Flask backend
```

## Prerequisites

- Node.js 18+
- Python 3.11+
- MongoDB Atlas connection string

## Setup

### 1. Backend

Create `server/.env` from `server/.env.example` and fill in your real values.

Install dependencies:

```bash
cd server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Start the backend:

```bash
cd server
start.bat
```

The API runs at `http://localhost:5000/api`.

### 2. Frontend

Install dependencies:

```bash
cd client
npm install
```

Start the frontend:

```bash
cd client
npm run dev
```

The app runs at `http://localhost:5173`.

### 3. Start both

From the repo root:

```bash
start-dev.bat
```

## Key Routes

### Player

- `/dashboard`
- `/profile`
- `/dashboard/matches`
- `/dashboard/submit-match`
- `/activity`
- `/leaderboard`
- `/head-to-head`

### Admin

- `/admin/dashboard`
- `/admin/profile`
- `/admin/users`
- `/admin/activity`
- `/admin/settings`
- `/admin/disputes`

## Security Notes

- Do not commit `server/.env`
- Use real MongoDB Atlas credentials only in local/private env files
- Passwords are hashed on the backend
- Admin routes are protected server-side

## Build Check

Frontend production build:

```bash
cd client
npm run build
```

Backend quick syntax check:

```bash
cd server
venv\Scripts\python.exe -m py_compile app\__init__.py
```
