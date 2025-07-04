// server.js - Intelligent Travel Concierge with Smart Conversation Flow
console.log('🧠 INTELLIGENT TRAVEL CONCIERGE - Starting up...');
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'MISSING');

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: '🧠 Intelligent Travel Concierge AI',
    status: 'OK',
    features: ['Smart Conversation', 'Context Awareness', 'Natural Flow'],
    timestamp: new Date().toISOString()
  });
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Travel questions in logical order
const TRAVEL_FLOW = [
  { key: 'destination', question: 'Where would you like to travel to?' },
  { key: 'departure_location', question: 'Where will you be traveling from?' },
  { key: 'journey_dates', question: 'When would you like to travel?' },
  { key: 'travelers_count', question: 'How many people will be traveling?' },
  { key: 'budget', question: 'What\'s your approximate budget for this trip?' },
  { key: 'travel_style', question: 'What type of experience are you looking for? (adventure, relaxation, culture, luxury, etc.)' },
  { key: 'accommodation_preference', question: 'What\'s your accommodation preference? (budget, comfort, luxury, unique)' },
  { key: 'interests', question: 'What interests you most? (culture, food, nightlife, nature, shopping, history, etc.)' },
  { key: 'travel_pace', question: 'Do you prefer a relaxed, balanced, or busy travel pace?' },
  { key: 'spending_priorities', question: 'Where would you like to prioritize spending? (accommodation, food, activities, shopping)' },
  { key: 'accommodation_type', question: 'What type of accommodation do you prefer? (hotel, resort, apartment, villa, etc.)' },
  { key: 'location_preference', question: 'Where would you prefer to stay? (city center, near beach, quiet area, etc.)' },
  { key: 'important_amenities', question: 'What amenities are important to you? (wifi, pool, gym, spa, etc.)' },
  { key: 'dietary_restrictions', question: 'Do you have any dietary restrictions?' },
  { key: 'accessibility_requirements', question: 'Any accessibility requirements we should know about?' }
];

// Smart extraction patterns
const EXTRACTION_PATTERNS = {
  destination: /(?:going to|travel to|visit|destination|trip to)\s+([A-Za-z\s,]+)/i,
  departure_location: /(?:from|leaving from|starting from|departing from)\s+([A-Za-z\s,]+)/i,
  budget: /(?:\$|USD|€|EUR|£|GBP)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:\$|USD|€|EUR|£|GBP|dollars?|euros?|pounds?)?/i,
  travelers_count: /(\d+)\s*(?:people|person|traveler|pax|of us)/i,
  journey_dates: /(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|\d{1,2}-\d{1,2}|\d{4})/i
};

// Calculate completion percentage
function calculateProgress(travelInfo) {
  const completed = Object.values(travelInfo).filter(value => 
    value && value.toString().trim() !== ''
  ).length;
  return Math.round((completed / TRAVEL_FLOW.length) * 100);
}

// Get next question intelligently
function getNextQuestion(travelInfo) {
  for (const item of TRAVEL_FLOW) {
    if (!travelInfo[item.key] || travelInfo[item.key].toString().trim() === '') {
      return item;
    }
  }
  return null; // All complete
}

