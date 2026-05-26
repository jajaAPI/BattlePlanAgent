/**
 * App.tsx - v1.13 (Dia Aesthetic, Deduplication, & Prep Insights)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Fetches live Calendar data across all layers, deduplicates overlapping events, synthesizes prep insights, and renders in a clean light theme.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';

import GoogleLogin from './GoogleLogin';

// Initialize the Gemini AI client using the secure environment variable
const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

// Define the expected structure from the AI to ensure type safety in the UI
interface BattlePlanState {
  atAGlance: string;
  events: any[];
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [battlePlan, setBattlePlan] = useState<BattlePlanState | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState(''); 
  const [hasError, setHasError] = useState(false); 

  useEffect(() => {
    if (token) {
      executeBattlePlanPipeline(token);
    }
  }, [token]);

  const executeBattlePlanPipeline = async (accessToken: string) => {
    setLoading(true);
    setHasError(false); 
    
    try {
      setStatusText('Mapping Calendar Layers...');
      
      // Establish the temporal boundaries: Exactly 00:00:00 today to 7 days from now
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const horizonDate = new Date();
      horizonDate.setDate(startOfToday.getDate() + 7);

      // STEP 1: Ask Google for every calendar this user has access to
      const calendarListResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const calendarListData = await calendarListResponse.json();

      // Filter to only include calendars the user currently has toggled "on" or visible
      const activeCalendars = (calendarListData.items || []).filter((c: any) => c.selected);

      setStatusText(`Intercepting ${activeCalendars.length} Data Streams...`);
      let rawEvents: any[] = [];

      // STEP 2: Fire parallel requests to every active calendar to scrape their events
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

      // STEP 3: Deduplicate identical events that exist across multiple calendar layers
      // We use a Map with a composite key of the event summary and its exact start time
      const uniqueEventsMap = new Map();
      rawEvents.forEach((event) => {
        const timeKey = event.start?.dateTime || event.start?.date;
        const compositeKey = `${event.summary}-${timeKey}`;
        if (!uniqueEventsMap.has(compositeKey)) {
          uniqueEventsMap.set(compositeKey, event);
        }
      });
      
      // Convert the Map back to an array of unique events
      let deduplicatedEvents = Array.from(uniqueEventsMap.values());

      // STEP 4: Sort the flattened, deduplicated array chronologically
      deduplicatedEvents.sort((a, b) => {
        const dateA = new Date(a.start?.dateTime || a.start?.date).getTime();
        const dateB = new Date(b.start?.dateTime || b.start?.date).getTime();
        return dateA - dateB;
      });

      if (deduplicatedEvents.length === 0) {
        setBattlePlan({ atAGlance: "No tactical engagements scheduled for the next 7 days.", events: [] });
        setLoading(false);
        return;
      }

      // Format data to explicitly highlight missing locations or specifics for the AI to flag
      const promptData = deduplicatedEvents.map((m: any) => {
        const isAllDay = m.start?.date ? "ALL-DAY TASK" : "TIMED EVENT";
        const locationStr = m.location ? `Location: ${m.location}` : "Location: MISSING";
        return `Event: ${m.summary} | Type: ${isAllDay} | ${locationStr} | Attendees: ${m.attendees?.length || 'Solo Block'} | Description: ${m.description?.substring(0, 100) || 'None'}`;
      }).join('\n');

      setStatusText('Synthesizing Tactical Wedges & Prep...');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      // Strict prompt engineering requiring a master object with atAGlance summary and preparation insights
      const prompt = `
        You are a brutally honest, highly strategic Solution Engineer advisor for Jaja at Fallen Crown BV. 
        Analyze the following deduplicated schedule. Output strictly as a single JSON object.
        
        Rules for the JSON object structure:
        1. "atAGlance": One sharp, executive-level paragraph summarizing the weekly posture and major friction points.
        2. "events": An array of objects for each event containing:
           - "title": (string) Event name.
           - "objective": One brutal, objective sentence on the actual goal of this event.
           - "prep": Actionable preparation intelligence. Flag missing locations, mandate 4-day lead times for gifts (if a birthday), or dictate specific talking points for calls/meetings. 
           - "wedge": If it's a meeting, a sharp question to control the room. If it's a solo block, a ruthless standard to hold Jaja accountable.
        
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
        ) : !battlePlan || battlePlan.events.length === 0 ? (
          <Text style={styles.emptyText}>No events found across any calendars for the next 7 days.</Text>
        ) : (
          <View>
            {/* Dia-inspired At a Glance Section */}
            <Text style={styles.sectionTitle}>At a glance</Text>
            <View style={styles.glanceCard}>
              <Text style={styles.glanceText}>{battlePlan.atAGlance}</Text>
            </View>

            <Text style={styles.sectionTitle}>Tactical Timeline</Text>
            {battlePlan.events.map((item, index) => (
              <View key={item.id || index.toString()} style={styles.eventCard}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                
                <Text style={styles.label}>OBJECTIVE</Text>
                <Text style={styles.bodyText}>{item.objective}</Text>

                <Text style={styles.label}>PREPARATION</Text>
                <Text style={styles.prepText}>{item.prep}</Text>

                <View style={styles.divider} />

                <Text style={styles.label}>WEDGE</Text>
                <Text style={styles.wedgeText}>{item.wedge}</Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// Rewritten Dia-Aesthetic Light Theme Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  header: { color: '#1A1A1A', fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  logoutText: { color: '#666', fontSize: 14, fontWeight: '500' },
  
  authContainer: { flex: 1, backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '85%', alignItems: 'flex-start', padding: 0 },
  authHeader: { color: '#1A1A1A', fontSize: 32, fontWeight: '700', marginBottom: 8, letterSpacing: -0.5 },
  authSubtext: { color: '#666', fontSize: 16, marginBottom: 32 },
  
  loadingContainer: { marginTop: 60, alignItems: 'center' },
  loadingText: { color: '#1A1A1A', marginTop: 16, fontSize: 14, fontWeight: '500' },
  
  errorContainer: { backgroundColor: '#FFF5F5', padding: 24, borderRadius: 12, borderWidth: 1, borderColor: '#FFEBEB', marginTop: 20 },
  errorHeader: { color: '#D92D20', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  errorBody: { color: '#F04438', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  retryButton: { backgroundColor: '#1A1A1A', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, alignSelf: 'flex-start' },
  retryText: { color: '#FFF', fontWeight: '600', fontSize: 14 },

  sectionTitle: { color: '#1A1A1A', fontSize: 18, fontWeight: '600', marginBottom: 16, marginTop: 16, letterSpacing: -0.3 },
  
  glanceCard: { backgroundColor: '#FFFFFF', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#F0F0F0', marginBottom: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  glanceText: { color: '#333333', fontSize: 15, lineHeight: 24 },

  eventCard: { backgroundColor: '#FFFFFF', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#F0F0F0', marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  cardTitle: { color: '#1A1A1A', fontSize: 18, fontWeight: '600', marginBottom: 20, letterSpacing: -0.3 },
  
  label: { color: '#888888', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase' },
  bodyText: { color: '#333333', fontSize: 15, lineHeight: 22, marginBottom: 16 },
  prepText: { color: '#D97706', fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: 16 },
  wedgeText: { color: '#1A1A1A', fontSize: 15, fontWeight: '600', fontStyle: 'italic', lineHeight: 22 },
  
  divider: { height: 1, backgroundColor: '#F5F5F5', marginVertical: 16 },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 40, fontSize: 16 },
});