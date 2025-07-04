// server.js - Travel Concierge AI Backend
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Get AI response for travel conversation
async function getTravelLLMResponse(userMessage, conversationData) {
  try {
    const systemPrompt = `
    You are a professional travel concierge assistant. Your role is to:
    1. Help collect travel information systematically
    2. Provide helpful, friendly responses
    3. Extract and store travel preferences accurately
    4. Guide users through the travel planning process
    
    Current conversation status:
    - Next question: ${conversationData.next_question_key || 'destination'}
    - Completion: ${conversationData.completion_percentage || 0}%
    - Travel info collected: ${JSON.stringify(conversationData.travel_info || {})}
    
    Respond in JSON format:
    {
      "response": "your helpful response",
      "extracted_info": {
        "destination": "if mentioned",
        "departure_location": "if mentioned",
        "journey_dates": "if mentioned",
        "travel_style": "if mentioned",
        "travel_pace": "if mentioned",
        "travelers_count": "if mentioned",
        "budget": "if mentioned",
        "spending_priorities": "if mentioned",
        "interests": "if mentioned",
        "accommodation_preference": "if mentioned",
        "accommodation_type": "if mentioned",
        "important_amenities": "if mentioned",
        "location_preference": "if mentioned",
        "dietary_restrictions": "if mentioned",
        "accessibility_requirements": "if mentioned"
      },
      "next_question": "next question key or null if complete",
      "completion_percentage": "updated percentage"
    }
    `;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{ text: systemPrompt + "\n\nUser message: " + userMessage }]
        }]
      }
    );

    const aiResponse = response.data.candidates[0].content.parts[0].text;
    return JSON.parse(aiResponse);
  } catch (error) {
    console.error('LLM Error:', error);
    return {
      response: "I'm here to help plan your perfect trip! Where would you like to travel to?",
      extracted_info: {},
      next_question: "destination",
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
    
    // Update travel info with extracted data
    const updatedTravelInfo = {
      ...conversation.travel_info,
      ...aiResult.extracted_info
    };
    
    // Calculate new completion percentage
    const newCompletionPercentage = calculateCompletionPercentage(updatedTravelInfo);
    
    // Determine next question
    const nextQuestion = aiResult.next_question || getNextQuestion(updatedTravelInfo);
    
    // Update conversation
    const updatedConversation = {
      phone_number: phoneNumber,
      user_name: ProfileName || conversation.user_name,
      messages: [
        ...conversation.messages,
        {
          timestamp: new Date().toISOString(),
          user: Body,
          ai: aiResult.response
        }
      ],
      travel_info: updatedTravelInfo,
      next_question_key: nextQuestion,
      completion_percentage: newCompletionPercentage,
      status: nextQuestion ? 'collecting_info' : 'ready_for_planning',
      last_activity: new Date().toISOString()
    };
    
    if (conversation.id) {
      await supabase
        .from('travel_conversations')
        .update(updatedConversation)
        .eq('id', conversation.id);
    } else {
      await supabase
        .from('travel_conversations')
        .insert(updatedConversation);
    }
    
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