// Smart information extraction
function extractTravelInfo(message, currentInfo, expectedField) {
  const extracted = {};
  const lowerMessage = message.toLowerCase().trim();
  
  console.log(`🔍 Extracting from: "${message}" | Expected: ${expectedField}`);
  
  // If we're expecting a specific field, try to map the message to it
  if (expectedField && !currentInfo[expectedField]) {
    // Simple mapping - if user just says a location name and we need destination
    if (['destination', 'departure_location'].includes(expectedField)) {
      // Common city/country names or travel-related context
      if (message.length < 50 && !lowerMessage.includes('?') && 
          (lowerMessage.match(/^[a-z\s,.-]+$/i) || lowerMessage.includes('from'))) {
        extracted[expectedField] = message.trim();
        console.log(`✅ Mapped "${message}" to ${expectedField}`);
        return extracted;
      }
    }
    
    // For other fields, try direct mapping if it's a simple answer
    if (['travelers_count', 'budget', 'travel_style', 'accommodation_preference'].includes(expectedField)) {
      if (message.length < 30) {
        extracted[expectedField] = message.trim();
        console.log(`✅ Mapped "${message}" to ${expectedField}`);
        return extracted;
      }
    }
  }
  
  // Pattern-based extraction for any field
  Object.entries(EXTRACTION_PATTERNS).forEach(([field, pattern]) => {
    if (!currentInfo[field]) {
      const match = message.match(pattern);
      if (match) {
        extracted[field] = match[1] || match[0];
        console.log(`✅ Pattern matched: ${field} = "${extracted[field]}"`);
      }
    }
  });
  
  // Special logic for budget
  if (!currentInfo.budget && lowerMessage.includes('budget')) {
    const budgetMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (budgetMatch) {
      extracted.budget = `$${budgetMatch[1]}`;
    }
  }
  
  // Special logic for travelers count
  if (!currentInfo.travelers_count) {
    if (lowerMessage.includes('solo') || lowerMessage.includes('alone')) {
      extracted.travelers_count = '1';
    } else if (lowerMessage.includes('couple') || lowerMessage.includes('two of us')) {
      extracted.travelers_count = '2';
    } else {
      const numMatch = message.match(/(\d+)/);
      if (numMatch && parseInt(numMatch[1]) <= 20) {
        extracted.travelers_count = numMatch[1];
      }
    }
  }
  
  console.log('🎯 Extracted info:', extracted);
  return extracted;
}

// Generate natural, context-aware responses
function generateNaturalResponse(extractedInfo, currentInfo, nextQuestion, userMessage) {
  const responses = [];
  
  // Acknowledge what was extracted
  Object.keys(extractedInfo).forEach(key => {
    const value = extractedInfo[key];
    switch (key) {
      case 'destination':
        responses.push(`${value} sounds amazing!`);
        break;
      case 'departure_location':
        responses.push(`Great, traveling from ${value}.`);
        break;
      case 'journey_dates':
        responses.push(`Perfect timing for ${value}.`);
        break;
      case 'budget':
        responses.push(`Got it, working with a ${value} budget.`);
        break;
      case 'travelers_count':
        responses.push(value === '1' ? 'A solo adventure!' : `Lovely, ${value} travelers.`);
        break;
      default:
        responses.push(`Thanks for sharing that!`);
    }
  });
  
  // Add progress context
  const progress = calculateProgress({...currentInfo, ...extractedInfo});
  if (progress > 20) {
    responses.push(`We're making great progress!`);
  }
  
  // Ask next question naturally
  if (nextQuestion) {
    const contextualAsks = {
      'departure_location': currentInfo.destination ? 
        `Where will you be flying from to ${currentInfo.destination}?` : 
        'Where will you be traveling from?',
      'journey_dates': 'What dates work best for your trip?',
      'travelers_count': 'How many people will be joining you?',
      'budget': 'What\'s your budget range for this trip?',
      'travel_style': 'What kind of experience are you hoping for?',
      'accommodation_preference': 'Any preference for your accommodation style?'
    };
    
    const questionText = contextualAsks[nextQuestion.key] || nextQuestion.question;
    responses.push(questionText);
  } else {
    responses.push(`Perfect! I have everything I need. Let me connect you with our travel expert to create your personalized itinerary! 🎉`);
  }
  
  return responses.join(' ');
}

