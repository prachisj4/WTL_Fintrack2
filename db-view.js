'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fintrack.db'));
db.pragma('wal_checkpoint(FULL)');

console.log('=== FINTRACK DATABASE TABLES & CONTENTS ===\n');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();

for (const t of tables) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get().c;
  console.log(`📌 Table: ${t.name.toUpperCase()} (${count} rows)`);
  const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
  if (rows.length) {
    console.table(rows);
  } else {
    console.log('   (No rows recorded yet)');
  }
  console.log('');
}
