const db = require('../config/database');
const reservationRepo = require('../repositories/reservationRepository');
const logger = require('../config/logger');

/**
 * Release all expired inventory reservations.
 * This job is idempotent: running it multiple times on the same
 * expired reservations is safe because:
 *  - We only target status = 'active' AND expires_at < NOW()
 *  - We use SKIP LOCKED to avoid double-processing in concurrent runs
 *  - GREATEST(0, ...) prevents negative reserved_quantity
 */
const releaseExpiredReservations = async () => {
  try {
    const count = await db.withTransaction(async (client) => {
      return reservationRepo.releaseExpired(client);
    });

    if (count > 0) {
      logger.info(`Released ${count} expired reservation(s)`);
    }

    return count;
  } catch (err) {
    logger.error('Error releasing expired reservations', { err });
    throw err;
  }
};

module.exports = { releaseExpiredReservations };
