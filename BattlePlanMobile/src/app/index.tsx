import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Define current app version for easy tracking
const APP_VERSION = 'v1.30';

// Initialize Supabase (RLS currently disabled for rapid prototype validation)
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Gemini
const genAI = new GoogleGenerativeAI('YOUR_GEMINI_API_KEY');

const BACKGROUND_FETCH_TASK = 'background-radar-fetch';

// Define notification behavior for the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// 1. Define headless background task outside of React lifecycle to ensure execution even when app is closed
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    // Retrieve OAuth token persisted locally
    const token = await AsyncStorage.getItem('google_oauth_token');
    if (!token) {
      // Abort if no auth exists
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Execute the exact pipeline that runs in the foreground
    const calendarData = await fetchCalendarData(token);
    const aiBrief = await generateAIBrief(calendarData);
    
    // Save the compiled brief locally to ensure zero loading time on app open
    await AsyncStorage.setItem('latest_radar_brief', JSON.stringify(aiBrief));

    // Trigger local push notification to signal completion
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Radar Updated',
        body: 'Your morning brief has been compiled and is ready for review.',
      },
      trigger: null, // Fire immediately after processing
    });

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('Background fetch failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Helper functions hoisted out of the component for background task access
async function fetchCalendarData(token: string) {
  // Fetch 7-day window from Google Calendar API
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${nextWeek.toISOString()}&singleEvents=true&orderBy=startTime`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  
  // Deduplicate events based on ID
  const uniqueEvents = Array.from(new Map(data.items?.map((item: any) => [item.id, item])).values());
  return uniqueEvents;
}

async function generateAIBrief(events: any) {
  // Fetch rules from Supabase ledger to calibrate prompt
  const { data: rules } = await supabase.from('feedback_ledger').select('rule_text').eq('type', 'downvote_correction');
  const calibrationContext = rules?.map(r => r.rule_text).join('\n') || 'No specific corrections yet.';

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `
    Analyze these events: ${JSON.stringify(events)}.
    Categorize into "Business" (goals, tactical wedges) and "Leisure" (logistics, presence standards).
    Apply these calibration rules: ${calibrationContext}
    Return JSON format only.
  `;
  
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

export default function App() {
  const [viewMode, setViewMode] = useState<'live' | 'archive'>('live');
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<any>(null);
  const [archive, setArchive] = useState<any[]>([]);

  useEffect(() => {
    registerBackgroundFetch();
    loadInitialData();
  }, []);

  // 2. Register task and request notification permissions on mount
  async function registerBackgroundFetch() {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      Alert.alert('Push notifications disabled');
      return;
    }

    // Register task with OS. Interval is approximate based on OS battery constraints.
    await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
      minimumInterval: 60 * 15, // 15 minutes
      stopOnTerminate: false, // Continue running after app is closed
      startOnBoot: true, // Resume on device restart
    });
  }

  async function loadInitialData() {
    setLoading(true);
    // Check for pre-compiled background brief
    const savedBrief = await AsyncStorage.getItem('latest_radar_brief');
    if (savedBrief) {
      setBrief(JSON.stringify(savedBrief));
    } else {
      // Fallback to manual pull if background task hasn't fired yet
      const token = await AsyncStorage.getItem('google_oauth_token');
      if (token) {
        const calData = await fetchCalendarData(token);
        const newBrief = await generateAIBrief(calData);
        setBrief(newBrief);
      }
    }
    setLoading(false);
  }

  async function fetchArchive() {
    setLoading(true);
    // Pull last 5 briefs from cloud history
    const { data, error } = await supabase.from('brief_history').select('*').order('created_at', { ascending: false }).limit(5);
    if (!error && data) {
      setArchive(data);
    }
    setLoading(false);
  }

  async function handleFeedback(section: string, isPositive: boolean) {
    if (!isPositive) {
      // Push downvote rule to Supabase cloud to train future prompts
      await supabase.from('feedback_ledger').insert([
        { section_name: section, type: 'downvote_correction', rule_text: `Do not structure ${section} this way again.` }
      ]);
      Alert.alert('Feedback logged. Prompt calibrated.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#121212', paddingTop: 60, paddingHorizontal: 20 }}>
      {/* Header & View Toggle */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        {/* Render the version number directly next to the app title */}
        <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: 'bold' }}>
          Radar. <Text style={{ fontSize: 12, color: '#888888', fontWeight: 'normal' }}>{APP_VERSION}</Text>
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity 
            onPress={() => setViewMode('live')}
            style={{ padding: 10, backgroundColor: viewMode === 'live' ? '#333333' : '#1e1e1e', borderRadius: 5 }}
          >
            <Text style={{ color: '#ffffff' }}>Live</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => { setViewMode('archive'); fetchArchive(); }}
            style={{ padding: 10, backgroundColor: viewMode === 'archive' ? '#333333' : '#1e1e1e', borderRadius: 5 }}
          >
            <Text style={{ color: '#ffffff' }}>Archive</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      {loading ? (
        <ActivityIndicator size="large" color="#ffffff" style={{ marginTop: 50 }} />
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {viewMode === 'live' && brief ? (
            <View>
              {/* Business Section */}
              <View style={{ backgroundColor: '#1e1e1e', padding: 20, borderRadius: 10, marginBottom: 15 }}>
                <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Business</Text>
                <Text style={{ color: '#cccccc' }}>{JSON.stringify(brief.Business, null, 2)}</Text>
                <View style={{ flexDirection: 'row', marginTop: 15, gap: 15 }}>
                  <TouchableOpacity onPress={() => handleFeedback('Business', true)}><Text style={{ color: '#4CAF50' }}>+1</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => handleFeedback('Business', false)}><Text style={{ color: '#F44336' }}>-1</Text></TouchableOpacity>
                </View>
              </View>
              
              {/* Leisure Section */}
              <View style={{ backgroundColor: '#1e1e1e', padding: 20, borderRadius: 10 }}>
                <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>Leisure</Text>
                <Text style={{ color: '#cccccc' }}>{JSON.stringify(brief.Leisure, null, 2)}</Text>
                <View style={{ flexDirection: 'row', marginTop: 15, gap: 15 }}>
                  <TouchableOpacity onPress={() => handleFeedback('Leisure', true)}><Text style={{ color: '#4CAF50' }}>+1</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => handleFeedback('Leisure', false)}><Text style={{ color: '#F44336' }}>-1</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          ) : viewMode === 'archive' ? (
            archive.map((item, index) => (
              <View key={index} style={{ backgroundColor: '#1e1e1e', padding: 15, borderRadius: 10, marginBottom: 10 }}>
                <Text style={{ color: '#888888', marginBottom: 5 }}>{new Date(item.created_at).toLocaleDateString()}</Text>
                <Text style={{ color: '#ffffff' }}>{JSON.stringify(item.brief_data).substring(0, 100)}...</Text>
              </View>
            ))
          ) : (
            <Text style={{ color: '#888888', textAlign: 'center', marginTop: 50 }}>No data available.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}