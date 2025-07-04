// server.js - LangChain-Powered Travel Concierge
console.log('🦜 LANGCHAIN TRAVEL CONCIERGE - Starting up...');
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'MISSING');

require('dotenv').config();

const express = require('express');
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

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// In-memory conversation store (replace with Redis in production)
const conversationMemory = new Map();

// Travel information schema
const TRAVEL_SCHEMA = {
  destination: { type: 'string', description: 'Where the user wants to travel' },
  departure_location: { type: 'string', description: 'Where the user is traveling from' },
  journey_dates: { type: 'string', description: 'When they want to travel' },
  travelers_count: { type: 'number', description: 'Number of people traveling' },
  budget: { type: 'string', description: 'Total budget for the trip' },
  travel_style: { type: 'string', description: 'Type of experience (adventure, relaxation, luxury, etc.)' },
  accommodation_preference: { type: 'string', description: 'Budget level (budget, comfort, luxury, unique)' },
  interests: { type: 'string', description: 'What interests them (culture, food, nightlife, nature, etc.)' },
  travel_pace: { type: 'string', description: 'Preferred pace (relaxed, balanced, busy)' },
  spending_priorities: { type: 'string', description: 'Where to prioritize spending' },
  accommodation_type: { type: 'string', description: 'Type of accommodation preferred' },
  location_preference: { type: 'string', description: 'Where to stay (city center, beach, etc.)' },
  important_amenities: { type: 'string', description: 'Important amenities (wifi, pool, etc.)' },
  dietary_restrictions: { type: 'string', description: 'Any dietary restrictions' },
  accessibility_requirements: { type: 'string', description: 'Any accessibility needs' }
};

// Conversation states
const CONVERSATION_STATES = {
  GREETING: 'greeting',
  COLLECTING: 'collecting',
  COMPLETE: 'complete',
  HANDOFF: 'handoff'
};

