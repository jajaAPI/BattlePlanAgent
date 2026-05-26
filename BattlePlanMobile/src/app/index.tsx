/**
 * App.tsx - v1.14 (Executive Dash & Active AI Research)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Omni-radar timeline with side-by-side visual executive summaries and actionable AI research.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';

import GoogleLogin from './GoogleLogin';

// Initialize the Gemini AI client using the secure environment variable
const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

// Define the expanded JSON structure from the AI to handle the new visual table
interface BattlePlanState {
  atAGlance: string;
  weeklyStats: { label: string; count: number }[];
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
      const uniqueEventsMap = new Map();
      rawEvents.forEach((event) => {
        const timeKey = event.start?.dateTime || event.start?.date;
        const compositeKey = `${event.summary}-${timeKey}`;
        if (!uniqueEventsMap.has(compositeKey)) {
          uniqueEventsMap.set(compositeKey, event);
        }
      });
      
      let deduplicatedEvents = Array.from(uniqueEventsMap.values());

      // STEP 4: Sort the flattened, deduplicated array chronologically
      deduplicatedEvents.sort((a, b) => {
        const dateA = new Date(a.start?.dateTime || a.start?.date).getTime();
        const dateB = new Date(b.start?.dateTime || b.start?.date).getTime();
        return dateA - dateB;
      });

      if (deduplicatedEvents.length === 0) {
        setBattlePlan({ atAGlance: "No tactical engagements scheduled for the next 7 days.", weeklyStats: [], events: [] });
        setLoading(false);
        return;
      }

      const promptData = deduplicatedEvents.map((m: any) => {
        const isAllDay = m.start?.date ? "ALL-DAY TASK" : "TIMED EVENT";
        const locationStr = m.location ? `Location: ${m.location}` : "Location: MISSING";
        return `Event: ${m.summary} | Type: ${isAllDay} | ${locationStr} | Attendees: ${m.attendees?.length || 'Solo Block'} | Description: ${m.description?.substring(0, 100) || 'None'}`;
      }).join('\n');

      setStatusText('Conducting Active AI Research...');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      // 🚨 CRITICAL UPDATE: The prompt now demands actual research and a statistical table output
      const prompt = `
        You are a brutally honest, highly strategic Solution Engineer advisor for Jaja at Fallen Crown BV. 
        Analyze the following deduplicated schedule. Output strictly as a single JSON object.
        
        Rules for the JSON object structure:
        1. "atAGlance": One sharp, executive-level paragraph summarizing the weekly posture and major friction points.
        2. "weeklyStats": An array of objects to populate a visual table. Generate 3-4 key metrics based on the schedule (e.g., {"label": "High-Stakes Meetings", "count": 4}, {"label": "Focus Blocks", "count": 2}).
        3. "events": An array of objects for each event containing:
           - "title": (string) Event name.
           - "objective": One brutal, objective sentence on the actual goal of this event.
           - "prep": Actionable intelligence and actual research. DO NOT just say "find a gift". Actually suggest 3 specific gift ideas (leveraging themes like padel, music, or fashion). If a lunch in Amsterdam lacks a location, suggest 2 specific high-rated cafes. Do the research and summarize it.
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
            <Text style={styles.sectionTitle}>At a glance</Text>
            
            {/* 🚨 NEW LAYOUT: Side-by-side Executive Summary and Visual Table */}
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

            <Text style={styles.sectionTitle}>Tactical Timeline</Text>
            {battlePlan.events.map((item, index) => (
              <View key={item.id || index.toString()} style={styles.eventCard}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                
                <Text style={styles.label}>OBJECTIVE</Text>
                <Text style={styles.bodyText}>{item.objective}</Text>

                <Text style={styles.label}>PREPARATION & RESEARCH</Text>
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
  
  // Executive Dashboard Layout
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
  prepText: { color: '#D97706', fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: 16, fontFamily: systemFont },
  wedgeText: { color: '#111827', fontSize: 15, fontWeight: '600', fontStyle: 'italic', lineHeight: 22, fontFamily: systemFont },
  
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 16 },
  emptyText: { color: '#6B7280', textAlign: 'center', marginTop: 40, fontSize: 16, fontFamily: systemFont },
});