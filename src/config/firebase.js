const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Load the service account key
let serviceAccount;
try {
  serviceAccount = require('../../serviceaccount.json');
} catch (error) {
  logger.error('Failed to load service account file:', error);
  process.exit(1);
}

// Initialize Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  logger.info('Firebase initialized successfully');
} catch (error) {
  logger.error('Error initializing Firebase:', error);
  process.exit(1); // Exit the application if Firebase initialization fails
}

// Get Firestore instance
const db = admin.firestore();

// Configure Firestore settings
db.settings({
  ignoreUndefinedProperties: true
});

// Export both admin and db
module.exports = {
  admin,
  db
};