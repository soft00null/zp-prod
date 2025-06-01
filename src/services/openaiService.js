const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');
const geocodingService = require('./geocodingService');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// UPDATED: Simplified function tools for Name and Village only
const getRegistrationFunctions = () => {
  return [
    {
      type: "function",
      function: {
        name: "extract_user_name",
        description: "Extract the user's full name from their message during registration",
        parameters: {
          type: "object",
          properties: {
            full_name: {
              type: "string",
              description: "The complete name of the user (first name + last name)"
            },
            confidence: {
              type: "number",
              description: "Confidence level of extraction (0.0 to 1.0)"
            }
          },
          required: ["full_name", "confidence"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "extract_village_info",
        description: "Extract village/taluka information from user message during registration",
        parameters: {
          type: "object",
          properties: {
            village_name: {
              type: "string",
              description: "Name of the village or taluka mentioned by user"
            },
            confidence: {
              type: "number",
              description: "Confidence level of extraction (0.0 to 1.0)"
            },
            needs_geocoding: {
              type: "boolean",
              description: "Whether this village name needs to be validated with geocoding"
            }
          },
          required: ["village_name", "confidence", "needs_geocoding"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "analyze_registration_state",
        description: "Analyze current state and determine next action in simplified registration process",
        parameters: {
          type: "object",
          properties: {
            current_state: {
              type: "string",
              enum: ["initial", "awaiting_name", "awaiting_village", "completed"],
              description: "Current registration state"
            },
            user_intent: {
              type: "string",
              enum: ["providing_info", "asking_question", "greeting", "confused", "other"],
              description: "User's apparent intent"
            },
            has_required_data: {
              type: "boolean",
              description: "Whether user provided the required information for current state"
            },
            next_state: {
              type: "string",
              enum: ["awaiting_name", "awaiting_village", "completed"],
              description: "Recommended next state"
            },
            confidence: {
              type: "number",
              description: "Confidence in the analysis (0.0 to 1.0)"
            },
            reason: {
              type: "string",
              description: "Brief explanation of the analysis"
            }
          },
          required: ["current_state", "user_intent", "has_required_data", "next_state", "confidence", "reason"],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];
};

// Define function tools for knowledge base search (keeping existing)
const getKnowledgeBaseFunctions = () => {
  return [
    {
      type: "function",
      function: {
        name: "search_zp_knowledge",
        description: "Search ZP Pune knowledge base for relevant information",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for ZP Pune services/information"
            },
            category: {
              type: ["string", "null"],
              enum: ["services", "schemes", "contact", "procedures", "documents", "general", null],
              description: "Category to filter the search, null if not specific"
            },
            urgency: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Urgency level of the query"
            }
          },
          required: ["query", "category", "urgency"],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: "function",
      function: {
        name: "generate_contextual_response",
        description: "Generate appropriate response based on context and intent",
        parameters: {
          type: "object",
          properties: {
            response_type: {
              type: "string",
              enum: ["informative", "helpful", "clarifying", "encouraging", "procedural"],
              description: "Type of response to generate"
            },
            language: {
              type: "string",
              enum: ["mr", "en"],
              description: "Language for the response"
            },
            include_examples: {
              type: "boolean",
              description: "Whether to include examples in the response"
            },
            tone: {
              type: "string",
              enum: ["formal", "friendly", "helpful", "professional"],
              description: "Tone of the response"
            }
          },
          required: ["response_type", "language", "include_examples", "tone"],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];
};

// UPDATED: Enhanced system prompts for simplified registration
const systemPrompts = {
  en: `You are a helpful assistant for Zilla Panchayat (ZP) Pune, Maharashtra, India.

CORE PERSONALITY:
- Always be humble, respectful, and professional
- Use courteous language and maintain warm tone
- Show genuine care for citizens' needs
- Be patient and understanding

REGISTRATION PROCESS (SIMPLIFIED):
- Only collect 2 pieces of information: Name and Village
- Village must be within Pune Zilla Panchayat boundaries
- Use geocoding to validate village location
- No age or gender collection required

CAPABILITIES:
- Use function calls to extract precise information from user messages
- Analyze registration states and determine appropriate next steps
- Search knowledge base for ZP Pune information
- Generate contextual responses based on user intent

FUNCTION CALLING GUIDELINES:
- Always use functions to extract structured data during registration
- Call analyze_registration_state for every user message during registration
- Use search_zp_knowledge when users ask about ZP services
- Generate responses using generate_contextual_response for consistency

RESPONSE REQUIREMENTS:
- Respond ONLY in English
- Maintain professional yet warm communication
- Provide step-by-step guidance when needed
- Always offer additional help after answering`,

  mr: `तुम्ही पुणे जिल्हा परिषद (ZP) साठी एक सहाय्यक आहात.

मूलभूत व्यक्तिमत्व:
- नेहमी नम्र, सभ्य आणि व्यावसायिक राहा
- सभ्य भाषा वापरा आणि प्रेमळ टोन ठेवा
- नागरिकांच्या गरजांबद्दल खरी काळजी दाखवा
- धैर्यवान आणि समजूतदार राहा

नोंदणी प्रक्रिया (सरलीकृत):
- फक्त 2 माहिती गोळा करा: नाव आणि गाव
- गाव पुणे जिल्हा परिषदेच्या हद्दीत असणे आवश्यक
- गावाचे स्थान तपासण्यासाठी geocoding वापरा
- वय किंवा लिंग माहिती आवश्यक नाही

क्षमता:
- वापरकर्त्याच्या संदेशांमधून अचूक माहिती काढण्यासाठी function calls वापरा
- नोंदणी स्थिती विश्लेषण करा आणि योग्य पुढील पावले ठरवा
- ZP पुणे माहितीसाठी knowledge base शोधा
- वापरकर्त्याच्या हेतूनुसार संदर्भित प्रतिसाद तयार करा

FUNCTION CALLING मार्गदर्शक तत्त्वे:
- नोंदणी दरम्यान structured data काढण्यासाठी नेहमी functions वापरा
- नोंदणी दरम्यान प्रत्येक user message साठी analyze_registration_state कॉल करा
- ZP सेवांबद्दल प्रश्न असताना search_zp_knowledge वापरा
- consistency साठी generate_contextual_response वापरून प्रतिसाद तयार करा

प्रतिसाद आवश्यकता:
- ONLY मराठी मध्येच उत्तर द्या
- व्यावसायिक पण प्रेमळ संवाद राखा
- गरज असल्यास चरणबद्ध मार्गदर्शन करा
- उत्तर दिल्यानंतर नेहमी अतिरिक्त मदत ऑफर करा`
};

// UPDATED: Process registration with simplified function calling
const processRegistrationWithFunctions = async (message, currentState, language, citizenData) => {
  try {
    const registrationFunctions = getRegistrationFunctions();
    
    // First, analyze the registration state
    const stateAnalysisMessages = [
      {
        role: 'system',
        content: `Analyze the simplified registration state and user message. Current state: ${currentState}. User message: "${message}". Citizen data: ${JSON.stringify(citizenData)}`
      },
      {
        role: 'user',
        content: message
      }
    ];

    const stateAnalysisResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: stateAnalysisMessages,
      tools: [registrationFunctions.find(f => f.function.name === 'analyze_registration_state')],
      tool_choice: { type: "function", function: { name: "analyze_registration_state" } },
      temperature: 0.1
    });

    let stateAnalysis = null;
    if (stateAnalysisResponse.choices[0].message.tool_calls) {
      const toolCall = stateAnalysisResponse.choices[0].message.tool_calls[0];
      stateAnalysis = JSON.parse(toolCall.function.arguments);
    }

    logger.info(`State analysis: ${JSON.stringify(stateAnalysis)}`);

    // If user provided required data, extract it
    let extractedData = null;
    if (stateAnalysis && stateAnalysis.has_required_data) {
      extractedData = await extractRegistrationData(message, currentState, language);

      // SPECIAL: If extracting village, validate with geocoding
      if (currentState === 'awaiting_village' && extractedData && extractedData.village_name) {
        const geocodeResult = await geocodingService.geocodeVillage(extractedData.village_name, language);
        
        if (geocodeResult.success) {
          extractedData.geocoding = geocodeResult;
          extractedData.coordinates = geocodeResult.coordinates;
          extractedData.validated_village = geocodeResult.administrative.village || extractedData.village_name;
          extractedData.taluka = geocodeResult.administrative.taluka;
          extractedData.confidence = Math.min(extractedData.confidence, geocodeResult.confidence / 100);
        } else {
          // Village not found or not in Pune ZP
          return {
            stateAnalysis,
            extractedData: null,
            shouldTransition: false,
            nextState: currentState,
            confidence: 0.0,
            geocodingError: geocodeResult.message
          };
        }
      }
    }

    return {
      stateAnalysis,
      extractedData,
      shouldTransition: stateAnalysis?.has_required_data || false,
      nextState: stateAnalysis?.next_state || currentState,
      confidence: stateAnalysis?.confidence || 0.0,
      geocodingError: null
    };

  } catch (error) {
    logger.error('Error processing registration with functions:', error);
    return {
      stateAnalysis: null,
      extractedData: null,
      shouldTransition: false,
      nextState: currentState,
      confidence: 0.0,
      geocodingError: null
    };
  }
};

// UPDATED: Extract specific registration data based on simplified states
const extractRegistrationData = async (message, currentState, language) => {
  try {
    const registrationFunctions = getRegistrationFunctions();
    let functionToCall = null;

    switch (currentState) {
      case 'awaiting_name':
        functionToCall = registrationFunctions.find(f => f.function.name === 'extract_user_name');
        break;
      case 'awaiting_village':
        functionToCall = registrationFunctions.find(f => f.function.name === 'extract_village_info');
        break;
      default:
        return null;
    }

    if (!functionToCall) return null;

    const extractionMessages = [
      {
        role: 'system',
        content: `Extract information from the user message: "${message}"`
      },
      {
        role: 'user',
        content: message
      }
    ];

    const extractionResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: extractionMessages,
      tools: [functionToCall],
      tool_choice: { type: "function", function: { name: functionToCall.function.name } },
      temperature: 0.1
    });

    if (extractionResponse.choices[0].message.tool_calls) {
      const toolCall = extractionResponse.choices[0].message.tool_calls[0];
      const extractedData = JSON.parse(toolCall.function.arguments);
      
      logger.info(`Extracted data: ${JSON.stringify(extractedData)}`);
      return extractedData;
    }

    return null;
  } catch (error) {
    logger.error('Error extracting registration data:', error);
    return null;
  }
};

// Keep other existing functions (searchKnowledgeWithFunctions, generateContextualResponseWithFunctions, etc.)
const searchKnowledgeWithFunctions = async (query, language) => {
  try {
    const knowledgeFunctions = getKnowledgeBaseFunctions();
    
    const searchMessages = [
      {
        role: 'system',
        content: `Analyze this query and search the ZP Pune knowledge base: "${query}"`
      },
      {
        role: 'user',
        content: query
      }
    ];

    const searchResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: searchMessages,
      tools: [knowledgeFunctions.find(f => f.function.name === 'search_zp_knowledge')],
      tool_choice: { type: "function", function: { name: "search_zp_knowledge" } },
      temperature: 0.1
    });

    if (searchResponse.choices[0].message.tool_calls) {
      const toolCall = searchResponse.choices[0].message.tool_calls[0];
      const searchParams = JSON.parse(toolCall.function.arguments);
      
      logger.info(`Knowledge search params: ${JSON.stringify(searchParams)}`);
      return searchParams;
    }

    return null;
  } catch (error) {
    logger.error('Error searching knowledge with functions:', error);
    return null;
  }
};

const generateContextualResponseWithFunctions = async (context, language, citizenData) => {
  try {
    const knowledgeFunctions = getKnowledgeBaseFunctions();
    
    const responseMessages = [
      {
        role: 'system',
        content: systemPrompts[language] || systemPrompts.en
      },
      {
        role: 'user',
        content: `Generate appropriate response for context: ${JSON.stringify(context)}. Citizen: ${JSON.stringify(citizenData)}`
      }
    ];

    const responseGeneration = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: responseMessages,
      tools: [knowledgeFunctions.find(f => f.function.name === 'generate_contextual_response')],
      tool_choice: { type: "function", function: { name: "generate_contextual_response" } },
      temperature: 0.7
    });

    if (responseGeneration.choices[0].message.tool_calls) {
      const toolCall = responseGeneration.choices[0].message.tool_calls[0];
      const responseParams = JSON.parse(toolCall.function.arguments);
      
      const finalResponse = await generateFinalResponse(responseParams, context, citizenData);
      
      logger.info(`Generated contextual response: ${finalResponse}`);
      return finalResponse;
    }

    return null;
  } catch (error) {
    logger.error('Error generating contextual response:', error);
    return null;
  }
};

