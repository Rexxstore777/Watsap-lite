const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || 'chat.db';
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function registerUser(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    return { id: info.lastInsertRowid, username };
  } catch (e) {
    return null;
  }
}

function loginUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password)) return null;
  return { id: user.id, username: user.username };
}

function saveMessage(sender, receiver, type, content) {
  const info = db.prepare('INSERT INTO messages (sender, receiver, type, content) VALUES (?, ?, ?, ?)').run(sender, receiver, type, content);
  return { id: info.lastInsertRowid, sender, receiver, type, content, created_at: new Date().toISOString() };
}

function getHistory(userA, userB) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
    ORDER BY id ASC
  `).all(userA, userB, userB, userA);
}

function searchUsers(q) {
  return db.prepare('SELECT username FROM users WHERE username LIKE ? LIMIT 20').all(`%${q}%`);
}

module.exports = { registerUser, loginUser, saveMessage, getHistory, searchUsers };