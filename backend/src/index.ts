import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { HttpError, routes } from './routes';

try {
  process.loadEnvFile();
} catch {} // no .env in production; env comes from the host

const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim());

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: origins } });

// Clients join `list` (listing page) or `rfq:<id>` (details page). Broadcasts carry only the
// RFQ id; clients refetch over REST so role-based visibility is enforced in one place.
io.on('connection', (socket) => {
  socket.on('join', (room: unknown) => {
    if (typeof room === 'string' && /^(list|rfq:\d+)$/.test(room)) socket.join(room);
  });
  socket.on('leave', (room: unknown) => {
    if (typeof room === 'string') socket.leave(room);
  });
});

app.use(cors({ origin: origins }));
app.use(express.json());
app.use('/api', routes(io));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, issues: err.issues });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`API on :${port}`));