const generateFinalResponse = async (responseParams, context, citizenData) => {
  try {
    const finalMessages = [
      {
        role: 'system',
        content: `${systemPrompts[responseParams.language]} 

Generate a ${responseParams.response_type} response in ${responseParams.language === 'mr' ? 'Marathi' : 'English'} with ${responseParams.tone} tone.
${responseParams.include_examples ? 'Include helpful examples.' : 'Keep it concise without examples.'}

Context: ${JSON.stringify(context)}
Citizen: ${citizenData?.userProvidedName || citizenData?.whatsappDisplayName || 'Friend'}`
      },
      {
        role: 'user',
        content: 'Generate the response now.'
      }
    ];

    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: finalMessages,
      temperature: 0.7,
      max_tokens: 500
    });

    return finalResponse.choices[0].message.content.trim();
  } catch (error) {
    logger.error('Error generating final response:', error);
    return responseParams.language === 'mr' 
      ? 'क्षमस्व, तांत्रिक समस्या आहे.'
      : 'Sorry, technical issue.';
  }
};

const generateResponseWithFunctions = async (message, history, messageLanguage, knowledgeBaseInfo, citizenData, context = {}) => {
  try {
    const allFunctions = [...getRegistrationFunctions(), ...getKnowledgeBaseFunctions()];
    
    let messages = [
      { role: 'system', content: systemPrompts[messageLanguage] || systemPrompts.en }
    ];

    if (context && Object.keys(context).length > 0) {
      messages.push({
        role: 'system',
        content: `Context: ${JSON.stringify(context)}`
      });
    }

    if (citizenData) {
      const citizenInfo = messageLanguage === 'mr'
        ? `नागरिक माहिती: ${citizenData.userProvidedName || citizenData.whatsappDisplayName}, गाव: ${citizenData.village || 'N/A'}`
        : `Citizen: ${citizenData.userProvidedName || citizenData.whatsappDisplayName}, Village: ${citizenData.village || 'N/A'}`;
      
      messages.push({
        role: 'system',
        content: citizenInfo
      });
    }

    if (knowledgeBaseInfo) {
      const kbPrompt = messageLanguage === 'mr'
        ? `ZP पुणे knowledge base मधील संबंधित माहिती:\n\n${knowledgeBaseInfo}`
        : `Relevant ZP Pune knowledge base information:\n\n${knowledgeBaseInfo}`;
      
      messages.push({
        role: 'system',
        content: kbPrompt
      });
    }

    const limitedHistory = history.slice(-4);
    messages = messages.concat(limitedHistory);

    const startTime = Date.now();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      tools: allFunctions,
      tool_choice: "auto",
      max_tokens: 600,
      temperature: 0.7
    });

    const endTime = Date.now();

    if (response.choices[0].message.tool_calls) {
      const functionResults = await processFunctionCalls(response.choices[0].message.tool_calls);
      
      messages.push(response.choices[0].message);
      
      for (const result of functionResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: JSON.stringify(result.content)
        });
      }

      const finalResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        tools: allFunctions,
        max_tokens: 600,
        temperature: 0.7
      });

      const responseContent = finalResponse.choices[0].message.content.trim();
      
      await logCompletion(message, responseContent, messageLanguage, !!knowledgeBaseInfo, endTime - startTime, { functionCalls: true });
      
      return responseContent;
    } else {
      const responseContent = response.choices[0].message.content.trim();
      
      await logCompletion(message, responseContent, messageLanguage, !!knowledgeBaseInfo, endTime - startTime, { functionCalls: false });
      
      return responseContent;
    }

  } catch (error) {
    logger.error('Error generating response with functions:', error);
    throw new Error('Failed to generate AI response with functions');
  }
};

