const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- SQLite ----
const db = new Database(path.join(__dirname, 'game.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS game_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT,
    winner_id INTEGER,
    winner_name TEXT,
    players TEXT,
    rounds INTEGER,
    elimination_order TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ---- In-memory State ----
const sessions = new Map();
const rooms = new Map();

// ---- Constants ----
const JUMP_SPEED = 110;
const MAX_PLAYERS = 8;
const COLORS = ['#B8E8F8','#FFD1DC','#FFF5E6','#D4E6F1','#E8D5F5','#FDEBD3','#A8E6CF','#FFE0B2'];

// ---- Auth Routes ----
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });
  if (username.length < 2 || username.length > 16) return res.status(400).json({ error: '用户名需2-16个字符' });
  if (password.length < 3) return res.status(400).json({ error: '密码至少3个字符' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, { id: r.lastInsertRowid, username });
    res.json({ success: true, token, user: { id: r.lastInsertRowid, username } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '用户名或密码错误' });
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { id: user.id, username: user.username });
  res.json({ success: true, token, user: { id: user.id, username: user.username } });
});

app.post('/api/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const s = sessions.get(token);
  if (!s) return res.status(401).json({ error: '未登录' });
  res.json({ user: s });
});

// ---- Helpers ----
function genCode() {
  let c; do { c = String(Math.floor(Math.random() * 900000) + 100000); } while (rooms.has(c));
  return c;
}

function genPlatforms(count) {
  count = count || 40;
  const p = [{ x: 0, y: 0, size: 70, height: 40, color: '#B8E8F8', type: 'box' }];
  let lx = 0, ly = 0;
  // 保持一个大致的前进方向，避免平台走向混乱
  let baseAngle = Math.random() * Math.PI * 2;
  for (let i = 1; i < count; i++) {
    // 距离在80-150之间波动，不随索引递增
    const dist = 80 + Math.random() * 70;
    // 角度在基准方向上偏转-60到+60度，保持大致方向一致
    const angleOffset = (Math.random() - 0.5) * Math.PI / 1.5;
    const ang = baseAngle + angleOffset;
    // 偶尔改变基准方向（每5-8个平台改变一次）
    if (i % 7 === 0) {
      baseAngle += (Math.random() - 0.5) * Math.PI;
    }
    // 平台大小缓慢递减，从70开始，每步减少0.3，最小45
    const sz = Math.max(45, 70 - i * 0.3);
    // 高度在25-45之间随机
    const h = 25 + Math.random() * 20;
    lx += Math.cos(ang) * dist;
    ly += Math.sin(ang) * dist;
    p.push({ x: lx, y: ly, size: sz, height: h, color: COLORS[i % COLORS.length], type: Math.random() > 0.6 ? 'cylinder' : 'box' });
  }
  return p;
}

function sanitize(room) {
  return {
    code: room.code,
    host: room.host,
    hostName: room.hostName,
    status: room.status,
    players: room.players.map(p => ({ id: p.id, username: p.username, isAlive: p.isAlive, lives: p.lives })),
    currentPlayerIndex: room.currentPlayerIndex,
    game: room.game ? { currentPlatformIndex: room.game.currentPlatformIndex, platforms: room.game.platforms } : null,
    winner: room.winner,
  };
}

function nextAlive(room) {
  let i = (room.currentPlayerIndex + 1) % room.players.length;
  const s = i;
  do { if (room.players[i].isAlive) return i; i = (i + 1) % room.players.length; } while (i !== s);
  return i;
}

