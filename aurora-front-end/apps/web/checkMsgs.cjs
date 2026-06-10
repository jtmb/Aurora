const Database = require('better-sqlite3');
const db = new Database('aurora.db', { readonly: true });
const rows = db.prepare("SELECT id, role, content, thinking, model FROM messages WHERE role='assistant' AND (content LIKE '%<%' OR content LIKE '%```create_file%' OR content LIKE '%```replace_string%' OR content LIKE '%```read_file%' OR content LIKE '%```run_in_terminal%') ORDER BY timestamp DESC LIMIT 3").all();
for (const r of rows) {
  console.log('===', r.id, '===');
  console.log('THINKING:', r.thinking ? r.thinking.slice(0, 300) : 'NONE');
  console.log('CONTENT LEN:', r.content.length);
  console.log('CONTENT (first 1500):', r.content.slice(0, 1500));
  console.log('=== END ===\n');
}
db.close();
