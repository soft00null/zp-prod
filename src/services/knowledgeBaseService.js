const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Collection for knowledge base analytics
const knowledgeCollection = db.collection('knowledgeBase');

// Vector store ID for ZP Pune knowledge (set this in your environment)
const ZP_PUNE_VECTOR_STORE_ID = process.env.ZP_PUNE_VECTOR_STORE_ID;

// Path to the main knowledge base file
const KNOWLEDGE_BASE_FILE_PATH = path.join(__dirname, '../../knowledgebase.txt');

// Load knowledge base content from file
const loadKnowledgeBaseFromFile = async () => {
  try {
    if (fs.existsSync(KNOWLEDGE_BASE_FILE_PATH)) {
      const content = fs.readFileSync(KNOWLEDGE_BASE_FILE_PATH, 'utf8');
      logger.info('Knowledge base loaded from knowledgebase.txt file');
      return content;
    } else {
      logger.warn('knowledgebase.txt file not found');
      return null;
    }
  } catch (error) {
    logger.error('Error loading knowledge base file:', error);
    return null;
  }
};

// Enhanced search using OpenAI File Search with knowledgebase.txt
const searchWithFileSearch = async (query, language = 'en', options = {}) => {
  try {
    if (!ZP_PUNE_VECTOR_STORE_ID) {
      logger.warn('ZP Pune vector store ID not configured, using file-based search');
      return await searchInKnowledgeBaseFile(query, language);
    }

    logger.info(`Searching knowledge base with file search: ${query}`);

    // Use OpenAI Responses API with file search
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: query,
      tools: [{
        type: "file_search",
        vector_store_ids: [ZP_PUNE_VECTOR_STORE_ID],
        max_num_results: options.maxResults || 5,
        ...(options.filters && { filters: options.filters })
      }],
      include: ["file_search_call.results"]
    });

    // Process the response
    let searchResults = null;
    let aiResponse = null;

    response.output.forEach(item => {
      if (item.type === 'file_search_call') {
        searchResults = item.search_results || [];
      } else if (item.type === 'message') {
        aiResponse = item.content[0]?.text || '';
      }
    });

    // Log search for analytics
    await logKnowledgeSearch(query, language, searchResults?.length || 0, 'file_search');

    return {
      query,
      language,
      response: aiResponse,
      searchResults: searchResults,
      method: 'file_search',
      confidence: searchResults?.length > 0 ? 0.8 : 0.2
    };

  } catch (error) {
    logger.error('Error in file search:', error);
    // Fallback to knowledgebase.txt file search
    return await searchInKnowledgeBaseFile(query, language);
  }
};

