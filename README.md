# 🎮 Cinnamoroll Jump Game

一个基于 Cinnamoroll 主题的多人在线跳一跳游戏，支持实时联机对战。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-14+-green.svg)

## 🌟 功能特性

- **多人联机**：支持 2-8 名玩家实时对战
- **断线重连**：游戏过程中断线可自动重连
- **再来一局**：游戏结束后可快速创建新房间邀请原班人马
- **精美的 UI**：毛玻璃效果、渐变色彩、流畅动画
- **实时状态同步**：使用 Socket.IO 实现实时数据同步
- **游戏记录**：自动保存游戏结果到数据库

## 📦 技术栈

- **后端**：
  - Node.js + Express
  - Socket.IO - 实时通信
  - better-sqlite3 - 数据库
  - bcryptjs - 密码加密

- **前端**：
  - HTML5 Canvas - 游戏渲染
  - CSS3 - UI 样式（毛玻璃效果）
  - Socket.IO Client - 实时通信

## 🚀 快速开始

### 环境要求

- Node.js 14.0 或更高版本
- npm 或 yarn

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd cinnamoroll-jump-game

# 安装依赖
npm install

# 启动服务器
npm start
```

服务器将在 `http://localhost:3000` 启动。

### 访问游戏

打开浏览器访问：`http://localhost:3000`

## 📖 使用说明

### 1. 注册/登录

首次访问需要注册账号，输入用户名和密码即可创建账户。

### 2. 创建房间

登录后点击"创建房间"，系统会生成一个 6 位房间号。

### 3. 邀请玩家

将房间号分享给朋友，他们可以在"加入房间"输入房间号加入游戏。

### 4. 开始游戏

所有玩家加入后，房主点击"开始游戏"即可开始。

### 5. 游戏玩法

- **蓄力**：按住鼠标左键蓄力
- **跳跃**：松开鼠标左键跳跃
- **目标**：跳到下一个平台上
- **生命**：每位玩家有 3 条命，掉落平台后失去一条命
- **胜利**：最后存活的玩家获胜

### 6. 断线重连

游戏过程中如果网络断开：
- 重新连接后会自动恢复游戏状态
- 如果在 5 秒内重连，可继续游戏
- 超时未重连将被淘汰

### 7. 再来一局

游戏结束后，房主点击"再来一局"：
- 创建新房间
- 自动邀请原班人马
- 其他玩家收到邀请后确认即可加入

## 📁 项目结构

```
workspace/
├── app.js              # 应用入口
├── server.js           # Socket.IO 服务器逻辑
├── package.json        # 项目配置
├── game.db             # SQLite 数据库
├── public/             # 前端文件
│   ├── index.html      # 登录/注册页面
│   ├── lobby.html      # 大厅页面
│   └── game.html       # 游戏页面
└── README.md           # 项目说明
```

## 🎮 游戏规则

### 平台生成

- 平台随机生成，距离在 80-150 之间
- 平台大小从 70 开始，每步递减 0.3，最小 45
- 平台高度在 25-45 之间随机
- 平台类型：方块 (60%) / 圆柱体 (40%)

### 跳跃判定

- 根据蓄力时间计算跳跃距离
- 落点在平台中心一定范围内算成功
- 完美跳跃：落点非常接近平台中心

### 淘汰规则

- 玩家生命值为 0 时被淘汰
- 断线超时未重连被淘汰
- 房主淘汰后，游戏继续，直到只剩一名玩家

## 🔧 配置说明

### 默认配置

```javascript
{
  PORT: 3000,                    // 服务器端口
  MAX_PLAYERS: 8,                // 最大玩家数
  JUMP_SPEED: 110,               // 跳跃速度
  INITIAL_LIVES: 3,              // 初始生命值
  RECONNECT_TIMEOUT: 5000,       // 重连超时时间（毫秒）
  PLATFORM_COUNT: 40             // 每局生成的平台数量
}
```

### 环境变量

可以通过环境变量覆盖默认配置：

```bash
PORT=8080 npm start
```

## 🛠️ 开发指南

### 数据库结构

#### users 表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### game_records 表

```sql
CREATE TABLE game_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  winner_id INTEGER NOT NULL,
  winner_name TEXT NOT NULL,
  players TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### API 接口

#### 注册

```
POST /api/register
Body: { username, password }
Response: { success: true/false, error? }
```

#### 登录

```
POST /api/login
Body: { username, password }
Response: { success: true/false, error?, token? }
```

### Socket.IO 事件

#### 客户端发送

| 事件 | 参数 | 说明 |
|------|------|------|
| create-room | - | 创建房间 |
| join-room | { code } | 加入房间 |
| leave-room | - | 离开房间 |
| start-game | - | 开始游戏 |
| jump | { power, direction } | 跳跃 |
| play-again | { code } | 再来一局 |
| rejoin-game | { code } | 重连游戏 |

#### 服务器发送

| 事件 | 参数 | 说明 |
|------|------|------|
| room-created | { code } | 房间创建成功 |
| room-joined | { room } | 加入房间成功 |
| room-updated | { room } | 房间状态更新 |
| game-started | { game, players } | 游戏开始 |
| game-state | { game } | 游戏状态同步 |
| turn-start | { playerIndex } | 回合开始 |
| jump-result | { success, game } | 跳跃结果 |
| player-eliminated | { playerId, rank } | 玩家淘汰 |
| game-over | { winner, rankings } | 游戏结束 |
| error | { message } | 错误信息 |

## 🔒 安全特性

- 密码使用 bcrypt 加密存储
- Session Token 验证
- 输入参数验证
- SQL 注入防护（使用参数化查询）

## 🐛 常见问题

### Q: 游戏过程中断线怎么办？
A: 重新刷新页面，系统会自动尝试重连游戏。

### Q: 房主断线后游戏会结束吗？
A: 不会，游戏会继续进行，直到只剩一名玩家。

### Q: 如何查看游戏记录？
A: 游戏记录保存在数据库中，可以通过直接访问 `game.db` 查看。

### Q: 支持手机浏览器吗？
A: 支持，但建议使用 PC 浏览器以获得最佳体验。

## 📄 License

MIT License

## 👥 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

如有问题或建议，欢迎通过 Issue 联系。

---

**享受游戏！🎉**
