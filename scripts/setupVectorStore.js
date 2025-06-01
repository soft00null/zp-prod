const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function setupZPPuneVectorStore() {
  try {
    console.log('🚀 Setting up ZP Pune Vector Store using knowledgebase.txt...');

    // Check if knowledgebase.txt exists
    const knowledgeBasePath = path.join(__dirname, '../knowledgebase.txt');
    
    if (!fs.existsSync(knowledgeBasePath)) {
      console.error('❌ knowledgebase.txt file not found!');
      console.log('📍 Expected location:', knowledgeBasePath);
      console.log('🔧 Please ensure knowledgebase.txt exists in the project root');
      return;
    }

    console.log('✅ Found knowledgebase.txt file');

    // Step 1: Create vector store
    const vectorStore = await openai.vectorStores.create({
      name: "ZP_Pune_Knowledge_Base",
      expires_after: {
        anchor: "last_active_at",
        days: 365
      }
    });

    console.log(`✅ Vector store created: ${vectorStore.id}`);

    // Step 2: Upload knowledgebase.txt file
    console.log('📁 Uploading knowledgebase.txt...');

    // Upload file to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(knowledgeBasePath),
      purpose: 'assistants'
    });

    console.log(`✅ File uploaded: ${file.id}`);

    // Add file to vector store
    await openai.vectorStores.files.create(vectorStore.id, {
      file_id: file.id
    });

    console.log(`✅ File added to vector store`);

    // Step 3: Wait for processing
    console.log('⏳ Waiting for file to be processed...');
    
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!isReady && attempts < maxAttempts) {
      const files = await openai.vectorStores.files.list(vectorStore.id);
      const allProcessed = files.data.every(file => file.status === 'completed');

      if (allProcessed) {
        isReady = true;
        console.log('✅ File processed successfully!');
      } else {
        console.log(`⏳ Processing... (${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
      }
    }

    if (!isReady) {
      console.log('⚠️  File is still processing. Check manually later.');
    }

    // Step 4: Test the vector store
    console.log('🧪 Testing vector store with knowledgebase.txt...');

    const testQueries = [
      "What services does ZP Pune provide?",
      "How to apply for birth certificate?",
      "Contact information for ZP Pune"
    ];

    for (const query of testQueries) {
      try {
        const testResponse = await openai.responses.create({
          model: "gpt-4o-mini",
          input: query,
          tools: [{
            type: "file_search",
            vector_store_ids: [vectorStore.id]
          }]
        });

        console.log(`✅ Test query: "${query}"`);
        console.log(`📋 Response: ${testResponse.output[1]?.content[0]?.text?.substring(0, 100)}...`);
      } catch (error) {
        console.log(`❌ Test failed for: "${query}"`, error.message);
      }
    }

    // Step 5: Save configuration
    const config = {
      vectorStoreId: vectorStore.id,
      sourceFile: 'knowledgebase.txt',
      uploadedFileId: file.id,
      createdAt: new Date().toISOString(),
      status: 'active',
      testQueries: testQueries
    };

    const configPath = path.join(__dirname, '../config/vectorStore.json');
    
    // Create config directory if it doesn't exist
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('\n🎉 Setup Complete!');
    console.log(`📝 Add this to your .env file:`);
    console.log(`ZP_PUNE_VECTOR_STORE_ID=${vectorStore.id}`);
    console.log(`📄 Configuration saved to: ${configPath}`);

    // Display file info
    const fileSize = fs.statSync(knowledgeBasePath).size;
    console.log(`📊 Knowledge base file size: ${(fileSize / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
    
    if (error.message.includes('file')) {
      console.log('💡 Tip: Make sure knowledgebase.txt exists and is readable');
    }
    if (error.message.includes('API')) {
      console.log('💡 Tip: Check your OPENAI_API_KEY environment variable');
    }
  }
}

// Function to update vector store when knowledgebase.txt changes
async function updateVectorStore() {
  try {
    console.log('🔄 Updating vector store with latest knowledgebase.txt...');

    const configPath = path.join(__dirname, '../config/vectorStore.json');
    
    if (!fs.existsSync(configPath)) {
      console.error('❌ Vector store config not found. Run setup first.');
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const vectorStoreId = config.vectorStoreId;

    // Remove old file from vector store
    if (config.uploadedFileId) {
      try {
        await openai.vectorStores.files.del(vectorStoreId, config.uploadedFileId);
        console.log('✅ Old file removed from vector store');
      } catch (error) {
        console.log('⚠️  Could not remove old file:', error.message);
      }
    }

    // Upload new file
    const knowledgeBasePath = path.join(__dirname, '../knowledgebase.txt');
    const file = await openai.files.create({
      file: fs.createReadStream(knowledgeBasePath),
      purpose: 'assistants'
    });

    // Add to vector store
    await openai.vectorStores.files.create(vectorStoreId, {
      file_id: file.id
    });

    // Update config
    config.uploadedFileId = file.id;
    config.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('✅ Vector store updated successfully!');

  } catch (error) {
    console.error('❌ Update failed:', error);
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'update') {
    updateVectorStore();
  } else {
    setupZPPuneVectorStore();
  }
}

module.exports = { 
  setupZPPuneVectorStore, 
  updateVectorStore 
};