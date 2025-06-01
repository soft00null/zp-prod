require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const errorHandler = require('./utils/errorHandler');
const logger = require('./utils/logger');

// Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase (this needs to happen before using any Firebase services)
logger.info('Initializing Firebase...');
require('./config/firebase');

// Import controllers after Firebase initialization
const webhookController = require('./controllers/webhookController');

// Middleware setup
app.use(bodyParser.json());

// Log all incoming requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    message: 'ZP Pune WhatsApp Bot is running!',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// WhatsApp webhook routes
app.get('/webhook', webhookController.verifyWebhook);
app.post('/webhook', webhookController.handleWebhook);

// Error handling
app.use(errorHandler);

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info('ZP Pune WhatsApp Bot v2.0 initialized successfully');
  logger.info('Features: Enhanced language detection, Citizen registration, Chat history');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});