// Main conversation handler
async function handleTravelConversation(userMessage, conversationData) {
  try {
    console.log(`💬 Processing: "${userMessage}"`);
    
    const currentInfo = conversationData.travel_info || {};
    const nextQuestion = getNextQuestion(currentInfo);
    const expectedField = nextQuestion ? nextQuestion.key : null;
    
    console.log(`📋 Current info:`, Object.keys(currentInfo).length, 'fields filled');
    console.log(`❓ Expected field: ${expectedField}`);
    
    // Extract information from user message
    const extractedInfo = extractTravelInfo(userMessage, currentInfo, expectedField);
    
    // Merge with existing info
    const updatedInfo = { ...currentInfo, ...extractedInfo };
    
    // Get next question after update
    const newNextQuestion = getNextQuestion(updatedInfo);
    const progress = calculateProgress(updatedInfo);
    
    // Generate natural response
    const response = generateNaturalResponse(extractedInfo, currentInfo, newNextQuestion, userMessage);
    
    console.log(`📊 Progress: ${progress}%`);
    console.log(`📝 Response: "${response}"`);
    
    return {
      response,
      extractedInfo,
      updatedInfo,
      nextQuestion: newNextQuestion,
      progress
    };
    
  } catch (error) {
    console.error('❌ Conversation error:', error);
    
    const nextQuestion = getNextQuestion(conversationData.travel_info || {});
    return {
      response: nextQuestion ? 
        `Thanks! ${nextQuestion.question}` : 
        "Thanks for all the details! Let me get our travel expert to help you.",
      extractedInfo: {},
      updatedInfo: conversationData.travel_info || {},
      nextQuestion: nextQuestion,
      progress: calculateProgress(conversationData.travel_info || {})
    };
  }
}

// WhatsApp webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { Body, From, ProfileName } = req.body;
    const phoneNumber = From.replace('whatsapp:', '');
    
    console.log(`📱 Message from ${phoneNumber}: "${Body}"`);
    
    // Get existing conversation
    let { data: conversation, error: fetchError } = await supabase
      .from('travel_conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    // Initialize if new conversation
    if (!conversation) {
      console.log('👤 New conversation started');
      conversation = {
        phone_number: phoneNumber,
        user_name: ProfileName || 'Unknown Traveler',
        messages: [],
        travel_info: {},
        completion_percentage: 0,
        status: 'collecting_info',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      };
    }
    
    // Process the conversation
    const result = await handleTravelConversation(Body, conversation);
    
    // Update conversation data
    const updatedConversation = {
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          timestamp: new Date().toISOString(),
          user: Body,
          ai: result.response
        }
      ],
      travel_info: result.updatedInfo,
      next_question_key: result.nextQuestion ? result.nextQuestion.key : null,
      completion_percentage: result.progress,
      status: result.nextQuestion ? 'collecting_info' : 'ready_for_planning',
      last_activity: new Date().toISOString()
    };
    
    // Save to database
    if (conversation.id) {
      console.log('💾 Updating conversation');
      await supabase
        .from('travel_conversations')
        .update(updatedConversation)
        .eq('id', conversation.id);
    } else {
      console.log('💾 Creating new conversation');
      await supabase
        .from('travel_conversations')
        .insert(updatedConversation);
    }
    
    // Send response to WhatsApp
    const twimlResponse = `
      <Response>
        <Message>${result.response}</Message>
      </Response>
    `;
    
    res.set('Content-Type', 'text/xml');
    res.send(twimlResponse);
    
    console.log('✅ Response sent successfully');
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    const fallbackResponse = `
      <Response>
        <Message>Thanks for your message! I'm here to help plan your perfect trip. Could you tell me where you'd like to travel?</Message>
      </Response>
    `;
    
    res.set('Content-Type', 'text/xml');
    res.send(fallbackResponse);
  }
});

// Webhook verification
app.get('/webhook', (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token === verify_token) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// API endpoints for dashboard
app.get('/api/conversations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('travel_conversations')
      .select('*')
      .order('last_activity', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, concierge_notes } = req.body;
    
    const updateData = { last_activity: new Date().toISOString() };
    if (status) updateData.status = status;
    if (concierge_notes !== undefined) updateData.concierge_notes = concierge_notes;
    
    const { data, error } = await supabase
      .from('travel_conversations')
      .update(updateData)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    version: 'Intelligent Conversation AI',
    timestamp: new Date().toISOString() 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Intelligent Travel Concierge running on port ${PORT}`);
  console.log(`🧠 Features: Smart extraction, Natural conversation, Context awareness`);
  console.log(`📱 Webhook: /webhook | 📊 API: /api/conversations`);
});