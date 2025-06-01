const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');
const openaiService = require('./openaiService');
const whatsappService = require('./whatsappService');
const stateManager = require('./stateManagerService');
const geocodingService = require('./geocodingService');

// Collection reference
const citizensCollection = db.collection('citizens');

// Get or create citizen (updated for simplified registration)
const getOrCreateCitizen = async (whatsappNumber, whatsappProfile = null) => {
  try {
    const citizenDoc = await citizensCollection.doc(whatsappNumber).get();
    
    if (citizenDoc.exists) {
      const citizenData = citizenDoc.data();
      
      const updateData = {
        lastActive: admin.firestore.FieldValue.serverTimestamp()
      };
      
      if (whatsappProfile) {
        if (whatsappProfile.displayName && whatsappProfile.displayName !== citizenData.whatsappDisplayName) {
          updateData.whatsappDisplayName = whatsappProfile.displayName;
        }
        if (whatsappProfile.whatsappId && whatsappProfile.whatsappId !== citizenData.whatsappId) {
          updateData.whatsappId = whatsappProfile.whatsappId;
        }
        if (whatsappProfile.profilePicture && whatsappProfile.profilePicture !== citizenData.profilePicture) {
          updateData.profilePicture = whatsappProfile.profilePicture;
        }
      }
      
      await citizensCollection.doc(whatsappNumber).update(updateData);
      
      return {
        ...citizenData,
        ...updateData,
        lastActive: Date.now()
      };
    }
    
    // UPDATED: Create new citizen record with simplified fields
    const newCitizen = {
      whatsappNumber,
      whatsappId: whatsappProfile?.whatsappId || whatsappNumber,
      whatsappDisplayName: whatsappProfile?.displayName || null,
      profilePicture: whatsappProfile?.profilePicture || null,
      
      isRegistered: false,
      
      // SIMPLIFIED: Only name and village data
      whatsappName: whatsappProfile?.displayName || null,
      userProvidedName: null,
      phoneNumber: whatsappNumber,
      village: null,
      coordinates: null, // NEW: Store geocoded coordinates
      taluka: null, // NEW: Store administrative info
      district: 'Pune', // Default district
      
      preferredLanguage: null,
      registrationStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActive: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await citizensCollection.doc(whatsappNumber).set(newCitizen);
    
    // Create initial state
    await stateManager.createStateRecord(whatsappNumber, 'initial', {
      language: null,
      sessionId: `${whatsappNumber}_${Date.now()}`
    });
    
    logger.info(`Created new citizen record for ${whatsappNumber}`);
    return {
      ...newCitizen,
      registrationStartedAt: Date.now(),
      createdAt: Date.now(),
      lastActive: Date.now()
    };
  } catch (error) {
    logger.error(`Error getting/creating citizen for ${whatsappNumber}:`, error);
    throw error;
  }
};

// UPDATED: Simplified registration processing with geocoding
const processRegistrationWithFunctionCalling = async (whatsappNumber, message, language, phoneNumberId, citizenData) => {
  try {
    let currentState = await stateManager.getCurrentState(whatsappNumber);
    
    if (!currentState) {
      currentState = await stateManager.createStateRecord(whatsappNumber, 'awaiting_name', {
        language,
        sessionId: `${whatsappNumber}_${Date.now()}`
      });
    }

    logger.info(`Processing simplified registration for ${whatsappNumber}, current state: ${currentState.stateId}`);

    // Handle initial state
    if (currentState.stateId === 'initial') {
      const welcomeResponse = getWelcomeMessage(language, citizenData.whatsappDisplayName);
      
      await stateManager.completeStateTransition(whatsappNumber, currentState, {}, 'awaiting_name');
      
      return {
        shouldContinue: false,
        response: welcomeResponse,
        functionCallResults: null
      };
    }

    // Use OpenAI Function Calling to process the registration
    const functionResults = await openaiService.processRegistrationWithFunctions(
      message, 
      currentState.stateId, 
      language, 
      citizenData
    );

    logger.info(`Function calling results: ${JSON.stringify(functionResults)}`);

    // Check for geocoding errors
    if (functionResults.geocodingError) {
      // Village validation failed
      await stateManager.updateStateWithFunctionResults(whatsappNumber, currentState, functionResults);
      
      return {
        shouldContinue: false,
        response: functionResults.geocodingError,
        functionCallResults: functionResults
      };
    }

    // Store function call results
    const updateSuccess = await stateManager.updateStateWithFunctionResults(whatsappNumber, currentState, functionResults);
    await stateManager.storeFunctionCallResultInSubcollection(whatsappNumber, currentState.stateId, functionResults);

    if (!updateSuccess) {
      logger.warn(`Failed to update state with function results for ${whatsappNumber}`);
    }

    // Process based on function calling results
    if (functionResults.shouldTransition && functionResults.extractedData && functionResults.confidence > 0.7) {
      
      // Update citizen data with extracted information
      await updateCitizenDataFromFunctions(whatsappNumber, currentState.stateId, functionResults.extractedData);

      // Handle registration completion
      if (functionResults.nextState === 'completed') {
        await completeRegistration(whatsappNumber, currentState);
        
        const completionMessage = getRegistrationCompleteMessage(
          language, 
          citizenData.userProvidedName || citizenData.whatsappDisplayName,
          functionResults.extractedData.validated_village || functionResults.extractedData.village_name
        );
        
        return {
          shouldContinue: true,
          response: completionMessage,
          functionCallResults: functionResults
        };
      } else {
        // Normal state transition
        await stateManager.completeStateTransition(whatsappNumber, currentState, functionResults.extractedData, functionResults.nextState);
        
        // Generate contextual response
        const contextualResponse = await openaiService.generateContextualResponseWithFunctions(
          {
            currentState: functionResults.nextState,
            previousData: functionResults.extractedData,
            stateAnalysis: functionResults.stateAnalysis
          },
          language,
          citizenData
        );
        
        return {
          shouldContinue: false,
          response: contextualResponse || getDefaultPromptForState(functionResults.nextState, language),
          functionCallResults: functionResults
        };
      }
    } else {
      // Function calling determined user didn't provide required data or confidence too low
      const clarificationResponse = await openaiService.generateContextualResponseWithFunctions(
        {
          currentState: currentState.stateId,
          needsClarification: true,
          stateAnalysis: functionResults.stateAnalysis,
          confidence: functionResults.confidence
        },
        language,
        citizenData
      );
      
      return {
        shouldContinue: false,
        response: clarificationResponse || getRetryPromptForState(currentState.stateId, language),
        functionCallResults: functionResults
      };
    }

  } catch (error) {
    logger.error('Error processing registration with function calling:', error);
    return {
      shouldContinue: false,
      response: language === 'mr' 
        ? 'क्षमस्व, तांत्रिक समस्या आहे. कृपया पुन्हा प्रयत्न करा.'
        : 'Sorry, technical issue. Please try again.',
      functionCallResults: null
    };
  }
};

// UPDATED: Update citizen data with geocoding information
const updateCitizenDataFromFunctions = async (whatsappNumber, stateId, extractedData) => {
  try {
    let updateData = {};

    switch (stateId) {
      case 'awaiting_name':
        if (extractedData.full_name) {
          updateData.userProvidedName = extractedData.full_name;
        }
        break;
      case 'awaiting_village':
        if (extractedData.village_name) {
          updateData.village = extractedData.validated_village || extractedData.village_name;
          
          // Store geocoding information
          if (extractedData.coordinates) {
            updateData.coordinates = extractedData.coordinates;
            updateData.latitude = extractedData.coordinates.latitude;
            updateData.longitude = extractedData.coordinates.longitude;
          }
          
          if (extractedData.taluka) {
            updateData.taluka = extractedData.taluka;
          }
          
          if (extractedData.geocoding) {
            updateData.geocodingInfo = {
              formattedAddress: extractedData.geocoding.formattedAddress,
              placeId: extractedData.geocoding.placeId,
              administrative: extractedData.geocoding.administrative,
              confidence: extractedData.geocoding.confidence,
              geocodedAt: extractedData.geocoding.geocodedAt
            };
          }
        }
        break;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
      await citizensCollection.doc(whatsappNumber).update(updateData);
      
      logger.info(`Updated citizen data for ${whatsappNumber}: ${JSON.stringify(updateData)}`);
    }
  } catch (error) {
    logger.error('Error updating citizen data from functions:', error);
  }
};

// UPDATED: Welcome message for simplified registration
const getWelcomeMessage = (language, whatsappName) => {
  if (language === 'mr') {
    return `🙏 नमस्कार ${whatsappName ? whatsappName + ' जी' : 'मित्रा'}!

मी पुणे जिल्हा परिषदेचा आधिकारिक सहाय्यक आहे. आपण येथे आल्याबद्दल मला खूप आनंद झाला! 😊

आपली सेवा करण्यापूर्वी, मला फक्त 2 माहिती हवी:
1️⃣ आपले पूर्ण नाव
2️⃣ आपले गाव (पुणे जिल्ह्यातील)

${whatsappName ? `WhatsApp वर आपले नाव "${whatsappName}" दिसते आहे, पण पुष्टीसाठी` : 'कृपया'} आपले पूर्ण नाव सांगाल का?

(उदाहरण: राम शंकर पाटील)`;
  } else {
    return `🙏 Hello ${whatsappName ? whatsappName + ' Sir/Madam' : 'Dear Friend'}!

I am the official assistant of Pune Zilla Panchayat. I'm delighted that you've reached out to us! 😊

Before I can assist you, I need just 2 pieces of information:
1️⃣ Your full name
2️⃣ Your village (within Pune district)

${whatsappName ? `I can see your name as "${whatsappName}" on WhatsApp, but for confirmation` : 'Please'} could you please tell me your full name?

(Example: Ram Shankar Patil)`;
  }
};

// UPDATED: Registration complete message with village info
const getRegistrationCompleteMessage = (language, name, village) => {
  return language === 'mr'
    ? `🎉 अभिनंदन ${name} जी! आपली नोंदणी यशस्वीरित्या पूर्ण झाली आहे.

📍 नोंदणीकृत माहिती:
• नाव: ${name}
• गाव: ${village}
• जिल्हा: पुणे

आता आपण पुणे जिल्हा परिषदेच्या कोणत्याही सेवा, योजना किंवा माहितीबद्दल मला प्रश्न विचारू शकता. मी आपली सेवा करण्यास तत्पर आहे! 😊

काय मदत करू?`
    : `🎉 Congratulations ${name}! Your registration has been completed successfully.

📍 Registered Information:
• Name: ${name}
• Village: ${village}
• District: Pune

Now you can ask me any questions about Pune Zilla Panchayat services, schemes, or information. I'm here to serve you! 😊

How can I help you?`;
};

// UPDATED: Default prompts for simplified states
const getDefaultPromptForState = (stateId, language) => {
  const prompts = {
    mr: {
      'awaiting_name': 'कृपया आपले पूर्ण नाव सांगा.',
      'awaiting_village': 'कृपया आपले गाव सांगा (पुणे जिल्ह्यातील).'
    },
    en: {
      'awaiting_name': 'Please tell me your full name.',
      'awaiting_village': 'Please tell me your village name (within Pune district).'
    }
  };
  
  return prompts[language]?.[stateId] || prompts.en[stateId] || 'Please provide the required information.';
};

const getRetryPromptForState = (stateId, language) => {
  const prompts = {
    mr: {
      'awaiting_name': 'क्षमस्व, कृपया आपले स्पष्ट आणि पूर्ण नाव लिहा.',
      'awaiting_village': 'क्षमस्व, कृपया पुणे जिल्ह्यातील योग्य गाव नाव लिहा.'
    },
    en: {
      'awaiting_name': 'Sorry, please write your clear and full name.',
      'awaiting_village': 'Sorry, please provide a valid village name from Pune district.'
    }
  };
  
  return prompts[language]?.[stateId] || prompts.en[stateId] || 'Please try again with clear information.';
};

// ... (previous code continues)

// Keep other existing functions
const searchKnowledgeBaseWithFunctions = async (query, language) => {
  try {
    const searchResults = await openaiService.searchKnowledgeWithFunctions(query, language);
    
    if (searchResults) {
      logger.info(`Knowledge base search with functions: ${JSON.stringify(searchResults)}`);
      return searchResults;
    }
    
    return null;
  } catch (error) {
    logger.error('Error searching knowledge base with functions:', error);
    return null;
  }
};

const updateCitizenData = async (whatsappNumber, field, value) => {
  try {
    await citizensCollection.doc(whatsappNumber).update({
      [field]: value,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    logger.info(`Updated ${field} for ${whatsappNumber}: ${value}`);
  } catch (error) {
    logger.error('Error updating citizen data:', error);
  }
};

const completeRegistration = async (whatsappNumber, currentState) => {
  try {
    await citizensCollection.doc(whatsappNumber).update({
      isRegistered: true,
      registrationCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await stateManager.completeStateTransition(whatsappNumber, currentState, {}, 'completed');
    
    logger.info(`Registration completed for ${whatsappNumber}`);
  } catch (error) {
    logger.error('Error completing registration:', error);
  }
};

// Enhanced chat message saving with proper timestamp handling
const saveChatMessage = async (whatsappNumber, role, content, language, messageData = {}) => {
  try {
    const currentState = await stateManager.getCurrentState(whatsappNumber);
    
    const chatData = {
      role,
      content,
      language,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      
      // Enhanced state information
      currentState: currentState ? {
        stateId: currentState.stateId,
        stateName: currentState.stateName,
        attempts: currentState.attempts
      } : null,
      
      // Function calling metadata with proper timestamp
      functionCallResults: messageData.functionCallResults ? {
        ...messageData.functionCallResults,
        savedAt: new Date().toISOString(),
        confidence: messageData.functionCallResults.confidence || null
      } : null,
      
      // Message details
      messageId: messageData.messageId || null,
      messageType: messageData.messageType || 'text',
      
      // Sender/Receiver details
      sender: role === 'user' ? {
        whatsappNumber: whatsappNumber,
        whatsappId: messageData.senderWhatsappId || whatsappNumber,
        displayName: messageData.senderDisplayName || null
      } : {
        businessPhoneId: process.env.PHONE_NUMBER_ID,
        botName: 'ZP Pune Assistant',
        operator: 'system'
      },
      
      receiver: role === 'user' ? {
        businessPhoneId: process.env.PHONE_NUMBER_ID,
        botName: 'ZP Pune Assistant',
        operator: 'system'
      } : {
        whatsappNumber: whatsappNumber,
        whatsappId: messageData.receiverWhatsappId || whatsappNumber,
        displayName: messageData.receiverDisplayName || null
      },
      
      // Enhanced metadata
      metadata: {
        userAgent: messageData.userAgent || null,
        platform: 'whatsapp',
        apiVersion: 'v18.0',
        sessionId: messageData.sessionId || null,
        processingTime: messageData.processingTime || null,
        functionCalling: messageData.functionCallResults ? true : false,
        confidence: messageData.functionCallResults?.confidence || null,
        timestamp: new Date().toISOString(),
        currentDateTime: '2025-06-01 10:11:58',
        currentUser: 'soft00null'
      }
    };
    
    await citizensCollection
      .doc(whatsappNumber)
      .collection('chats')
      .add(chatData);
    
    return true;
  } catch (error) {
    logger.error(`Error saving chat for ${whatsappNumber}:`, error);
    return false;
  }
};

const getChatHistory = async (whatsappNumber, limit = 10) => {
  try {
    const chatsSnapshot = await citizensCollection
      .doc(whatsappNumber)
      .collection('chats')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const chats = [];
    chatsSnapshot.forEach(doc => {
      const data = doc.data();
      chats.push({
        id: doc.id,
        role: data.role,
        content: data.content,
        language: data.language,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
        currentState: data.currentState,
        functionCallResults: data.functionCallResults,
        sender: data.sender,
        receiver: data.receiver,
        messageType: data.messageType || 'text'
      });
    });
    
    return chats.reverse();
  } catch (error) {
    logger.error(`Error getting chat history for ${whatsappNumber}:`, error);
    return [];
  }
};

module.exports = {
  getOrCreateCitizen,
  processRegistrationWithFunctionCalling,
  searchKnowledgeBaseWithFunctions,
  saveChatMessage,
  getChatHistory
};