function ensurePlatforms(game) {
  while (game.currentPlatformIndex + 5 >= game.platforms.length) {
    const last = game.platforms[game.platforms.length - 1];
    const n = game.platforms.length;
    // 使用相同的基准角度逻辑，保持连续性
    let baseAngle = Math.atan2(last.y - (game.platforms.length > 1 ? game.platforms[game.platforms.length - 2].y : 0),
                               last.x - (game.platforms.length > 1 ? game.platforms[game.platforms.length - 2].x : 0));
    if (game.platforms.length === 1) {
      baseAngle = Math.random() * Math.PI * 2;
    }
    
    for (let j = 0; j < 10; j++) {
      const dist = 80 + Math.random() * 70;
      const angleOffset = (Math.random() - 0.5) * Math.PI / 1.5;
      const ang = baseAngle + angleOffset;
      if ((n + j) % 7 === 0) {
        baseAngle += (Math.random() - 0.5) * Math.PI;
      }
      const sz = Math.max(45, 70 - (n + j) * 0.3);
      const h = 25 + Math.random() * 20;
      game.platforms.push({
        x: last.x + Math.cos(ang) * dist, y: last.y + Math.sin(ang) * dist,
        size: sz, height: h, color: COLORS[(n + j) % COLORS.length], type: Math.random() > 0.6 ? 'cylinder' : 'box'
      });
    }
  }
}

// ---- Socket.io Auth ----
io.use((socket, next) => {
  const t = socket.handshake.auth.token;
  const s = sessions.get(t);
  if (!s) return next(new Error('未登录'));
  socket.user = s;
  next();
});

