import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import multer from 'multer';
import { readStore, writeStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.SESSION_SECRET || 'change-this-secret-before-public-deployment';
const MAX_FILE = 10 * 1024 * 1024;
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex')
});
const makeToken = (user) => {
  const body = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
};
function tokenUser(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    const store = readStore();
    return store.users.find(u => u.id === payload.id) || null;
  } catch { return null; }
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = tokenUser(token);
  if (!user) return res.status(401).json({ error: 'لطفاً دوباره وارد حساب شو.' });
  req.user = user;
  next();
}
function publicUser(user) { return { id: user.id, username: user.username, createdAt: user.createdAt }; }
function error(res, status, message) { return res.status(status).json({ error: message }); }

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Gaming.Chat' }));
app.post('/api/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) return error(res, 400, 'نام کاربری باید ۳ تا ۲۴ حرف یا عدد باشد.');
  if (password.length < 8 || password.length > 128) return error(res, 400, 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
  const store = readStore();
  if (store.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return error(res, 409, 'این نام کاربری قبلاً ثبت شده است.');
  let id;
  do { id = String(crypto.randomInt(10000000, 100000000)); } while (store.users.some(u => u.id === id));
  const pass = hashPassword(password);
  const user = { id, username, salt: pass.salt, passwordHash: pass.hash, createdAt: new Date().toISOString() };
  store.users.push(user); writeStore(store);
  res.json({ token: makeToken(user), user: publicUser(user) });
});
app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const store = readStore();
  const user = store.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return error(res, 401, 'نام کاربری یا رمز عبور اشتباه است.');
  const candidate = crypto.scryptSync(password, user.salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex'); const b = Buffer.from(user.passwordHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return error(res, 401, 'نام کاربری یا رمز عبور اشتباه است.');
  res.json({ token: makeToken(user), user: publicUser(user) });
});
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/users/:id', auth, (req, res) => {
  if (!/^\d{8}$/.test(req.params.id)) return error(res, 400, 'شناسه باید ۸ رقم باشد.');
  const user = readStore().users.find(u => u.id === req.params.id);
  if (!user) return error(res, 404, 'کاربری با این شناسه پیدا نشد.');
  res.json({ user: publicUser(user) });
});
app.get('/api/messages/:id', auth, (req, res) => {
  const otherId = String(req.params.id);
  const store = readStore();
  if (!store.users.some(u => u.id === otherId)) return error(res, 404, 'کاربر پیدا نشد.');
  const messages = store.messages.filter(m => (m.from === req.user.id && m.to === otherId) || (m.from === otherId && m.to === req.user.id)).slice(-300);
  res.json({ messages });
});
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12)}`)
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE } });
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return error(res, 400, 'فایلی انتخاب نشده است.');
  res.json({ file: { name: req.file.originalname, url: `/uploads/${req.file.filename}`, size: req.file.size } });
});

const online = new Map();
io.use((socket, next) => {
  const user = tokenUser(socket.handshake.auth?.token);
  if (!user) return next(new Error('ورود نامعتبر است'));
  socket.user = publicUser(user); next();
});
io.on('connection', socket => {
  socket.join(`user:${socket.user.id}`);
  online.set(socket.user.id, (online.get(socket.user.id) || 0) + 1);
  io.emit('presence', { id: socket.user.id, online: true });
  socket.on('private:send', payload => {
    const to = String(payload?.to || '');
    const text = String(payload?.text || '').trim();
    const file = payload?.file && typeof payload.file === 'object' ? payload.file : null;
    if (!/^\d{8}$/.test(to) || (!text && !file) || text.length > 4000) return;
    const store = readStore();
    if (to === socket.user.id || !store.users.some(u => u.id === to)) return;
    const message = { id: crypto.randomUUID(), from: socket.user.id, to, text, file, createdAt: new Date().toISOString() };
    store.messages.push(message); if (store.messages.length > 10000) store.messages = store.messages.slice(-10000); writeStore(store);
    socket.emit('private:message', message);
    io.to(`user:${to}`).emit('private:message', message);
  });
  socket.on('disconnect', () => {
    const count = (online.get(socket.user.id) || 1) - 1;
    if (count <= 0) { online.delete(socket.user.id); io.emit('presence', { id: socket.user.id, online: false }); }
    else online.set(socket.user.id, count);
  });
});

app.get('*path', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`Gaming.Chat listening on ${PORT}`));
