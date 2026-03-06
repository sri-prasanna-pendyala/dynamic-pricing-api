require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ecommerce_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function migrate(direction = 'up') {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (direction === 'up') {
      for (const file of files) {
        const { rows } = await client.query(
          'SELECT id FROM schema_migrations WHERE filename = $1', [file]
        );
        if (rows.length === 0) {
          console.log(`Applying migration: ${file}`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)', [file]
          );
          console.log(`✓ Applied: ${file}`);
        } else {
          console.log(`Skipping (already applied): ${file}`);
        }
      }
    } else {
      console.log('Dropping all tables...');
      await client.query(`
        DROP SCHEMA public CASCADE;
        CREATE SCHEMA public;
        GRANT ALL ON SCHEMA public TO postgres;
        GRANT ALL ON SCHEMA public TO public;
      `);
      console.log('✓ Database reset complete');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const direction = process.argv[2] === 'down' ? 'down' : 'up';
migrate(direction)
  .then(() => { console.log('Migration complete'); process.exit(0); })
  .catch(err => { console.error('Migration failed:', err); process.exit(1); });
