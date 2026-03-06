const { createClient } = require('redis');
const logger = require('./logger');

let client;

const getRedisClient = async () => {
  if (client && client.isOpen) return client;

  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => logger.error('Redis Client Error', err));
  client.on('connect', () => logger.info('Redis connected'));

  await client.connect();
  return client;
};

module.exports = { getRedisClient };
