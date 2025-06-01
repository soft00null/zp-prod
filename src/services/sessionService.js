const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');

// Clean up old chat messages (older than 30 days)
const cleanupOldChats = async () => {
  try {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - 30);
    
    const citizensSnapshot = await db.collection('citizens').get();
    
    const batch = db.batch();
    let batchCount = 0;
    
    for (const citizenDoc of citizensSnapshot.docs) {
      const chatsSnapshot = await citizenDoc.ref
        .collection('chats')
        .where('timestamp', '<', cutoffTime)
        .get();
      
      chatsSnapshot.forEach(chatDoc => {
        batch.delete(chatDoc.ref);
        batchCount++;
      });
      
      // Commit batch if it gets too large
      if (batchCount >= 450) { // Firestore batch limit is 500
        await batch.commit();
        const newBatch = db.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }
    
    logger.info(`Cleaned up ${batchCount} old chat messages`);
    return true;
  } catch (error) {
    logger.error('Error cleaning up old chats:', error);
    return false;
  }
};

// Run cleanup every 24 hours
setInterval(async () => {
  await cleanupOldChats();
}, 24 * 60 * 60 * 1000);

module.exports = {
  cleanupOldChats
};