// Smart travel information extractor
class TravelInfoExtractor {
  static patterns = {
    destination: {
      keywords: ['going to', 'traveling to', 'visit', 'destination', 'trip to'],
      cityCountryPattern: /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s*,\s*[A-Z][a-z]+)?$/
    },
    departure_location: {
      keywords: ['from', 'leaving from', 'starting from', 'departing from'],
      cityCountryPattern: /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s*,\s*[A-Z][a-z]+)?$/
    },
    budget: {
      patterns: [
        /(?:\$|USD|€|EUR|£|GBP)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:\$|USD|€|EUR|£|GBP|dollars?|euros?|pounds?)?/i,
        /(\d+)k/i
      ]
    },
    travelers_count: {
      patterns: [
        /(\d+)\s*(?:people|person|traveler|pax|of us)/i,
        /solo|alone/i,
        /couple|two of us/i
      ]
    },
    journey_dates: {
      patterns: [
        /(?:january|february|march|april|may|june|july|august|september|october|november|december)/i,
        /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/,
        /\d{1,2}-\d{1,2}(?:-\d{2,4})?/
      ]
    }
  };

  static extract(message, currentInfo, expectedField) {
    const extracted = {};
    const lowerMessage = message.toLowerCase().trim();
    
    // Skip obvious greetings and non-informational messages
    const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'];
    const nonInfo = ['thanks', 'thank you', 'ok', 'okay', 'yes', 'no', 'sure'];
    
    if (greetings.some(g => lowerMessage === g) || 
        nonInfo.some(n => lowerMessage === n) ||
        lowerMessage.includes("didn't receive") ||
        lowerMessage.includes("no answer") ||
        message.length < 2) {
      console.log('🚫 Skipping greeting/non-informational message');
      return extracted;
    }

    // Smart field-specific extraction
    if (expectedField && !currentInfo[expectedField]) {
      const result = this.extractSpecificField(message, expectedField);
      if (result) {
        extracted[expectedField] = result;
        console.log(`✅ Extracted ${expectedField}: "${result}"`);
        return extracted;
      }
    }

    // Pattern-based extraction for all fields
    Object.entries(this.patterns).forEach(([field, config]) => {
      if (!currentInfo[field] && config.patterns) {
        for (const pattern of config.patterns) {
          const match = message.match(pattern);
          if (match) {
            extracted[field] = this.normalizeValue(field, match[1] || match[0]);
            console.log(`✅ Pattern extracted ${field}: "${extracted[field]}"`);
            break;
          }
        }
      }
    });

    return extracted;
  }

  static extractSpecificField(message, field) {
    const trimmed = message.trim();
    const lowerMessage = trimmed.toLowerCase();
    
    // Destination/departure location logic
    if (['destination', 'departure_location'].includes(field)) {
      // Check if it looks like a place name
      if (this.patterns[field].cityCountryPattern.test(trimmed) || 
          trimmed.split(' ').length <= 3) {
        return trimmed;
      }
    }

    // Smart travelers count extraction
    if (field === 'travelers_count') {
      // Direct numbers
      const num = parseInt(trimmed);
      if (!isNaN(num) && num > 0 && num <= 20) {
        return num.toString();
      }
      
      // Relationship-based counting
      if (lowerMessage.includes('solo') || lowerMessage.includes('alone') || lowerMessage.includes('just me')) {
        return '1';
      }
      if (lowerMessage.includes('couple') || lowerMessage.includes('two of us')) {
        return '2';
      }
      if (lowerMessage.includes('my wife') || lowerMessage.includes('my husband') || 
          lowerMessage.includes('my partner') || lowerMessage.includes('me and my')) {
        return '2';
      }
      if (lowerMessage.includes('family of')) {
        const familyMatch = trimmed.match(/family of (\d+)/i);
        if (familyMatch) return familyMatch[1];
      }
      if (lowerMessage.includes('with my') && lowerMessage.includes('kids')) {
        return '4'; // Assume 2 adults + 2 kids as default
      }
      
      // Count people mentioned (me, wife, husband, etc.)
      let count = 0;
      if (lowerMessage.includes('me') || lowerMessage.includes('i ')) count++;
      if (lowerMessage.includes('wife') || lowerMessage.includes('husband') || 
          lowerMessage.includes('partner')) count++;
      if (lowerMessage.includes('friend')) count++;
      
      if (count >= 2) return count.toString();
    }

    // Smart budget extraction with currency preservation
    if (field === 'budget') {
      // Match currency with amount
      const currencyMatch = trimmed.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(euros?|eur|€|dollars?|usd|\$|pounds?|gbp|£)/i);
      if (currencyMatch) {
        const amount = currencyMatch[1];
        const currency = currencyMatch[2].toLowerCase();
        
        if (currency.includes('eur') || currency.includes('€')) {
          return `€${amount}`;
        } else if (currency.includes('pound') || currency.includes('gbp') || currency.includes('£')) {
          return `£${amount}`;
        } else {
          return `${amount}`;
        }
      }
      
      // Just number, assume USD
      const budgetMatch = trimmed.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      if (budgetMatch) {
        return `${budgetMatch[1]}`;
      }
    }

    // For other fields, accept reasonable short answers
    if (trimmed.length > 1 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  }

  static normalizeValue(field, value) {
    switch (field) {
      case 'travelers_count':
        const lowerValue = value.toLowerCase();
        if (lowerValue.includes('solo') || lowerValue.includes('alone')) return '1';
        if (lowerValue.includes('couple') || lowerValue.includes('two of us')) return '2';
        if (lowerValue.includes('my wife') || lowerValue.includes('my husband') || 
            lowerValue.includes('my partner')) return '2';
        
        const num = parseInt(value);
        return isNaN(num) ? value : num.toString();
      
      case 'budget':
        // Don't modify budget here since it's already handled in extractSpecificField
        return value;
      
      default:
        return value;
    }
  }
}

// Conversation manager with memory
class ConversationManager {
  constructor(phoneNumber) {
    this.phoneNumber = phoneNumber;
    this.memory = conversationMemory.get(phoneNumber) || {
      state: CONVERSATION_STATES.GREETING,
      travelInfo: {},
      messageHistory: [],
      lastActivity: new Date(),
      expectedField: null
    };
  }

  addMessage(userMessage, aiResponse) {
    this.memory.messageHistory.push({
      timestamp: new Date().toISOString(),
      user: userMessage,
      ai: aiResponse
    });
    
    // Keep only last 10 messages for memory management
    if (this.memory.messageHistory.length > 10) {
      this.memory.messageHistory = this.memory.messageHistory.slice(-10);
    }
    
    this.memory.lastActivity = new Date();
    conversationMemory.set(this.phoneNumber, this.memory);
  }

  updateTravelInfo(extractedInfo) {
    this.memory.travelInfo = { ...this.memory.travelInfo, ...extractedInfo };
    this.updateState();
    conversationMemory.set(this.phoneNumber, this.memory);
  }

  updateState() {
    const completedFields = Object.keys(this.memory.travelInfo).length;
    const totalFields = Object.keys(TRAVEL_SCHEMA).length;
    
    if (completedFields === 0 && this.memory.messageHistory.length <= 1) {
      this.memory.state = CONVERSATION_STATES.GREETING;
    } else if (completedFields < totalFields) {
      this.memory.state = CONVERSATION_STATES.COLLECTING;
    } else {
      this.memory.state = CONVERSATION_STATES.COMPLETE;
    }
  }