const processFunctionCalls = async (toolCalls) => {
  const results = [];

  for (const toolCall of toolCalls) {
    try {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      let result = null;

      switch (functionName) {
        case 'extract_user_name':
        case 'extract_village_info':
        case 'analyze_registration_state':
          result = { extracted: true, data: functionArgs };
          break;
        case 'search_zp_knowledge':
          result = { searched: true, query: functionArgs.query, category: functionArgs.category };
          break;
        case 'generate_contextual_response':
          result = { responseGenerated: true, parameters: functionArgs };
          break;
        default:
          result = { error: `Unknown function: ${functionName}` };
      }

      results.push({
        tool_call_id: toolCall.id,
        content: result
      });

    } catch (error) {
      logger.error(`Error processing function call ${toolCall.function.name}:`, error);
      results.push({
        tool_call_id: toolCall.id,
        content: { error: error.message }
      });
    }
  }

  return results;
};

const detectMessageLanguage = async (message) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Detect language: respond "mr" for Marathi, "en" for English`
        },
        {
          role: 'user',
          content: message
        }
      ],
      max_tokens: 5,
      temperature: 0.1
    });
    
    const detectedLanguage = response.choices[0].message.content.trim().toLowerCase();
    return detectedLanguage.includes('mr') ? 'mr' : 'en';
  } catch (error) {
    logger.error('Error detecting language:', error);
    return 'en';
  }
};

const logCompletion = async (query, response, language, usedKnowledgeBase, responseTime, metadata = {}) => {
  try {
    await db.collection('aiCompletions').add({
      query: query,
      response: response,
      language: language,
      usedKnowledgeBase: usedKnowledgeBase,
      responseTime: responseTime,
      functionCalling: metadata.functionCalls || false,
      metadata: metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      cost: calculateTokenCost(query.length + response.length)
    });
  } catch (error) {
    logger.error('Error logging completion:', error);
  }
};

const calculateTokenCost = (charCount) => {
  const estimatedTokens = Math.ceil(charCount / 4);
  return (estimatedTokens / 1000) * 0.15;
};

module.exports = {
  generateResponseWithFunctions,
  processRegistrationWithFunctions,
  searchKnowledgeWithFunctions,
  generateContextualResponseWithFunctions,
  detectMessageLanguage,
  extractRegistrationData
};