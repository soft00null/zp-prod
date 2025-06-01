const langdetect = require('langdetect');
const logger = require('./logger');
let openaiService;

// Import openaiService lazily to avoid circular dependencies
const getOpenAIService = () => {
  if (!openaiService) {
    openaiService = require('../services/openaiService');
  }
  return openaiService;
};

// Map language codes to our supported languages
const mapLanguageCode = (code) => {
  if (code === 'mr' || code === 'hi') {
    return 'mr';  // Treat Hindi as Marathi since langdetect may confuse them
  }
  return 'en';  // Default to English for all other languages
};

// Detect language using langdetect library first
const detectWithLibrary = (text) => {
  try {
    const detections = langdetect.detect(text);
    if (detections && detections.length > 0) {
      const lang = detections[0].lang;
      return mapLanguageCode(lang);
    }
  } catch (error) {
    logger.warn('Error detecting language with library:', error);
  }
  return null;
};

// Detect language from text using multiple methods
const detectLanguage = async (text) => {
  try {
    // First try with the library (faster)
    const libraryDetection = detectWithLibrary(text);
    if (libraryDetection) {
      return libraryDetection;
    }
    
    // If library fails, use OpenAI (more accurate but slower)
    const openAIService = getOpenAIService();
    const openaiDetection = await openAIService.detectMessageLanguage(text);
    return openaiDetection;
  } catch (error) {
    logger.error('Error detecting language:', error);
    return 'en';  // Default to English in case of errors
  }
};

module.exports = {
  detectLanguage
};