  getNextField() {
    const fieldOrder = Object.keys(TRAVEL_SCHEMA);
    for (const field of fieldOrder) {
      if (!this.memory.travelInfo[field]) {
        this.memory.expectedField = field;
        console.log(`➡️ Next field needed: ${field}`);
        return field;
      }
    }
    this.memory.expectedField = null;
    console.log('🎉 All fields completed!');
    return null;
  }

  getProgress() {
    const completed = Object.keys(this.memory.travelInfo).length;
    const total = Object.keys(TRAVEL_SCHEMA).length;
    return Math.round((completed / total) * 100);
  }

  getContext() {
    return {
      state: this.memory.state,
      travelInfo: this.memory.travelInfo,
      recentMessages: this.memory.messageHistory.slice(-3),
      expectedField: this.memory.expectedField,
      progress: this.getProgress()
    };
  }
}

// Response generator
class ResponseGenerator {
  static generate(extractedInfo, context, nextField) {
    const responses = [];
    
    // Handle different conversation states
    switch (context.state) {
      case CONVERSATION_STATES.GREETING:
        if (Object.keys(extractedInfo).length === 0) {
          return "Hello! I'm here to help you plan your perfect trip. Where would you like to travel to?";
        }
        break;
        
      case CONVERSATION_STATES.COLLECTING:
        // Acknowledge extracted information
        Object.entries(extractedInfo).forEach(([field, value]) => {
          responses.push(this.getAcknowledgment(field, value));
        });
        break;
        
      case CONVERSATION_STATES.COMPLETE:
        return "Perfect! I have all the information I need. Let me connect you with our travel expert who will create a personalized itinerary for your trip! 🎉";
    }

    // Add next question if we have more to collect
    if (nextField) {
      const question = this.getFieldQuestion(nextField, context.travelInfo);
      responses.push(question);
    }

    return responses.length > 0 ? responses.join(' ') : 
           "Thank you! Could you tell me more about your travel plans?";
  }

  static getAcknowledgment(field, value) {
    const acknowledgments = {
      destination: `${value} is a fantastic choice!`,
      departure_location: `Great, traveling from ${value}.`,
      journey_dates: `Perfect timing - ${value}.`,
      travelers_count: this.getTravelersAcknowledgment(value),
      budget: `Working with ${value} - got it!`,
      travel_style: `${value} sounds amazing!`,
      accommodation_preference: `${value} accommodation preference noted.`,
      interests: `${value} - excellent interests!`,
      travel_pace: `A ${value} pace sounds perfect.`
    };
    
    return acknowledgments[field] || 'Thanks for that information!';
  }

  static getTravelersAcknowledgment(value) {
    const numValue = parseInt(value);
    if (!isNaN(numValue)) {
      switch (numValue) {
        case 1: return 'A solo adventure!';
        case 2: return 'Perfect for a couple!';
        case 3: return 'Great for 3 travelers!';
        case 4: return 'Lovely for a family of 4!';
        default: return `Wonderful for ${value} travelers!`;
      }
    }
    
    // If it's not a number, it might be descriptive text
    return 'Perfect! I understand your travel group.';
  }

  static getFieldQuestion(field, currentInfo) {
    const contextualQuestions = {
      destination: "Where would you like to travel to?",
      departure_location: currentInfo.destination ? 
        `Where will you be traveling from to ${currentInfo.destination}?` : 
        "Where will you be traveling from?",
      journey_dates: "When would you like to travel?",
      travelers_count: "How many people will be traveling?",
      budget: "What's your approximate budget for this trip?",
      travel_style: "What type of experience are you looking for? (adventure, relaxation, cultural, luxury, etc.)",
      accommodation_preference: "What's your accommodation preference? (budget, comfort, luxury, or something unique)",
      interests: "What interests you most? (culture, food, nightlife, nature, shopping, history, etc.)",
      travel_pace: "Do you prefer a relaxed, balanced, or busy travel pace?",
      spending_priorities: "Where would you like to prioritize your spending? (accommodation, food, activities, shopping)",
      accommodation_type: "What type of accommodation do you prefer? (hotel, resort, apartment, villa, etc.)",
      location_preference: "Where would you prefer to stay? (city center, near beach, quiet area, etc.)",
      important_amenities: "What amenities are important to you? (wifi, pool, gym, spa, etc.)",
      dietary_restrictions: "Do you have any dietary restrictions?",
      accessibility_requirements: "Any accessibility requirements we should know about?"
    };
    
    return contextualQuestions[field] || `Could you tell me about your ${field.replace('_', ' ')}?`;
  }
}

