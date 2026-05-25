/**
 * App.tsx - v1.7 (Gemini 2.5 AI Synthesis Engine)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Fetches live Calendar data (7-day horizon) and uses Gemini to synthesize tactical Battle Plans.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Import the local GoogleLogin component for authentication
import GoogleLogin from './GoogleLogin';

// Initialize the Gemini AI client using the secure environment variable
// The '!' guarantees to TypeScript that this environment variable is populated
const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

export default function App() {
  // State management for auth, data, and UI feedback
  const [token, setToken] = useState<string | null>(null);
  const [battlePlan, setBattlePlan] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState(''); 

  // Kick off the pipeline immediately when the OAuth token is successfully received
  useEffect(() => {
    if (token) {
      executeBattlePlanPipeline(token);
    }
  }, [token]);

  // Master function that executes the fetch and AI synthesis sequence
  const executeBattlePlanPipeline = async (accessToken: string) => {
    setLoading(true);
    
    try {
      // STAGE 1: Fetch raw calendar data
      setStatusText('Intercepting Google Calendar Feed...');
      
      // Define the time window: Now until exactly 7 days (1 week) from now
      const now = new Date();
      const horizonDate = new Date();
      horizonDate.setDate(now.getDate() + 7);

      // Hit the Google Calendar API with the expanded 7-day window
      const calendarResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${horizonDate.toISOString()}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const calendarData = await calendarResponse.json();
      
      // Filter out solo blocks to focus only on actual meetings with other human beings
      const validMeetings = (calendarData.items || []).filter((e: any) => e.attendees && e.attendees.length > 0);

      // If no valid meetings exist in the next 7 days, halt the pipeline and update UI
      if (validMeetings.length === 0) {
        setBattlePlan([]);
        setLoading(false);
        return;
      }

      // Format raw data into a condensed string to maximize AI token efficiency
      const promptData = validMeetings.map((m: any) => 
        `Meeting: ${m.summary} | Attendees: ${m.attendees?.length || 0} | Description: ${m.description?.substring(0, 100) || 'None'}`
      ).join('\n');

      // STAGE 2: Synthesize with Gemini
      setStatusText('Synthesizing Tactical Wedges...');
      
      // 🚨 CRITICAL FIX: Upgraded to the active 2.5 model. 1.5 is deprecated and returns 404.
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      // Strict prompt engineering to force Gemini into our preferred JSON output structure
      const prompt = `
        You are a brutally honest, highly strategic Solution Engineer advisor for Jaja at Fallen Crown BV. 
        Analyze the following schedule. For each meeting, generate a tactical 'Battle Plan' object.
        
        Rules:
        1. 'objective': One brutal, objective sentence on the actual goal of this meeting.
        2. 'wedge': One sharp, tactical question or statement Jaja should use to control the room.
        
        Raw Schedule:
        ${promptData}
        
        Output strictly as a JSON array of objects with keys: "id" (string), "title" (string), "objective" (string), "wedge" (string). Do not include markdown blocks like \`\`\`json.
      `;

      // Execute the call to Gemini
      const aiResponse = await model.generateContent(prompt);
      let aiText = aiResponse.response.text();
      
      // Sanitize the output to strip any markdown formatting Gemini might inject
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      
      // Parse the sanitized JSON string into executable React state array
      const synthesizedPlan = JSON.parse(aiText);
      setBattlePlan(synthesizedPlan);

    } catch (error) {
      console.error("Pipeline Failed:", error);
      setStatusText('CRITICAL ERROR: Pipeline Failure');
    } finally {
      setLoading(false);
    }
  };

  // View 1: Unauthenticated State (Secure Lock Screen)
  if (!token) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authBox}>
          <Text style={styles.authHeader}>Fallen Crown BV</Text>
          <Text style={styles.authSubtext}>Secure Access Required</Text>
          {/* Mount the Google Auth button and pass the state setter as a prop */}
          <GoogleLogin onLoginSuccess={(accessToken) => setToken(accessToken)} />
        </View>
      </SafeAreaView>
    );
  }

  // View 2: Authenticated State (Live Dashboard)
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.headerRow}>
          <Text style={styles.header}>🎯 Battle Plan</Text>
          {/* Logout button resets token to null, instantly killing the session and returning to lock screen */}
          <TouchableOpacity onPress={() => setToken(null)}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* Dynamic Loading and Rendering states based on pipeline status */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0052CC" />
            <Text style={styles.loadingText}>{statusText}</Text>
          </View>
        ) : battlePlan.length === 0 ? (
          <Text style={styles.emptyText}>No external meetings found for the next 7 days.</Text>
        ) : (
          // Map through the AI-synthesized data and construct the UI cards
          battlePlan.map((item, index) => (
            <View key={item.id || index.toString()} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.title}</Text>
              </View>
              
              <Text style={styles.label}>STRATEGIC OBJECTIVE</Text>
              <Text style={styles.bodyText}>{item.objective}</Text>

              <View style={styles.divider} />

              <Text style={styles.label}>TACTICAL WEDGE</Text>
              <Text style={styles.wedgeText}>{item.wedge}</Text>
            </View>
          ))
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// Inline styles for the UI components
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scrollContent: { padding: 20, paddingTop: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  header: { color: '#0052CC', fontSize: 34, fontWeight: '900' },
  logoutText: { color: '#666', fontSize: 14, fontWeight: 'bold' },
  authContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '80%', alignItems: 'center', backgroundColor: '#111', padding: 30, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
  authHeader: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  authSubtext: { color: '#888', fontSize: 14, marginBottom: 20 },
  loadingContainer: { marginTop: 50, alignItems: 'center' },
  loadingText: { color: '#0052CC', marginTop: 15, fontSize: 14, fontWeight: 'bold' },
  card: { backgroundColor: '#1A1A1A', padding: 24, borderRadius: 20, borderLeftWidth: 4, borderLeftColor: '#0052CC', marginBottom: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 },
  cardTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold', flex: 1 },
  label: { color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  bodyText: { color: '#DDD', fontSize: 15, lineHeight: 22, marginBottom: 15 },
  wedgeText: { color: '#0052CC', fontSize: 16, fontWeight: '600', fontStyle: 'italic' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 15 },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 40, fontSize: 16 },
});