io.on('connection', (socket) => {
  socket.on('create-room', () => {
    const code = genCode();
    const room = {
      code, host: socket.user.id, hostName: socket.user.username,
      players: [{ id: socket.user.id, username: socket.user.username, socketId: socket.id, isAlive: true, lives: 3 }],
      status: 'waiting', game: null, currentPlayerIndex: 0, winner: null, eliminationOrder: [],
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', sanitize(room));
  });

  socket.on('join-room', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('error', '房间不存在');
    if (room.status !== 'waiting') return socket.emit('error', '游戏已开始，无法加入');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('error', '房间已满');
    if (room.players.find(p => p.id === socket.user.id)) return socket.emit('error', '你已在房间中');
    
    room.players.push({ id: socket.user.id, username: socket.user.username, socketId: socket.id, isAlive: true, lives: 3 });
    socket.join(code);
    
    socket.emit('room-joined', sanitize(room));
    io.to(code).emit('room-updated', sanitize(room));
  });

  socket.on('rejoin-game', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      return socket.emit('error', '房间不存在');
    }
    
    const p = room.players.find(p => p.id === socket.user.id);
    if (!p) {
      return socket.emit('error', '你不在该房间中');
    }
    
    p.socketId = socket.id;
    p.disconnectedAt = null; // 清除断开时间标记
    socket.join(code);
    
    if (room.status === 'playing' || room.status === 'finished') {
      socket.emit('game-state', sanitize(room));
      if (room.status === 'playing') {
        socket.emit('turn-start', { playerIndex: room.currentPlayerIndex, player: { id: room.players[room.currentPlayerIndex].id, username: room.players[room.currentPlayerIndex].username } });
      }
    } else {
      socket.emit('room-updated', sanitize(room));
    }
  });

  socket.on('leave-room', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    const pi = room.players.findIndex(p => p.id === socket.user.id);
    if (pi === -1) return;
    if (room.status === 'playing') {
      room.players[pi].isAlive = false;
      const alive = room.players.filter(p => p.isAlive);
      if (alive.length <= 1) {
        room.status = 'finished';
        room.winner = alive[0] ? { id: alive[0].id, username: alive[0].username } : null;
        io.to(code).emit('game-over', sanitize(room));
        saveRecord(room);
      } else {
        if (room.players[room.currentPlayerIndex].id === socket.user.id) {
          room.currentPlayerIndex = nextAlive(room);
          io.to(code).emit('turn-start', { playerIndex: room.currentPlayerIndex, player: { id: room.players[room.currentPlayerIndex].id, username: room.players[room.currentPlayerIndex].username } });
        }
        io.to(code).emit('game-state', sanitize(room));
      }
    } else {
      room.players.splice(pi, 1);
      if (room.players.length === 0) { rooms.delete(code); }
      else {
        if (room.host === socket.user.id) { room.host = room.players[0].id; room.hostName = room.players[0].username; }
        io.to(code).emit('room-updated', sanitize(room));
      }
    }
    socket.leave(code);
  });

  socket.on('start-game', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.user.id) return socket.emit('error', '只有房主可以开始');
    if (room.players.length < 2) return socket.emit('error', '至少需要2名玩家');

    room.status = 'playing';
    room.currentPlayerIndex = 0;
    room.game = { platforms: genPlatforms(), currentPlatformIndex: 0 };
    room.players.forEach(p => { p.isAlive = true; p.lives = 3; });
    room.winner = null;
    room.eliminationOrder = [];
    io.to(code).emit('game-started', sanitize(room));
    setTimeout(() => {
      io.to(code).emit('turn-start', { playerIndex: 0, player: { id: room.players[0].id, username: room.players[0].username } });
    }, 600);
  });

  socket.on('jump', ({ code, chargeTime }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    const cp = room.players[room.currentPlayerIndex];
    if (!cp || cp.id !== socket.user.id || !cp.isAlive) return;
    const g = room.game;
    const curr = g.platforms[g.currentPlatformIndex];
    const next = g.platforms[g.currentPlatformIndex + 1];
    if (!next) return;

    const jd = chargeTime * JUMP_SPEED;
    const dx = next.x - curr.x, dy = next.y - curr.y;
    const rd = Math.sqrt(dx * dx + dy * dy);
    const tol = next.size * 0.45;
    const ok = Math.abs(jd - rd) <= tol;

    if (ok) {
      g.currentPlatformIndex++;
      ensurePlatforms(g);
      const ni = nextAlive(room);
      room.currentPlayerIndex = ni;
      io.to(code).emit('jump-result', {
        success: true, player: { id: cp.id, username: cp.username },
        jumpDistance: jd, requiredDistance: rd, newPlatformIndex: g.currentPlatformIndex,
        nextPlayerIndex: ni, nextPlayer: { id: room.players[ni].id, username: room.players[ni].username },
        gameOver: false, game: sanitize(room).game,
      });
    } else {
      // 扣除生命值
      cp.lives--;
      if (cp.lives <= 0) {
        // 生命值耗尽，淘汰玩家
        cp.isAlive = false;
        // 记录淘汰顺序
        room.eliminationOrder.push({ id: cp.id, username: cp.username, eliminatedAt: g.currentPlatformIndex });
      }
      
      const alive = room.players.filter(p => p.isAlive);
      if (alive.length <= 1) {
        room.status = 'finished';
        room.winner = alive[0] ? { id: alive[0].id, username: alive[0].username } : null;
        io.to(code).emit('jump-result', {
          success: false, player: { id: cp.id, username: cp.username, lives: cp.lives },
          jumpDistance: jd, requiredDistance: rd,
          eliminated: cp.lives <= 0 ? { id: cp.id, username: cp.username } : null,
          gameOver: true, winner: room.winner,
          eliminationOrder: room.eliminationOrder,
          alivePlayers: room.players.map(p => ({ id: p.id, username: p.username, isAlive: p.isAlive, lives: p.lives })),
          game: sanitize(room).game,
        });
        saveRecord(room);
      } else {
        const ni = nextAlive(room);
        room.currentPlayerIndex = ni;
        io.to(code).emit('jump-result', {
          success: false, player: { id: cp.id, username: cp.username, lives: cp.lives },
          jumpDistance: jd, requiredDistance: rd,
          eliminated: cp.lives <= 0 ? { id: cp.id, username: cp.username } : null,
          gameOver: false,
          eliminationOrder: room.eliminationOrder,
          nextPlayerIndex: ni, nextPlayer: { id: room.players[ni].id, username: room.players[ni].username },
          alivePlayers: room.players.map(p => ({ id: p.id, username: p.username, isAlive: p.isAlive, lives: p.lives })),
          game: sanitize(room).game,
        });
      }
    }
  });

  socket.on('play-again', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.user.id) return socket.emit('error', '只有房主可以再来一局');
    
    // 保存当前房间的所有玩家ID（不包括房主socketId，房主会重新连接）
    const playerIds = room.players.map(p => ({ id: p.id, username: p.username, socketId: p.socketId }));
    
    // 删除旧房间
    rooms.delete(code);
    
    // 创建新房间，但房主还未加入（socketId设为null，房主通过join-room加入）
    const newCode = genCode();
    const newRoom = {
      code: newCode, 
      host: socket.user.id, 
      hostName: socket.user.username,
      players: [], // 房主稍后通过join-room加入
      status: 'waiting', 
      game: null, 
      currentPlayerIndex: 0, 
      winner: null, 
      eliminationOrder: [],
      invitedPlayers: playerIds.filter(p => p.id !== socket.user.id) // 保存被邀请的玩家
    };
    rooms.set(newCode, newRoom);
    
    // 发送新房间创建事件给房主
    socket.emit('play-again-created', { code: newCode, invitedPlayers: newRoom.invitedPlayers });
    
    // 通知其他玩家被邀请
    newRoom.invitedPlayers.forEach(player => {
      if (player.socketId) {
        io.to(player.socketId).emit('play-again-invite', { 
          from: socket.user.username,
          roomCode: newCode
        });
      }
    });
  });

  socket.on('disconnect', () => {
    const userId = socket.user.id;
    const username = socket.user.username;
    
    for (const [code, room] of rooms.entries()) {
      const pi = room.players.findIndex(p => p.id === userId);
      if (pi === -1) continue;
      
      // 更新 socketId 为空，标记断开时间
      room.players[pi].socketId = null;
      room.players[pi].disconnectedAt = Date.now();
      
      // 延迟处理断开逻辑，给玩家重新连接的机会
      const roomCode = code;
      const disconnectTime = Date.now();
      
      setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r) return;
        
        const p = r.players.find(p => p.id === userId);
        if (!p) return;
        
        // 检查玩家是否已经重新连接（socketId 不为空且是新的连接）
        if (p.socketId) {
          return;
        }
        
        // 检查断开时间是否更新过（说明有新的断开事件）
        if (p.disconnectedAt !== disconnectTime) {
          return;
        }
        
        // 玩家没有重新连接，执行断开逻辑
        const idx = r.players.findIndex(p => p.id === userId);
        if (idx === -1) return;
        
        if (r.status === 'playing') {
          r.players[idx].isAlive = false;
          const alive = r.players.filter(p => p.isAlive);
          if (alive.length <= 1) {
            r.status = 'finished';
            r.winner = alive[0] ? { id: alive[0].id, username: alive[0].username } : null;
            io.to(roomCode).emit('game-over', sanitize(r));
            saveRecord(r);
          } else {
            if (r.players[r.currentPlayerIndex].id === userId) {
              r.currentPlayerIndex = nextAlive(r);
              io.to(roomCode).emit('turn-start', { playerIndex: r.currentPlayerIndex, player: { id: r.players[r.currentPlayerIndex].id, username: r.players[r.currentPlayerIndex].username } });
            }
            // 发送游戏状态更新
            io.to(roomCode).emit('game-state', sanitize(r));
          }
        } else if (r.status === 'waiting') {
          // 只在等待状态时才移除玩家
          r.players.splice(idx, 1);
          if (r.players.length === 0) {
            rooms.delete(roomCode);
          } else {
            if (r.host === userId) {
              r.host = r.players[0].id;
              r.hostName = r.players[0].username;
            }
            io.to(roomCode).emit('room-updated', sanitize(r));
          }
        }
      }, 5000); // 增加到5秒延迟
      break;
    }
  });
});

function saveRecord(room) {
  if (room.winner) {
    db.prepare('INSERT INTO game_records (room_code,winner_id,winner_name,players,rounds,elimination_order) VALUES (?,?,?,?,?,?)').run(
      room.code, room.winner.id, room.winner.username,
      JSON.stringify(room.players.map(p => p.username)),
      room.game ? room.game.currentPlatformIndex : 0,
      JSON.stringify(room.eliminationOrder || [])
    );
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`跳一跳服务器运行在端口 ${PORT}`));