// Main conversation handler
async function handleConversation(userMessage, phoneNumber, userName) {
  try {
    console.log(`💬 Processing: "${userMessage}" from ${phoneNumber}`);
    
    // Get or create conversation manager
    const conversation = new ConversationManager(phoneNumber);
    const context = conversation.getContext();
    
    console.log(`📊 Current state: ${context.state}, Progress: ${context.progress}%`);
    console.log(`📋 Travel info (${Object.keys(context.travelInfo).length}/15):`, 
      Object.keys(context.travelInfo).map(key => `${key}="${context.travelInfo[key]}"`).join(', '));
    
    // Extract information from user message
    const nextField = conversation.getNextField();
    console.log(`❓ Next expected field: ${nextField}`);
    
    const extractedInfo = TravelInfoExtractor.extract(
      userMessage, 
      context.travelInfo, 
      nextField
    );
    
    console.log(`🎯 Extracted:`, extractedInfo);
    
    // Update conversation with extracted info
    if (Object.keys(extractedInfo).length > 0) {
      conversation.updateTravelInfo(extractedInfo);
    }
    
    // Get updated context and next field
    const updatedContext = conversation.getContext();
    const newNextField = conversation.getNextField();
    
    // Generate response
    const response = ResponseGenerator.generate(extractedInfo, updatedContext, newNextField);
    
    // Add to conversation memory
    conversation.addMessage(userMessage, response);
    
    console.log(`📝 Response: "${response}"`);
    console.log(`📊 Updated progress: ${updatedContext.progress}%`);
    
    return {
      response,
      travelInfo: updatedContext.travelInfo,
      progress: updatedContext.progress,
      status: updatedContext.state,
      nextField: newNextField
    };
    
  } catch (error) {
    console.error('❌ Conversation error:', error);
    return {
      response: "I'm here to help you plan your trip! Where would you like to travel?",
      travelInfo: {},
      progress: 0,
      status: CONVERSATION_STATES.GREETING,
      nextField: 'destination'
    };
  }
}

// WhatsApp webhook
app.post('/webhook', async (req, res) => {
  try {
    const { Body, From, ProfileName } = req.body;
    const phoneNumber = From.replace('whatsapp:', '');
    
    console.log(`📱 Message from ${phoneNumber}: "${Body}"`);
    
    // Handle conversation
    const result = await handleConversation(Body, phoneNumber, ProfileName);
    
    // Get or create database record
    let { data: dbConversation } = await supabase
      .from('travel_conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    
    // Prepare conversation data
    const conversationData = {
      phone_number: phoneNumber,
      user_name: ProfileName || dbConversation?.user_name || 'Unknown Traveler',
      messages: [
        ...(dbConversation?.messages || []),
        {
          timestamp: new Date().toISOString(),
          user: Body,
          ai: result.response
        }
      ],
      travel_info: result.travelInfo,
      completion_percentage: result.progress,
      status: result.status === CONVERSATION_STATES.COMPLETE ? 'ready_for_planning' : 'collecting_info',
      next_question_key: result.nextField,
      last_activity: new Date().toISOString()
    };
    
    // Save to database
    if (dbConversation) {
      await supabase
        .from('travel_conversations')
        .update(conversationData)
        .eq('id', dbConversation.id);
    } else {
      await supabase
        .from('travel_conversations')
        .insert(conversationData);
    }
    
    // Send WhatsApp response
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
        <Message>Hello! I'm here to help you plan your perfect trip. Where would you like to travel?</Message>
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
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Dashboard APIs
app.get('/api/conversations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('travel_conversations')
      .select('*')
      .order('last_activity', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    version: 'LangChain-Powered Travel Concierge',
    features: ['Memory Management', 'Smart Extraction', 'Natural Conversation'],
    timestamp: new Date().toISOString() 
  });
});

app.get('/', (req, res) => {
  res.json({
    message: '🦜 LangChain Travel Concierge AI',
    status: 'OK',
    features: ['Conversation Memory', 'Smart Field Extraction', 'Natural Flow'],
    activeConversations: conversationMemory.size
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦜 LangChain Travel Concierge running on port ${PORT}`);
  console.log(`🧠 Features: Memory management, Smart extraction, Natural conversation`);
  console.log(`📱 Ready to handle WhatsApp conversations intelligently!`);
});