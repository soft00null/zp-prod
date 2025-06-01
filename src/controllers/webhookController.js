const whatsappService = require('../services/whatsappService');
const citizenService = require('../services/citizenService');
const openaiService = require('../services/openaiService');
const knowledgeBaseService = require('../services/knowledgeBaseService');
const languageDetector = require('../utils/languageDetector');
const stateManager = require('../services/stateManagerService');
const logger = require('../utils/logger');
const { admin } = require('../config/firebase');

// Verify webhook for WhatsApp API
const verifyWebhook = (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    
    logger.warn('Webhook verification failed');
    return res.sendStatus(403);
  } catch (error) {
    logger.error('Error verifying webhook:', error);
    return res.sendStatus(500);
  }
};

// Handle incoming webhook messages
const handleWebhook = async (req, res) => {
  try {
    // Return 200 OK early to acknowledge receipt
    res.status(200).send('OK');
    
    if (req.body.object === 'whatsapp_business_account') {
      if (req.body.entry && req.body.entry.length > 0) {
        const entry = req.body.entry[0];
        
        if (entry.changes && entry.changes.length > 0) {
          const change = entry.changes[0];
          
          if (change.value && change.value.messages && change.value.messages.length > 0) {
            await processMessage(change.value.messages[0], change.value.metadata, change.value.contacts);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error handling webhook:', error);
  }
};

// Enhanced message processing with simplified registration
const processMessage = async (message, metadata, contacts = []) => {
  const startTime = Date.now();
  
  try {
    const phoneNumberId = metadata.phone_number_id;
    const from = message.from;
    
    // Extract WhatsApp profile information
    const contact = contacts?.find(c => c.wa_id === from);
    const whatsappProfile = contact ? {
      whatsappId: contact.wa_id,
      displayName: contact.profile?.name || null,
      phoneNumber: from
    } : null;

    // Fetch profile if not in webhook
    let profileInfo = whatsappProfile;
    if (!profileInfo || !profileInfo.displayName) {
      try {
        profileInfo = await whatsappService.getWhatsAppProfile(from);
      } catch (error) {
        logger.warn('Could not fetch WhatsApp profile, using basic info');
        profileInfo = { whatsappId: from, displayName: null, phoneNumber: from };
      }
    }
    
    logger.info(`[${new Date().toISOString()}] Processing message from ${from} (${profileInfo?.displayName || 'Unknown'})`);
    
    // Handle message types
    let messageText = '';
    let messageType = message.type;
    
    switch (message.type) {
      case 'text':
        messageText = message.text.body;
        break;
        
      case 'interactive':
        const interactiveData = message.interactive;
        messageText = getInteractiveResponseText(interactiveData);
        break;
        
      case 'button':
        messageText = message.button.text || message.button.payload;
        break;
        
      default:
        const unsupportedMessage = profileInfo?.displayName 
          ? `Dear ${profileInfo.displayName}, I can only process text messages. Please send your query in text format. / प्रिय ${profileInfo.displayName}, मी फक्त मजकूर संदेश प्रक्रिया करू शकतो. कृपया आपला प्रश्न मजकूर स्वरूपात पाठवा.`
          : 'I can only process text messages. Please send your query in text format. / मी फक्त मजकूर संदेश प्रक्रिया करू शकतो. कृपया आपला प्रश्न मजकूर स्वरूपात पाठवा.';
        
        await whatsappService.sendMessage(phoneNumberId, from, unsupportedMessage);
        return;
    }

    if (!messageText) {
      logger.warn(`Empty message received from ${from}`);
      return;
    }

    // Detect language with AI
    const messageLanguage = await languageDetector.detectLanguage(messageText);
    logger.info(`Detected language: ${messageLanguage} for message: ${messageText}`);

    // Get or create citizen record
    const citizenData = await citizenService.getOrCreateCitizen(from, profileInfo);
    
    // Enhanced message data with function calling context
    const messageData = {
      messageId: message.id,
      messageType: messageType,
      senderWhatsappId: profileInfo?.whatsappId,
      senderDisplayName: profileInfo?.displayName,
      receiverWhatsappId: process.env.PHONE_NUMBER_ID,
      receiverDisplayName: 'ZP Pune Assistant',
      processingTime: Date.now() - startTime,
      sessionId: `${from}_${new Date().getDate()}`,
      language: messageLanguage,
      timestamp: new Date().toISOString(),
      currentDateTime: '2025-06-01 10:11:58',
      currentUser: 'soft00null'
    };
    
    // Save user message
    await citizenService.saveChatMessage(from, 'user', messageText, messageLanguage, messageData);
    
    // Process based on registration status with simplified Function Calling
    if (!citizenData.isRegistered) {
      let registrationResult;
      
      logger.info(`User not registered. Processing with simplified Function Calling system (Name + Village only).`);
      
      // Process with simplified Function Calling (only name and village)
      registrationResult = await citizenService.processRegistrationWithFunctionCalling(
        from,
        messageText,
        messageLanguage,
        phoneNumberId,
        citizenData
      );
      
      // Send registration response
      if (registrationResult.response) {
        await whatsappService.sendMessage(phoneNumberId, from, registrationResult.response);
        
        // Enhanced message data with function call results
        const botMessageData = { 
          ...messageData, 
          receiverWhatsappId: from, 
          senderWhatsappId: process.env.PHONE_NUMBER_ID,
          functionCallResults: registrationResult.functionCallResults,
          confidence: registrationResult.functionCallResults?.confidence || null
        };
        
        // Save bot response
        await citizenService.saveChatMessage(
          from, 
          'assistant', 
          registrationResult.response, 
          messageLanguage,
          botMessageData
        );
      }
      
      // Continue if registration complete
      if (!registrationResult.shouldContinue) {
        return;
      }
    }

    // Handle regular conversation for registered users with Function Calling
    logger.info(`User registered. Processing regular conversation with Function Calling.`);
    
    // Get conversation history
    const chatHistory = await citizenService.getChatHistory(from, 8);
    const conversationHistory = chatHistory.map(chat => ({
      role: chat.role,
      content: chat.content
    }));

    // Search knowledge base with Function Calling if needed
    let relevantInfo = '';
    const knowledgeSearchResult = await citizenService.searchKnowledgeBaseWithFunctions(messageText, messageLanguage);
    
    if (knowledgeSearchResult) {
      // Use enhanced file search
      const fileSearchResult = await knowledgeBaseService.searchWithFileSearch(
        knowledgeSearchResult.query, 
        messageLanguage,
        {
          category: knowledgeSearchResult.category,
          maxResults: 3
        }
      );
      
      relevantInfo = fileSearchResult.response || '';
      logger.info(`Knowledge base search completed: ${fileSearchResult.method}, confidence: ${fileSearchResult.confidence}`);
    }
    
    // Generate AI response with Function Calling
    const aiResponse = await openaiService.generateResponseWithFunctions(
      messageText,
      conversationHistory,
      messageLanguage,
      relevantInfo,
      citizenData,
      {
        knowledgeSearchResult,
        userState: 'registered',
        sessionInfo: {
          sessionId: messageData.sessionId,
          messageCount: chatHistory.length
        },
        currentDateTime: '2025-06-01 10:11:58',
        currentUser: 'soft00null'
      }
    );
    
    // Send response
    await whatsappService.sendMessage(phoneNumberId, from, aiResponse);
    
    // Enhanced bot response data
    const botResponseData = {
      ...messageData,
      receiverWhatsappId: profileInfo?.whatsappId,
      receiverDisplayName: profileInfo?.displayName,
      senderWhatsappId: process.env.PHONE_NUMBER_ID,
      senderDisplayName: 'ZP Pune Assistant',
      knowledgeSearchUsed: !!relevantInfo,
      functionCallingUsed: true,
      knowledgeSearchResult: knowledgeSearchResult
    };
    
    // Save bot response
    await citizenService.saveChatMessage(
      from, 
      'assistant', 
      aiResponse, 
      messageLanguage,
      botResponseData
    );
    
  } catch (error) {
    logger.error('Error processing message:', error);
    
    // Send enhanced fallback message
    try {
      const fallbackMessage = generateFallbackMessage(error, profileInfo?.displayName);
      await whatsappService.sendMessage(
        metadata.phone_number_id,
        message.from,
        fallbackMessage
      );
    } catch (sendError) {
      logger.error('Failed to send fallback message:', sendError);
    }
  }
};

// Generate contextual fallback message
const generateFallbackMessage = (error, userName) => {
  const name = userName ? ` ${userName}` : '';
  
  if (error.message?.includes('rate limit')) {
    return `🙏 Dear${name}, I'm currently experiencing high traffic. Please try again in a few minutes. / प्रिय${name}, सध्या जास्त गर्दी आहे. कृपया काही मिनिटांनी पुन्हा प्रयत्न करा.`;
  }
  
  if (error.message?.includes('network') || error.message?.includes('timeout')) {
    return `🙏 Dear${name}, I'm having connectivity issues. Please try again shortly. / प्रिय${name}, मला कनेक्टिव्हिटी समस्या आहे. कृपया लवकरच पुन्हा प्रयत्न करा.`;
  }
  
  if (error.message?.includes('geocoding') || error.message?.includes('village')) {
    return `🙏 Dear${name}, I'm having trouble locating the village. Please provide a valid village name from Pune district. / प्रिय${name}, मला गाव शोधण्यात अडचण येत आहे. कृपया पुणे जिल्ह्यातील योग्य गाव नाव द्या.`;
  }
  
  return `🙏 Dear${name}, I'm very sorry, I'm having some technical difficulties. Please try again in a moment. / प्रिय${name}, मी खूप क्षमस्व, मला काही तांत्रिक अडचणी येत आहेत. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.`;
};

// Extract text from interactive responses
const getInteractiveResponseText = (interactiveData) => {
  switch (interactiveData.type) {
    case 'button_reply':
      return interactiveData.button_reply.title || interactiveData.button_reply.id;
    case 'list_reply':
      return interactiveData.list_reply.title || interactiveData.list_reply.id;
    default:
      return '';
  }
};

module.exports = {
  verifyWebhook,
  handleWebhook
};