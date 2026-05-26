/**
 * App.tsx - v1.16 (Self-Correcting Feedback Loop)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Clusters events, applies distinct tactical lenses, and utilizes local storage to feed user rejections back into the AI to improve future outputs.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';
// Import AsyncStorage to permanently save Jaja's feedback on the device
import AsyncStorage from '@react-native-async-storage/async-storage';

import GoogleLogin from './GoogleLogin';

// Initialize the Gemini AI client using the secure environment variable
const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

// Define the bifurcated JSON structure from the AI
interface Engagement {
  id?: string;
  title: string;
  objective: string;
  prep: string;
  wedge: string;
}

interface BattlePlanState {
  atAGlance: string;
  weeklyStats: { label: string; count: number }[];
  businessEngagements: Engagement[];
  leisureEngagements: Engagement[];
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [battlePlan, setBattlePlan] = useState<BattlePlanState | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState(''); 
  const [hasError, setHasError] = useState(false); 
  
  // State to hold the permanent ledger of rejected advice
  const [feedbackLedger, setFeedbackLedger] = useState<string[]>([]);
  // State to track which UI cards have been voted on to give visual feedback
  const [votedCards, setVotedCards] = useState<{[key: string]: 'up' | 'down'}>({});

  // On initial load, pull the historical feedback ledger from device storage
  useEffect(() => {
    const loadFeedback = async () => {
      try {
        const savedFeedback = await AsyncStorage.getItem('@jaja_feedback_ledger');
        if (savedFeedback) {
          setFeedbackLedger(JSON.parse(savedFeedback));
        }
      } catch (e) {
        console.error("Failed to load feedback ledger", e);
      }
    };
    loadFeedback();
  }, []);

  // Kick off the pipeline when token is received
  useEffect(() => {
    if (token) {
      executeBattlePlanPipeline(token);
    }
  }, [token]);

  // Function to handle the thumbs down action and save it to storage
  const handleDownvote = async (title: string, wedge: string, index: number) => {
    // Visually mark the card as downvoted
    setVotedCards(prev => ({ ...prev, [`${title}-${index}`]: 'down' }));
    
    // Create a strict rule based on what Jaja rejected
    const newRule = `For the event type '${title}', you previously suggested: "${wedge}". The user REJECTED this. Do not give advice like this again. Shift your approach.`;
    
    // Add it to the ledger (keeping only the last 10 to save AI token costs)
    const updatedLedger = [...feedbackLedger, newRule].slice(-10);
    setFeedbackLedger(updatedLedger);
    
    // Save permanently to the phone
    await AsyncStorage.setItem('@jaja_feedback_ledger', JSON.stringify(updatedLedger));
  };

  // Function to handle thumbs up (currently just visual, reinforces current behavior)
  const handleUpvote = (title: string, index: number) => {
    setVotedCards(prev => ({ ...prev, [`${title}-${index}`]: 'up' }));
  };

  const executeBattlePlanPipeline = async (accessToken: string) => {
    setLoading(true);
    setHasError(false); 
    // Reset visual votes for the new batch
    setVotedCards({}); 
    
    try {
      setStatusText('Mapping Calendar Layers...');
      
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const horizonDate = new Date();
      horizonDate.setDate(startOfToday.getDate() + 7);

      const calendarListResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const calendarListData = await calendarListResponse.json();

      const activeCalendars = (calendarListData.items || []).filter((c: any) => c.selected);

      setStatusText(`Intercepting ${activeCalendars.length} Data Streams...`);
      let rawEvents: any[] = [];

      await Promise.all(activeCalendars.map(async (calendar: any) => {
        try {
          const eventsResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?timeMin=${startOfToday.toISOString()}&timeMax=${horizonDate.toISOString()}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const eventsData = await eventsResponse.json();
          
          if (eventsData.items) {
            rawEvents = rawEvents.concat(eventsData.items);
          }
        } catch (err) {
          console.warn(`Failed to pull data from calendar layer: ${calendar.id}`, err);
        }
      }));

      const uniqueEventsMap = new Map();
      rawEvents.forEach((event) => {
        const timeKey = event.start?.dateTime || event.start?.date;
        const compositeKey = `${event.summary}-${timeKey}`;
        if (!uniqueEventsMap.has(compositeKey)) {
          uniqueEventsMap.set(compositeKey, event);
        }
      });
      
      let deduplicatedEvents = Array.from(uniqueEventsMap.values());

      deduplicatedEvents.sort((a, b) => {
        const dateA = new Date(a.start?.dateTime || a.start?.date).getTime();
        const dateB = new Date(b.start?.dateTime || b.start?.date).getTime();
        return dateA - dateB;
      });

      if (deduplicatedEvents.length === 0) {
        setBattlePlan({ 
          atAGlance: "No tactical engagements scheduled for the next 7 days.", 
          weeklyStats: [], 
          businessEngagements: [], 
          leisureEngagements: [] 
        });
        setLoading(false);
        return;
      }

      const promptData = deduplicatedEvents.map((m: any) => {
        const isAllDay = m.start?.date ? "ALL-DAY TASK" : "TIMED EVENT";
        const locationStr = m.location ? `Location: ${m.location}` : "Location: MISSING";
        return `Event: ${m.summary} | Type: ${isAllDay} | ${locationStr} | Attendees: ${m.attendees?.length || 'Solo Block'} | Description: ${m.description?.substring(0, 100) || 'None'}`;
      }).join('\n');

      setStatusText('Applying Feedback & Synthesizing...');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      // Inject the historical feedback into the AI's system prompt if it exists
      const feedbackContext = feedbackLedger.length > 0 
        ? `\nCRITICAL USER FEEDBACK - DO NOT REPEAT THESE MISTAKES:\n${feedbackLedger.join('\n')}\n` 
        : '';

      const prompt = `
        You are a brutally honest, highly strategic advisor for Jaja at Fallen Crown BV. 
        Analyze the following deduplicated schedule. Group minor/routine events together to aggressively shorten the list. Output strictly as a single JSON object.
        ${feedbackContext}
        Rules for the JSON object structure:
        1. "atAGlance": One sharp paragraph summarizing the week's friction points.
        2. "weeklyStats": Array of 3 key metrics (e.g., {"label": "Deep Work Hours", "count": 12}).
        3. "businessEngagements": Array of clustered business/productivity events.
           - "title": Name of the grouped or single event.
           - "objective": Brutal business goal.
           - "prep": Actionable intelligence (e.g., specific metrics to review, exact documents to prep).
           - "wedge": A sharp question to control the room.
        4. "leisureEngagements": Array of clustered personal, fitness, and family events.
           - "title": Name of the event.
           - "objective": Goal focused on presence, disengagement from work, or relationship building.
           - "prep": Active research. Suggest specific highly-rated Amsterdam cafes if location is missing, or specific gift ideas.
           - "wedge": A mental standard to stay present.
        
        Raw Schedule:
        ${promptData}
        
        Output strictly as JSON. Do not include markdown blocks like \`\`\`json.
      `;

      const aiResponse = await model.generateContent(prompt);
      let aiText = aiResponse.response.text();
      
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const synthesizedPlan = JSON.parse(aiText);
      setBattlePlan(synthesizedPlan);

    } catch (error) {
      console.error("Pipeline Failed:", error);
      setHasError(true);
      setStatusText('CRITICAL ERROR: AI capacity overload or invalid parse.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.authBox}>
          <Text style={styles.authHeader}>Fallen Crown</Text>
          <Text style={styles.authSubtext}>Authenticate to sync radar</Text>
          <GoogleLogin onLoginSuccess={(accessToken) => setToken(accessToken)} />
        </View>
      </SafeAreaView>
    );
  }

  // Updated render function to include Dia-styled feedback buttons
  const renderEventCard = (item: Engagement, index: number, isBusiness: boolean) => {
    const cardKey = `${item.title}-${index}`;
    const voteStatus = votedCards[cardKey];

    return (
      <View key={item.id || index.toString()} style={styles.eventCard}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        
        <Text style={styles.label}>OBJECTIVE</Text>
        <Text style={styles.bodyText}>{item.objective}</Text>

        <Text style={styles.label}>{isBusiness ? "TACTICAL PREP" : "RESEARCH & LOGISTICS"}</Text>
        <Text style={styles.prepText}>{item.prep}</Text>

        <View style={styles.divider} />

        <Text style={styles.label}>{isBusiness ? "THE WEDGE" : "PRESENCE STANDARD"}</Text>
        <Text style={styles.wedgeText}>{item.wedge}</Text>

        {/* The Feedback Loop UI */}
        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackLabel}>Calibrate Output</Text>
          <View style={styles.feedbackButtons}>
            <TouchableOpacity 
              style={[styles.voteButton, voteStatus === 'up' && styles.voteButtonActive]} 
              onPress={() => handleUpvote(item.title, index)}
              disabled={!!voteStatus}
            >
              <Text style={styles.voteEmoji}>👍</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.voteButton, voteStatus === 'down' && styles.voteButtonActiveDown]} 
              onPress={() => handleDownvote(item.title, item.wedge, index)}
              disabled={!!voteStatus}
            >
              <Text style={styles.voteEmoji}>👎</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.headerRow}>
          <Text style={styles.header}>Overview</Text>
          <TouchableOpacity onPress={() => setToken(null)}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#000" />
            <Text style={styles.loadingText}>{statusText}</Text>
          </View>
        ) : hasError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorHeader}>Radar Offline</Text>
            <Text style={styles.errorBody}>API capacity exceeded. This is a temporary spike.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => token && executeBattlePlanPipeline(token)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !battlePlan || (battlePlan.businessEngagements.length === 0 && battlePlan.leisureEngagements.length === 0) ? (
          <Text style={styles.emptyText}>No events found across any calendars for the next 7 days.</Text>
        ) : (
          <View>
            <Text style={styles.sectionTitle}>At a glance</Text>
            
            <View style={styles.executiveCard}>
              <View style={styles.glanceSection}>
                <Text style={styles.glanceText}>{battlePlan.atAGlance}</Text>
              </View>
              
              <View style={styles.tableSection}>
                {battlePlan.weeklyStats && battlePlan.weeklyStats.map((stat, i) => (
                  <View key={i} style={styles.tableRow}>
                    <Text style={styles.tableLabel}>{stat.label}</Text>
                    <Text style={styles.tableValue}>{stat.count}</Text>
                  </View>
                ))}
              </View>
            </View>

            {battlePlan.businessEngagements && battlePlan.businessEngagements.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Business & Productivity</Text>
                {battlePlan.businessEngagements.map((item, index) => renderEventCard(item, index, true))}
              </>
            )}

            {battlePlan.leisureEngagements && battlePlan.leisureEngagements.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Leisure & Personal</Text>
                {battlePlan.leisureEngagements.map((item, index) => renderEventCard(item, index, false))}
              </>
            )}

          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// Typography strictly set to system sans-serif mimicking Dia's aesthetic
