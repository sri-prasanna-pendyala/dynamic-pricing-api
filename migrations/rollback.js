require('dotenv').config();
const { pool } = require('../src/config/database');

async function rollback() {
  const client = await pool.connect();
  const tables = [
    'order_items','orders','inventory_reservations',
    'cart_items','carts','pricing_rules','variants',
    'products','categories',
  ];
  try {
    for (const t of tables) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
      console.log(`Dropped ${t}`);
    }
    await client.query(`DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE`);
    console.log('✅ Rollback complete');
  } finally {
    client.release();
    await pool.end();
  }
}

rollback();
