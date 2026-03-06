require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');

const app = express();

// Security & parsing
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Rate limiting
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Swagger docs
try {
  const swaggerDoc = YAML.load(path.join(__dirname, '..', 'docs', 'openapi.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
} catch (e) {
  logger.warn('Swagger docs not loaded: ' + e.message);
}

// Routes
app.use('/api/v1', routes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`API docs: http://localhost:${PORT}/api-docs`);
  });
}

module.exports = app;