const systemFont = Platform.select({ ios: 'Helvetica Neue', android: 'Roboto', default: 'sans-serif' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9F9FB' },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  header: { color: '#111827', fontSize: 28, fontWeight: '700', letterSpacing: -0.5, fontFamily: systemFont },
  logoutText: { color: '#6B7280', fontSize: 14, fontWeight: '500', fontFamily: systemFont },
  
  authContainer: { flex: 1, backgroundColor: '#F9F9FB', justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '85%', alignItems: 'flex-start', padding: 0 },
  authHeader: { color: '#111827', fontSize: 32, fontWeight: '700', marginBottom: 8, letterSpacing: -0.5, fontFamily: systemFont },
  authSubtext: { color: '#6B7280', fontSize: 16, marginBottom: 32, fontFamily: systemFont },
  
  loadingContainer: { marginTop: 60, alignItems: 'center' },
  loadingText: { color: '#111827', marginTop: 16, fontSize: 14, fontWeight: '500', fontFamily: systemFont },
  
  errorContainer: { backgroundColor: '#FEF2F2', padding: 24, borderRadius: 12, borderWidth: 1, borderColor: '#FEE2E2', marginTop: 20 },
  errorHeader: { color: '#DC2626', fontSize: 16, fontWeight: '600', marginBottom: 8, fontFamily: systemFont },
  errorBody: { color: '#EF4444', fontSize: 14, marginBottom: 20, lineHeight: 20, fontFamily: systemFont },
  retryButton: { backgroundColor: '#111827', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, alignSelf: 'flex-start' },
  retryText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14, fontFamily: systemFont },

  sectionTitle: { color: '#111827', fontSize: 18, fontWeight: '600', marginBottom: 16, marginTop: 16, letterSpacing: -0.3, fontFamily: systemFont },
  
  executiveCard: { flexDirection: 'row', backgroundColor: '#FFFFFF', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  glanceSection: { flex: 1.5, paddingRight: 16, borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  glanceText: { color: '#374151', fontSize: 14, lineHeight: 22, fontFamily: systemFont },
  tableSection: { flex: 1, paddingLeft: 16, justifyContent: 'center' },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tableLabel: { color: '#6B7280', fontSize: 12, fontWeight: '500', fontFamily: systemFont },
  tableValue: { color: '#111827', fontSize: 12, fontWeight: '700', fontFamily: systemFont },

  eventCard: { backgroundColor: '#FFFFFF', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  cardTitle: { color: '#111827', fontSize: 18, fontWeight: '600', marginBottom: 20, letterSpacing: -0.3, fontFamily: systemFont },
  
  label: { color: '#9CA3AF', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase', fontFamily: systemFont },
  bodyText: { color: '#374151', fontSize: 15, lineHeight: 22, marginBottom: 16, fontFamily: systemFont },
  prepText: { color: '#8C6239', fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: 16, fontFamily: systemFont },
  wedgeText: { color: '#111827', fontSize: 15, fontWeight: '600', fontStyle: 'italic', lineHeight: 22, fontFamily: systemFont },
  
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 16 },
  emptyText: { color: '#6B7280', textAlign: 'center', marginTop: 40, fontSize: 16, fontFamily: systemFont },

  // New Feedback UI Styles
  feedbackContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  feedbackLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', fontFamily: systemFont },
  feedbackButtons: { flexDirection: 'row', gap: 8 },
  voteButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#F9F9FB', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' },
  voteButtonActive: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
  voteButtonActiveDown: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
  voteEmoji: { fontSize: 14 },
});