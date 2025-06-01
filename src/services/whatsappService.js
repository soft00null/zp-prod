const axios = require('axios');
const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');

// Configure WhatsApp API client with enhanced configuration
const whatsappClient = axios.create({
  baseURL: 'https://graph.facebook.com/v18.0',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'User-Agent': 'ZP-Pune-Bot/2.0'
  },
  timeout: 30000, // 30 seconds timeout
  retry: 3, // Retry failed requests 3 times
});

// Add request interceptor for logging
whatsappClient.interceptors.request.use(
  (config) => {
    logger.debug(`WhatsApp API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    logger.error('WhatsApp API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
whatsappClient.interceptors.response.use(
  (response) => {
    logger.debug(`WhatsApp API Response: ${response.status} ${response.statusText}`);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    
    // Retry logic for rate limiting or temporary failures
    if (error.response?.status === 429 || error.response?.status >= 500) {
      if (!originalRequest._retry && originalRequest._retryCount < 3) {
        originalRequest._retry = true;
        originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
        
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, originalRequest._retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        logger.warn(`Retrying WhatsApp API request (attempt ${originalRequest._retryCount})`);
        return whatsappClient(originalRequest);
      }
    }
    
    logger.error('WhatsApp API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Collection for tracking message metrics
const metricsCollection = db.collection('messageMetrics');

// Rate limiting variables
const MESSAGE_LIMIT = 1000; // Messages per hour (WhatsApp Business API limit)
const INTERACTIVE_MESSAGE_LIMIT = 100; // Interactive messages per hour

// Fetch WhatsApp profile information with enhanced error handling
const getWhatsAppProfile = async (phoneNumber) => {
  try {
    logger.info(`Fetching WhatsApp profile for ${phoneNumber}`);
    
    const response = await whatsappClient.get(`/${phoneNumber}`, {
      params: {
        fields: 'id,name,profile_pic'
      }
    });
    
    const profileData = response.data;
    logger.info(`WhatsApp profile fetched successfully: ${JSON.stringify(profileData)}`);
    
    // Log profile fetch for analytics
    await logProfileFetch(phoneNumber, true, profileData);
    
    return {
      whatsappId: profileData.id || phoneNumber,
      displayName: profileData.name || null,
      profilePicture: profileData.profile_pic || null,
      phoneNumber: phoneNumber,
      fetchedAt: new Date().toISOString(),
      source: 'whatsapp_api'
    };
  } catch (error) {
    logger.warn(`Failed to fetch WhatsApp profile for ${phoneNumber}:`, error.response?.data || error.message);
    
    // Log failed profile fetch
    await logProfileFetch(phoneNumber, false, null, error.message);
    
    // Return basic info if profile fetch fails
    return {
      whatsappId: phoneNumber,
      displayName: null,
      profilePicture: null,
      phoneNumber: phoneNumber,
      fetchedAt: new Date().toISOString(),
      source: 'fallback'
    };
  }
};

// Get business phone number info with caching
const getBusinessPhoneInfo = async () => {
  try {
    // Check cache first
    const cacheKey = 'business_phone_info';
    const cachedInfo = await getCachedData(cacheKey);
    
    if (cachedInfo && cachedInfo.cachedAt > Date.now() - 3600000) { // 1 hour cache
      return cachedInfo.data;
    }
    
    const response = await whatsappClient.get(`/${process.env.PHONE_NUMBER_ID}`);
    const businessInfo = response.data;
    
    // Cache the result
    await setCachedData(cacheKey, businessInfo);
    
    return businessInfo;
  } catch (error) {
    logger.error('Error fetching business phone info:', error.response?.data || error.message);
    return null;
  }
};

// Send text message through WhatsApp API with enhanced features
const sendMessage = async (phoneNumberId, recipientNumber, message, options = {}) => {
  try {
    const startTime = Date.now();
    
    // Check rate limit
    if (!await checkRateLimit('text')) {
      logger.warn(`Rate limit exceeded, message not sent to ${recipientNumber}`);
      throw new Error('Rate limit exceeded');
    }
    
    // Validate inputs
    if (!phoneNumberId || !recipientNumber || !message) {
      throw new Error('Missing required parameters for sending message');
    }
    
    // Clean and validate phone number
    const cleanRecipient = cleanPhoneNumber(recipientNumber);
    
    // Split long messages if needed
    const messages = splitLongMessage(message);
    const messageResults = [];
    
    // Send each part with appropriate delay
    for (let i = 0; i < messages.length; i++) {
      const messagePart = messages[i];
      
      const messagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanRecipient,
        type: 'text',
        text: {
          preview_url: options.previewUrl || false,
          body: messagePart
        }
      };
      
      // Add context if provided
      if (options.context && i === 0) {
        messagePayload.context = {
          message_id: options.context.messageId
        };
      }
      
      const response = await whatsappClient.post(`/${phoneNumberId}/messages`, messagePayload);
      
      messageResults.push({
        messageId: response.data.messages?.[0]?.id,
        status: 'sent',
        part: i + 1,
        totalParts: messages.length
      });
      
      // Small delay between parts to maintain order
      if (messages.length > 1 && i < messages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const endTime = Date.now();
    
    // Log successful message delivery
    await logMessageSent(recipientNumber, message.length, 'outgoing', {
      messageResults,
      processingTime: endTime - startTime,
      parts: messages.length,
      options
    });
    
    logger.info(`Message sent successfully to ${recipientNumber} (${messages.length} parts)`);
    return {
      success: true,
      messageResults,
      totalParts: messages.length,
      processingTime: endTime - startTime
    };
    
  } catch (error) {
    // Log failed message attempt with detailed error info
    await logMessageError(recipientNumber, error.message || 'Unknown error', {
      errorCode: error.response?.data?.error?.code,
      errorType: error.response?.data?.error?.type,
      errorDetails: error.response?.data?.error?.error_data
    });
    
    logger.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw new Error(`Failed to send WhatsApp message: ${error.message}`);
  }
};

// Send interactive message (buttons/list) with enhanced features
const sendInteractiveMessage = async (phoneNumberId, recipientNumber, interactiveData, options = {}) => {
  try {
    const startTime = Date.now();
    
    // Check rate limit for interactive messages
    if (!await checkRateLimit('interactive')) {
      logger.warn(`Interactive message rate limit exceeded for ${recipientNumber}`);
      throw new Error('Interactive message rate limit exceeded');
    }
    
    // Validate interactive data
    if (!validateInteractiveData(interactiveData)) {
      throw new Error('Invalid interactive message data');
    }
    
    const cleanRecipient = cleanPhoneNumber(recipientNumber);
    
    const messagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanRecipient,
      type: 'interactive',
      interactive: {
        ...interactiveData,
        // Add metadata
        ...options.metadata && { metadata: options.metadata }
      }
    };
    
    // Add context if provided
    if (options.context) {
      messagePayload.context = {
        message_id: options.context.messageId
      };
    }
    
    const response = await whatsappClient.post(`/${phoneNumberId}/messages`, messagePayload);
    const endTime = Date.now();
    
    const messageResult = {
      messageId: response.data.messages?.[0]?.id,
      status: 'sent',
      type: 'interactive',
      interactiveType: interactiveData.type
    };
    
    // Log interactive message
    await logMessageSent(recipientNumber, JSON.stringify(interactiveData).length, 'outgoing', {
      messageResult,
      processingTime: endTime - startTime,
      interactiveType: interactiveData.type,
      options
    });
    
    logger.info(`Interactive message sent successfully to ${recipientNumber}`);
    return {
      success: true,
      messageResult,
      processingTime: endTime - startTime
    };
    
  } catch (error) {
    await logMessageError(recipientNumber, error.message || 'Unknown error', {
      messageType: 'interactive',
      errorCode: error.response?.data?.error?.code,
      errorType: error.response?.data?.error?.type
    });
    
    logger.error('Error sending interactive message:', error.response?.data || error.message);
    throw new Error(`Failed to send interactive message: ${error.message}`);
  }
};

// Send template message (for notifications)
const sendTemplateMessage = async (phoneNumberId, recipientNumber, templateData) => {
  try {
    const cleanRecipient = cleanPhoneNumber(recipientNumber);
    
    const messagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanRecipient,
      type: 'template',
      template: templateData
    };
    
    const response = await whatsappClient.post(`/${phoneNumberId}/messages`, messagePayload);
    
    logger.info(`Template message sent to ${recipientNumber}`);
    return {
      success: true,
      messageId: response.data.messages?.[0]?.id
    };
    
  } catch (error) {
    logger.error('Error sending template message:', error.response?.data || error.message);
    throw new Error(`Failed to send template message: ${error.message}`);
  }
};

// Mark message as read
const markMessageAsRead = async (phoneNumberId, messageId) => {
  try {
    await whatsappClient.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    });
    
    logger.debug(`Message ${messageId} marked as read`);
    return true;
  } catch (error) {
    logger.error('Error marking message as read:', error.response?.data || error.message);
    return false;
  }
};

// Validate interactive message data
const validateInteractiveData = (data) => {
  if (!data || !data.type) return false;
  
  switch (data.type) {
    case 'button':
      return data.body && data.action && data.action.buttons && Array.isArray(data.action.buttons);
    case 'list':
      return data.body && data.action && data.action.sections && Array.isArray(data.action.sections);
    default:
      return false;
  }
};

// Clean phone number (remove special characters, ensure proper format)
const cleanPhoneNumber = (phoneNumber) => {
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add country code if missing (assuming India +91)
  if (!cleaned.startsWith('91') && cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  
  return cleaned;
};

// Check and enforce rate limits using Firestore with separate limits
const checkRateLimit = async (messageType = 'text') => {
  try {
    const limitKey = messageType === 'interactive' ? 'interactiveRateLimit' : 'textRateLimit';
    const limit = messageType === 'interactive' ? INTERACTIVE_MESSAGE_LIMIT : MESSAGE_LIMIT;
    
    const rateLimitRef = metricsCollection.doc(limitKey);
    const rateLimitDoc = await rateLimitRef.get();
    
    const now = Date.now();
    let messageCount = 0;
    let resetTime = now + 3600000; // Default: 1 hour from now
    
    if (rateLimitDoc.exists) {
      const data = rateLimitDoc.data();
      messageCount = data.messageCount || 0;
      resetTime = data.resetTime || resetTime;
    }
    
    // Reset counter if an hour has passed
    if (now > resetTime) {
      messageCount = 0;
      resetTime = now + 3600000;
    }
    
    // Check if limit exceeded
    if (messageCount >= limit) {
      logger.warn(`${messageType} message rate limit exceeded: ${messageCount}/${limit}`);
      return false;
    }
    
    // Increment counter
    await rateLimitRef.set({
      messageCount: messageCount + 1,
      resetTime,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      messageType
    });
    
    return true;
  } catch (error) {
    logger.error('Error checking rate limit:', error);
    // Allow sending in case of error with rate limiting
    return true;
  }
};

// Log successful message delivery
const logMessageSent = async (recipientNumber, messageLength, direction = 'outgoing', metadata = {}) => {
  try {
    const currentDate = getCurrentDate();
    const dailyStatsRef = metricsCollection.doc(`daily_${currentDate}`);
    
    // Update daily stats atomically
    await dailyStatsRef.set({
      messagesSent: admin.firestore.FieldValue.increment(1),
      totalCharactersSent: admin.firestore.FieldValue.increment(messageLength),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      date: currentDate
    }, { merge: true });
    
    // Log individual message for detailed analysis
    await metricsCollection.doc('messages').collection('sent').add({
      recipient: recipientNumber,
      length: messageLength,
      direction: direction,
      metadata: metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: currentDate,
      hour: new Date().getHours()
    });
    
    // Update hourly stats for better analytics
    const hourlyStatsRef = metricsCollection.doc(`hourly_${currentDate}_${new Date().getHours()}`);
    await hourlyStatsRef.set({
      messagesSent: admin.firestore.FieldValue.increment(1),
      hour: new Date().getHours(),
      date: currentDate,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
  } catch (error) {
    logger.error('Error logging message metrics:', error);
  }
};

// Log message errors with detailed information
const logMessageError = async (recipientNumber, errorMessage, errorDetails = {}) => {
  try {
    const currentDate = getCurrentDate();
    
    await metricsCollection.doc('errors').collection('messages').add({
      recipient: recipientNumber,
      error: errorMessage,
      errorDetails: errorDetails,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: currentDate,
      hour: new Date().getHours()
    });
    
    // Update error count in daily stats
    await metricsCollection.doc(`daily_${currentDate}`).set({
      messageErrors: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
  } catch (error) {
    logger.error('Error logging message error:', error);
  }
};

// Log profile fetch attempts
const logProfileFetch = async (phoneNumber, success, profileData, errorMessage = null) => {
  try {
    await metricsCollection.doc('profileFetches').collection('attempts').add({
      phoneNumber,
      success,
      profileData,
      errorMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: getCurrentDate()
    });
  } catch (error) {
    logger.error('Error logging profile fetch:', error);
  }
};

// Cache management functions
const getCachedData = async (key) => {
  try {
    const cacheDoc = await db.collection('cache').doc(key).get();
    return cacheDoc.exists ? cacheDoc.data() : null;
  } catch (error) {
    logger.error('Error getting cached data:', error);
    return null;
  }
};

const setCachedData = async (key, data, ttl = 3600000) => { // Default 1 hour TTL
  try {
    await db.collection('cache').doc(key).set({
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttl
    });
  } catch (error) {
    logger.error('Error setting cached data:', error);
  }
};

// Helper to get current date in YYYY-MM-DD format
const getCurrentDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Split long messages (WhatsApp has a limit of 4096 characters)
const splitLongMessage = (message) => {
  const MAX_LENGTH = 4000; // Setting below 4096 for safety
  
  if (message.length <= MAX_LENGTH) {
    return [message];
  }
  
  const parts = [];
  let currentPart = '';
  
  // Split by paragraphs first
  const paragraphs = message.split('\n\n');
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds the limit
    if (currentPart.length + paragraph.length + 2 > MAX_LENGTH) {
      if (currentPart.length > 0) {
        parts.push(currentPart.trim());
        currentPart = '';
      }
      
      // If paragraph itself is too long, split by sentences
      if (paragraph.length > MAX_LENGTH) {
        const sentences = paragraph.split(/(?<=[.!?।])\s+/);
        
        for (const sentence of sentences) {
          if (currentPart.length + sentence.length + 1 > MAX_LENGTH) {
            if (currentPart.length > 0) {
              parts.push(currentPart.trim());
              currentPart = '';
            }
            
            // If sentence itself is too long, split by words
            if (sentence.length > MAX_LENGTH) {
              const words = sentence.split(' ');
              for (const word of words) {
                if (currentPart.length + word.length + 1 > MAX_LENGTH) {
                  if (currentPart.length > 0) {
                    parts.push(currentPart.trim());
                    currentPart = word;
                  } else {
                    // If single word is too long, split it
                    parts.push(word.substring(0, MAX_LENGTH));
                    currentPart = word.substring(MAX_LENGTH);
                  }
                } else {
                  currentPart += (currentPart.length > 0 ? ' ' : '') + word;
                }
              }
            } else {
              currentPart = sentence;
            }
          } else {
            currentPart += (currentPart.length > 0 ? ' ' : '') + sentence;
          }
        }
      } else {
        currentPart = paragraph;
      }
    } else {
      currentPart += (currentPart.length > 0 ? '\n\n' : '') + paragraph;
    }
  }
  
  // Add the last part if not empty
  if (currentPart.length > 0) {
    parts.push(currentPart.trim());
  }
  
  // Add part indicators for multi-part messages
  if (parts.length > 1) {
    parts.forEach((part, index) => {
      parts[index] = `${part}\n\n📝 (${index + 1}/${parts.length})`;
    });
  }
  
  return parts;
};

// Get message delivery status
const getMessageStatus = async (messageId) => {
  try {
    const response = await whatsappClient.get(`/${messageId}`);
    return response.data;
  } catch (error) {
    logger.error('Error getting message status:', error.response?.data || error.message);
    return null;
  }
};

// Cleanup old cache entries
const cleanupCache = async () => {
  try {
    const now = Date.now();
    const cacheSnapshot = await db.collection('cache').where('expiresAt', '<', now).get();
    
    const batch = db.batch();
    let deleteCount = 0;
    
    cacheSnapshot.forEach(doc => {
      batch.delete(doc.ref);
      deleteCount++;
    });
    
    if (deleteCount > 0) {
      await batch.commit();
      logger.info(`Cleaned up ${deleteCount} expired cache entries`);
    }
  } catch (error) {
    logger.error('Error cleaning up cache:', error);
  }
};

// Run cache cleanup every hour
setInterval(cleanupCache, 3600000);

// Export all functions
module.exports = {
  sendMessage,
  sendInteractiveMessage,
  sendTemplateMessage,
  markMessageAsRead,
  getWhatsAppProfile,
  getBusinessPhoneInfo,
  getMessageStatus,
  cleanPhoneNumber,
  splitLongMessage
};