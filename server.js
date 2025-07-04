// server.js - Travel Concierge AI Backend - UPDATED FOR RAILWAY REDEPLOY HEHE
// Add this at the very top of server.js for debugging
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'MISSING');
console.log('RAILWAY REDEPLOY TRIGGERED - Using gemini-1.5-flash model');

require('dotenv').config();

// Rest of your existing code...
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Add CORS middleware
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
    message: '🌍 Travel Concierge AI Backend is running!',
    status: 'OK',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      webhook: '/webhook',
      conversations: '/api/conversations'
    }
  });
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Travel questions configuration
const TRAVEL_QUESTIONS = {
  destination: {
    question: "Great! Where would you like to travel to?",
    followUp: "Wonderful choice! "
  },
  departure_location: {
    question: "Where will you be traveling from?",
    followUp: "Perfect! "
  },
  journey_dates: {
    question: "When would you like to start and end your journey?",
    followUp: "Excellent! "
  },
  travel_style: {
    question: "What type of travel experience are you looking for? (Adventure, Cultural, Relaxation, Luxury, Budget-friendly, etc.)",
    followUp: "Great choice! "
  },
  travel_pace: {
    question: "How would you describe your preferred travel pace? (Relaxed, Balanced, or Busy/Intensive)",
    followUp: "Perfect! "
  },
  travelers_count: {
    question: "How many people will be traveling?",
    followUp: "Got it! "
  },
  budget: {
    question: "What's your total budget for this trip?",
    followUp: "Thank you! "
  },
  spending_priorities: {
    question: "Where would you like to prioritize your spending? (Accommodation, Experiences, Food, Transportation, Shopping)",
    followUp: "Excellent! "
  },
  interests: {
    question: "What interests you most? (Culture, Shopping, Nightlife, Wellness, Beach, Nature, History, Food, etc.)",
    followUp: "Fantastic! "
  },
  accommodation_preference: {
    question: "What's your accommodation preference? (Budget, Comfort, Luxury, Unique/Unusual)",
    followUp: "Perfect! "
  },
  accommodation_type: {
    question: "What type of accommodation do you prefer? (Hotel, Resort, Apartment, Villa, Hostel, etc.)",
    followUp: "Great! "
  },
  important_amenities: {
    question: "What amenities are important to you? (WiFi, Pool, Gym, Spa, Restaurant, etc.)",
    followUp: "Noted! "
  },
  location_preference: {
    question: "Where would you prefer to stay? (City center, Near the sea, Quiet area, Near attractions, etc.)",
    followUp: "Excellent! "
  },
  dietary_restrictions: {
    question: "Do you have any dietary restrictions or preferences? (Vegetarian, Vegan, Gluten-free, Allergies, etc.)",
    followUp: "Thank you for sharing! "
  },
  accessibility_requirements: {
    question: "Do you have any accessibility requirements? (Mobility, Hearing, Visual, etc.)",
    followUp: "Thank you! "
  }
};

const QUESTION_KEYS = Object.keys(TRAVEL_QUESTIONS);

