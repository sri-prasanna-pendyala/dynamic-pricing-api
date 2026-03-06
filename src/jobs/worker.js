require('dotenv').config();
const { Queue, Worker, QueueScheduler } = require('bullmq');
const { releaseExpiredReservations } = require('./reservationCleanup');
const logger = require('../config/logger');

const QUEUE_NAME = 'inventory-maintenance';
const CLEANUP_JOB = 'release-expired-reservations';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

// Queue for scheduling jobs
const queue = new Queue(QUEUE_NAME, { connection });

// Worker processes jobs
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === CLEANUP_JOB) {
      const count = await releaseExpiredReservations();
      return { released: count, timestamp: new Date().toISOString() };
    }
  },
  { connection, concurrency: 1 }
);

worker.on('completed', (job, result) => {
  logger.info(`Job ${job.name} completed`, { result });
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.name} failed`, { err: err.message });
});

// Schedule the cleanup to run every minute
async function scheduleJobs() {
  // Remove existing repeatable jobs to avoid duplicates on restart
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    CLEANUP_JOB,
    {},
    {
      repeat: { every: 60_000 }, // every 60 seconds
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info(`Scheduled "${CLEANUP_JOB}" every 60 seconds`);
}

scheduleJobs().catch((err) => {
  logger.error('Failed to schedule jobs', { err });
  process.exit(1);
});

logger.info('Background worker started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await queue.close();
  logger.info('Worker shut down gracefully');
  process.exit(0);
});