// Search in the knowledgebase.txt file using AI
const searchInKnowledgeBaseFile = async (query, language = 'en') => {
  try {
    logger.info(`Searching in knowledgebase.txt file for: ${query}`);

    // Load knowledge base content
    const knowledgeBaseContent = await loadKnowledgeBaseFromFile();
    
    if (!knowledgeBaseContent) {
      return await fallbackSearch(query, language);
    }

    // Use OpenAI to search and extract relevant information from the file
    const searchPrompt = language === 'mr'
      ? `तुम्हाला ZP पुणे च्या knowledge base मध्ये माहिती शोधायची आहे. 

Knowledge Base Content:
${knowledgeBaseContent}

User Query: "${query}"

कृपया query शी संबंधित माहिती शोधा आणि मराठी मध्ये उत्तर द्या. जर माहिती सापडली नाही तर ते स्पष्टपणे सांगा.`

      : `You need to search for information in the ZP Pune knowledge base.

Knowledge Base Content:
${knowledgeBaseContent}

User Query: "${query}"

Please find information related to the query and provide a helpful response in English. If no relevant information is found, clearly state that.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant for ZP Pune. Search the provided knowledge base and give accurate, relevant answers.'
        },
        {
          role: 'user',
          content: searchPrompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3
    });

    const aiResponse = response.choices[0].message.content.trim();

    // Calculate confidence based on response content
    const confidence = calculateResponseConfidence(aiResponse, query);

    // Log search for analytics
    await logKnowledgeSearch(query, language, 1, 'file_based');

    return {
      query,
      language,
      response: aiResponse,
      searchResults: [{ content: aiResponse, source: 'knowledgebase.txt' }],
      method: 'file_based',
      confidence: confidence
    };

  } catch (error) {
    logger.error('Error searching in knowledge base file:', error);
    return await fallbackSearch(query, language);
  }
};

// Calculate confidence based on response quality
const calculateResponseConfidence = (response, query) => {
  const lowerResponse = response.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Check if response contains query keywords
  const queryWords = lowerQuery.split(' ').filter(word => word.length > 2);
  let matchCount = 0;
  
  queryWords.forEach(word => {
    if (lowerResponse.includes(word)) {
      matchCount++;
    }
  });
  
  // Check for negative indicators
  const negativeIndicators = [
    'no information',
    'not found',
    'don\'t have',
    'माहिती नाही',
    'सापडली नाही',
    'उपलब्ध नाही'
  ];
  
  const hasNegativeIndicators = negativeIndicators.some(indicator => 
    lowerResponse.includes(indicator)
  );
  
  if (hasNegativeIndicators) {
    return 0.1;
  }
  
  if (matchCount === 0) {
    return 0.2;
  }
  
  const matchRatio = matchCount / queryWords.length;
  
  if (matchRatio >= 0.8) return 0.9;
  if (matchRatio >= 0.6) return 0.7;
  if (matchRatio >= 0.4) return 0.5;
  
  return 0.3;
};

// Fallback search using simple text matching (keeping existing implementation)
const fallbackSearch = async (query, language = 'en') => {
  try {
    logger.info(`Using fallback search for: ${query}`);

    // Try to load from file first
    const knowledgeBaseContent = await loadKnowledgeBaseFromFile();
    
    if (knowledgeBaseContent) {
      // Simple keyword search in file content
      const queryLower = query.toLowerCase();
      const lines = knowledgeBaseContent.split('\n');
      const relevantLines = lines.filter(line => 
        line.toLowerCase().includes(queryLower) ||
        queryLower.split(' ').some(word => line.toLowerCase().includes(word))
      );
      
      if (relevantLines.length > 0) {
        const responseText = relevantLines.slice(0, 5).join('\n');
        
        await logKnowledgeSearch(query, language, relevantLines.length, 'fallback_file');
        
        return {
          query,
          language,
          response: responseText,
          searchResults: relevantLines.map(line => ({ content: line, source: 'knowledgebase.txt' })),
          method: 'fallback_file',
          confidence: 0.6
        };
      }
    }

    // If file search doesn't work, try Firestore
    const keywordsSnapshot = await knowledgeCollection
      .doc('zpPuneData')
      .collection('content')
      .where('language', '==', language)
      .limit(10)
      .get();

    const results = [];
    const queryLower = query.toLowerCase();

    keywordsSnapshot.forEach(doc => {
      const data = doc.data();
      const content = data.content?.toLowerCase() || '';
      const title = data.title?.toLowerCase() || '';

      // Simple relevance scoring
      let relevanceScore = 0;
      const queryWords = queryLower.split(' ');

      queryWords.forEach(word => {
        if (content.includes(word)) relevanceScore += 2;
        if (title.includes(word)) relevanceScore += 3;
      });

      if (relevanceScore > 0) {
        results.push({
          id: doc.id,
          title: data.title,
          content: data.content,
          category: data.category,
          relevanceScore
        });
      }
    });

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Generate response from top results
    const topResults = results.slice(0, 3);
    const responseText = generateResponseFromResults(topResults, query, language);

    // Log search for analytics
    await logKnowledgeSearch(query, language, results.length, 'fallback_firestore');

    return {
      query,
      language,
      response: responseText,
      searchResults: topResults,
      method: 'fallback_firestore',
      confidence: results.length > 0 ? 0.4 : 0.1
    };

  } catch (error) {
    logger.error('Error in fallback search:', error);
    return {
      query,
      language,
      response: language === 'mr' 
        ? 'क्षमस्व, सध्या माहिती मिळू शकली नाही. कृपया ZP पुणे कार्यालयाशी संपर्क साधा.'
        : 'Sorry, information is not available at the moment. Please contact ZP Pune office directly.',
      searchResults: [],
      method: 'error',
      confidence: 0.0
    };
  }
};

// Generate response from search results (keeping existing implementation)
const generateResponseFromResults = (results, query, language) => {
  if (results.length === 0) {
    return language === 'mr'
      ? 'माझ्याकडे या विषयाची माहिती उपलब्ध नाही. कृपया ZP पुणे कार्यालयाशी संपर्क साधा.'
      : 'I don\'t have information on this topic. Please contact ZP Pune office directly.';
  }

  const responseIntro = language === 'mr'
    ? 'तुमच्या प्रश्नानुसार येथे माहिती आहे:'
    : 'Based on your query, here is the information:';

  const contentSummary = results.map(result => {
    const snippet = result.content.substring(0, 200) + '...';
    return language === 'mr'
      ? `📋 ${result.title || 'माहिती'}\n${snippet}`
      : `📋 ${result.title || 'Information'}\n${snippet}`;
  }).join('\n\n');

  return `${responseIntro}\n\n${contentSummary}`;
};

// Enhanced search with metadata filtering that references knowledgebase.txt
const searchWithFilters = async (query, language = 'en', filters = {}) => {
  try {
    const options = {
      maxResults: filters.maxResults || 5
    };

    // Convert filters to OpenAI format if vector store is available
    if (ZP_PUNE_VECTOR_STORE_ID && filters.category) {
      options.filters = {
        type: "eq",
        key: "category",
        value: filters.category
      };
      
      return await searchWithFileSearch(query, language, options);
    }

    // Otherwise, use file-based search with category filtering
    return await searchInKnowledgeBaseFile(query, language);
  } catch (error) {
    logger.error('Error in filtered search:', error);
    return await searchInKnowledgeBaseFile(query, language);
  }
};

// Search by category using knowledgebase.txt
const searchByCategory = async (category, language = 'en') => {
  try {
    const categoryQueries = {
      mr: {
        services: 'ZP पुणे च्या सेवा आणि प्रक्रिया',
        schemes: 'सरकारी योजना आणि अनुदान',
        contact: 'संपर्क माहिती आणि पत्ते',
        procedures: 'प्रक्रिया आणि नियम',
        documents: 'कागदपत्रे आणि अर्ज'
      },
      en: {
        services: 'ZP Pune services and procedures',
        schemes: 'government schemes and subsidies',
        contact: 'contact information and addresses',
        procedures: 'procedures and rules',
        documents: 'documents and applications'
      }
    };

    const query = categoryQueries[language]?.[category] || category;
    
    return await searchWithFilters(query, language, { category, maxResults: 10 });
  } catch (error) {
    logger.error('Error in category search:', error);
    return await searchInKnowledgeBaseFile(category, language);
  }
};

// Initialize knowledge base from knowledgebase.txt file
const initializeKnowledgeBaseFromFile = async () => {
  try {
    const knowledgeBaseContent = await loadKnowledgeBaseFromFile();
    
    if (!knowledgeBaseContent) {
      logger.warn('Cannot initialize: knowledgebase.txt file not found');
      return false;
    }

    // Parse and structure the content
    const sections = parseKnowledgeBaseContent(knowledgeBaseContent);
    
    // Store in Firestore for backup/fallback
    for (const section of sections) {
      await knowledgeCollection
        .doc('zpPuneData')
        .collection('content')
        .add({
          ...section,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'knowledgebase.txt'
        });
    }

    logger.info(`Knowledge base initialized from knowledgebase.txt with ${sections.length} sections`);
    return true;
  } catch (error) {
    logger.error('Error initializing knowledge base from file:', error);
    return false;
  }
};

// Parse knowledgebase.txt content into structured sections
const parseKnowledgeBaseContent = (content) => {
  const sections = [];
  const lines = content.split('\n');
  
  let currentSection = null;
  let currentContent = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine === '') {
      continue;
    }
    
    // Check if this line is a section header (all caps or starts with specific patterns)
    if (isHeaderLine(trimmedLine)) {
      // Save previous section if exists
      if (currentSection && currentContent.length > 0) {
        sections.push({
          title: currentSection,
          content: currentContent.join('\n'),
          category: categorizeContent(currentSection),
          language: 'en', // Assuming English, can be enhanced to detect language
          tags: extractTags(currentSection, currentContent.join('\n'))
        });
      }
      
      // Start new section
      currentSection = trimmedLine;
      currentContent = [];
    } else {
      // Add to current section content
      currentContent.push(trimmedLine);
    }
  }
  
  // Don't forget the last section
  if (currentSection && currentContent.length > 0) {
    sections.push({
      title: currentSection,
      content: currentContent.join('\n'),
      category: categorizeContent(currentSection),
      language: 'en',
      tags: extractTags(currentSection, currentContent.join('\n'))
    });
  }
  
  return sections;
};

// Check if a line is a header
const isHeaderLine = (line) => {
  // Check for all caps
  if (line === line.toUpperCase() && line.length > 3) {
    return true;
  }
  
  // Check for specific patterns
  const headerPatterns = [
    /^[A-Z\s]{3,}:?\s*$/,
    /^\d+\.\s*[A-Z][^a-z]*$/,
    /^[A-Z][A-Z\s]+[A-Z]$/
  ];
  
  return headerPatterns.some(pattern => pattern.test(line));
};

// Categorize content based on title
const categorizeContent = (title) => {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('contact') || titleLower.includes('phone') || titleLower.includes('email')) {
    return 'contact';
  }
  if (titleLower.includes('scheme') || titleLower.includes('yojana') || titleLower.includes('benefit')) {
    return 'schemes';
  }
  if (titleLower.includes('service') || titleLower.includes('certificate') || titleLower.includes('application')) {
    return 'services';
  }
  if (titleLower.includes('procedure') || titleLower.includes('process') || titleLower.includes('how to')) {
    return 'procedures';
  }
  if (titleLower.includes('document') || titleLower.includes('form') || titleLower.includes('required')) {
    return 'documents';
  }
  
  return 'general';
};

// Extract tags from content
const extractTags = (title, content) => {
  const allText = (title + ' ' + content).toLowerCase();
  const commonTags = ['certificate', 'application', 'scheme', 'contact', 'procedure', 'document', 'office', 'phone', 'email', 'address'];
  
  return commonTags.filter(tag => allText.includes(tag));
};

// Log knowledge search for analytics (keeping existing implementation)
const logKnowledgeSearch = async (query, language, resultCount, method) => {
  try {
    await knowledgeCollection.doc('analytics').collection('searches').add({
      query,
      language,
      resultCount,
      method,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: getCurrentDate(),
      hour: new Date().getHours()
    });

    // Update daily stats
    await knowledgeCollection.doc(`daily_${getCurrentDate()}`).set({
      totalSearches: admin.firestore.FieldValue.increment(1),
      [`${method}Searches`]: admin.firestore.FieldValue.increment(1),
      [`${language}Searches`]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  } catch (error) {
    logger.error('Error logging knowledge search:', error);
  }
};

// Get current date (keeping existing implementation)
const getCurrentDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Main search function (backward compatibility) - now uses knowledgebase.txt
const search = async (query, language = 'en') => {
  const result = await searchWithFileSearch(query, language);
  return result.response || '';
};

module.exports = {
  search,
  searchWithFileSearch,
  searchInKnowledgeBaseFile,
  searchWithFilters,
  searchByCategory,
  fallbackSearch,
  initializeKnowledgeBaseFromFile,
  loadKnowledgeBaseFromFile
};