// Enhanced JSON parsing function for Gemini responses
function parseGeminiJSON(rawResponse) {
  try {
    console.log('Raw Gemini response:', rawResponse);
    
    // Method 1: Direct JSON parse (if already clean)
    try {
      return JSON.parse(rawResponse);
    } catch (e) {
      console.log('Direct parse failed, cleaning...');
    }
    
    // Method 2: Remove markdown code blocks
    let cleaned = rawResponse
      .replace(/```json\n?/gi, '')     // Remove ```json
      .replace(/```\n?/gi, '')         // Remove closing ```
      .replace(/`{3}json\n?/gi, '')    // Alternative format
      .replace(/`{3}\n?/gi, '')        // Alternative closing
      .trim();
    
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.log('Markdown cleaning failed, extracting JSON...');
    }
    
    // Method 3: Extract JSON object from text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        console.log('JSON extraction failed, manual parsing...');
      }
    }
    
    // Method 4: Manual field extraction (fallback)
    console.log('All parsing methods failed, using manual extraction');
    
    // Extract response field
    const responseMatch = rawResponse.match(/"response":\s*"([^"]*(?:\\.[^"]*)*)"/);
    const response = responseMatch ? responseMatch[1].replace(/\\"/g, '"') : "Thank you for that information! Let me help you plan your perfect trip.";
    
    // Extract extractedInfo (basic)
    const extractedInfo = {};
    if (rawResponse.includes('destination')) {
      const destMatch = rawResponse.match(/"destination":\s*"([^"]*(?:\\.[^"]*)*)"/);
      if (destMatch) extractedInfo.destination = destMatch[1];
    }
    
    // Extract nextQuestionKey
    const nextKeyMatch = rawResponse.match(/"next_question":\s*"([^"]*(?:\\.[^"]*)*)"/);
    const nextQuestion = nextKeyMatch ? nextKeyMatch[1] : 'departure_location';
    
    return {
      response: response,
      extracted_info: extractedInfo,
      next_question: nextQuestion,
      completion_percentage: 0
    };
    
  } catch (error) {
    console.error('All parsing methods failed:', error);
    
    // Ultimate fallback
    return {
      response: "Thank you for your message! Let me help you plan your perfect trip. Where would you like to travel to?",
      extracted_info: {},
      next_question: 'destination',
      completion_percentage: 0
    };
  }
}

// Get AI response for travel conversation
async function getTravelLLMResponse(userMessage, conversationData) {
  try {
    const systemPrompt = `
    You are a professional travel concierge assistant. Your job is to collect the user's travel preferences step by step.

    Here is the information collected so far:
    ${JSON.stringify(conversationData.travel_info || {}, null, 2)}

    The user's latest message is:
    "${userMessage}"

    Instructions:
    - ONLY update the fields in "extracted_info" that are clearly mentioned in the user's latest message.
    - For all other fields, leave them as null or do not include them.
    - Respond in this JSON format (no markdown, no extra text):

    {
      "response": "Your friendly reply and the next question",
      "extracted_info": {
        // Only fields mentioned in the user's latest message
      },
      "next_question": "the next question key or null if complete",
      "completion_percentage": "updated percentage"
    }
    `;

    // Using Google Gemini API with updated model name (gemini-1.5-flash)
    const modelName = 'gemini-1.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    console.log(`Making API call to: ${apiUrl}`);
    
    const response = await axios.post(
      apiUrl,
      {
        contents: [{
          parts: [{ text: systemPrompt + "\n\nUser message: " + userMessage }]
        }]
      }
    );

    const aiResponse = response.data.candidates[0].content.parts[0].text;
    
    // Use the robust JSON parser
    const aiResult = parseGeminiJSON(aiResponse);
    
    // Update travel info with extracted data
    const updatedTravelInfo = {
      ...conversationData.travel_info,
      ...aiResult.extracted_info
    };
    
    // Calculate new completion percentage
    const newCompletionPercentage = calculateCompletionPercentage(updatedTravelInfo);
    
    // Determine next question
    const nextQuestion = aiResult.next_question || getNextQuestion(updatedTravelInfo);
    
    // Update conversation
    const updatedConversation = {
      phone_number: conversationData.phone_number,
      user_name: conversationData.user_name,
      messages: [
        ...conversationData.messages,
        {
          timestamp: new Date().toISOString(),
          user: userMessage,
          ai: aiResult.response
        }
      ],
      travel_info: updatedTravelInfo,
      next_question_key: nextQuestion,
      completion_percentage: newCompletionPercentage,
      status: nextQuestion ? 'collecting_info' : 'ready_for_planning',
      last_activity: new Date().toISOString()
    };
    
    if (conversationData.id) {
      await supabase
        .from('travel_conversations')
        .update(updatedConversation)
        .eq('id', conversationData.id);
    } else {
      await supabase
        .from('travel_conversations')
        .insert(updatedConversation);
    }
    
    return {
      response: aiResult.response,
      extracted_info: aiResult.extracted_info,
      next_question: aiResult.next_question,
      completion_percentage: newCompletionPercentage
    };
    
  } catch (error) {
    console.error('LLM Error:', error);
    return {
      response: "Thank you for your message! Let me help you plan your perfect trip. Where would you like to travel to?",
      extracted_info: {},
      next_question: 'destination',
      completion_percentage: 0
    };
  }
}

// Calculate completion percentage
function calculateCompletionPercentage(travelInfo) {
  const totalQuestions = QUESTION_KEYS.length;
  const answeredQuestions = Object.keys(travelInfo).filter(key => 
    travelInfo[key] && travelInfo[key].trim() !== ''
  ).length;
  return Math.round((answeredQuestions / totalQuestions) * 100);
}

// Get next question
function getNextQuestion(currentInfo) {
  for (const key of QUESTION_KEYS) {
    if (!currentInfo[key] || currentInfo[key].trim() === '') {
      return key;
    }
  }
  return null; // All questions answered
}

// WhatsApp webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { Body, From, ProfileName } = req.body;
    const phoneNumber = From.replace('whatsapp:', '');
    
    console.log(`Received message from ${phoneNumber}: ${Body}`);
    
    // Get or create conversation
    let { data: conversation } = await supabase
      .from('travel_conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    
    if (!conversation) {
      // Create new conversation
      conversation = {
        phone_number: phoneNumber,
        user_name: ProfileName || 'Unknown',
        messages: [],
        travel_info: {},
        next_question_key: 'destination',
        completion_percentage: 0,
        status: 'collecting_info',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      };
    }
    
    // Get AI response
    const aiResult = await getTravelLLMResponse(Body, conversation);
    
    // Send response back to WhatsApp
    const twimlResponse = `
      <Response>
        <Message>${aiResult.response}</Message>
      </Response>
    `;
    
    res.set('Content-Type', 'text/xml');
    res.send(twimlResponse);
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing message');
  }
});

// Webhook verification for WhatsApp
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

// API for dashboard to get conversations
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

// API to update conversation status
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Travel Concierge AI Server running on port ${PORT}`);
  console.log(`Webhook URL: https://your-app.railway.app/webhook`);
});

// .env file (for environment variables)
/*
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key
VERIFY_TOKEN=your_webhook_verify_token
*/

// package.json
/*
{
  "name": "whatsapp-concierge-poc",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "@supabase/supabase-js": "^2.38.0",
    "dotenv": "^16.3.1"
  },
  "engines": {
    "node": "18.x"
  }
}
*/
