/**
 * App.tsx - v1.11 (Omni-Radar Timeline)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Fetches live Calendar data from ALL active user calendars (7-day horizon) and synthesizes tactical Battle Plans.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';

import GoogleLogin from './GoogleLogin';

// Initialize the Gemini AI client using the secure environment variable
const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [battlePlan, setBattlePlan] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState(''); 

  useEffect(() => {
    if (token) {
      executeBattlePlanPipeline(token);
    }
  }, [token]);

  const executeBattlePlanPipeline = async (accessToken: string) => {
    setLoading(true);
    
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
      let allEvents: any[] = [];

      // STEP 2: Fire parallel requests to every active calendar to scrape their events
      // We use Promise.all to execute these simultaneously for speed
      await Promise.all(activeCalendars.map(async (calendar: any) => {
        try {
          // encodeURIComponent is critical here because calendar IDs are often email addresses with special characters
          const eventsResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?timeMin=${startOfToday.toISOString()}&timeMax=${horizonDate.toISOString()}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const eventsData = await eventsResponse.json();
          
          if (eventsData.items) {
            allEvents = allEvents.concat(eventsData.items);
          }
        } catch (err) {
          console.warn(`Failed to pull data from calendar layer: ${calendar.id}`, err);
        }
      }));

      // STEP 3: Sort the flattened array chronologically so the AI reads it in chronological order
      allEvents.sort((a, b) => {
        const dateA = new Date(a.start?.dateTime || a.start?.date).getTime();
        const dateB = new Date(b.start?.dateTime || b.start?.date).getTime();
        return dateA - dateB;
      });

      if (allEvents.length === 0) {
        setBattlePlan([]);
        setLoading(false);
        return;
      }

      // Format data to explicitly tell Gemini what type of event it is handling
      const promptData = allEvents.map((m: any) => {
        const isAllDay = m.start?.date ? "ALL-DAY TASK" : "TIMED EVENT";
        return `Event: ${m.summary} | Type: ${isAllDay} | Attendees: ${m.attendees?.length || 'Solo Block'} | Description: ${m.description?.substring(0, 100) || 'None'}`;
      }).join('\n');

      setStatusText('Synthesizing Tactical Wedges...');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      const prompt = `
        You are a brutally honest, highly strategic Solution Engineer advisor for Jaja at Fallen Crown BV. 
        Analyze the following schedule. For each event, generate a tactical 'Battle Plan' object.
        
        Rules:
        1. 'objective': One brutal, objective sentence on the actual goal of this event.
        2. 'wedge': If it's a meeting, provide a sharp question to control the room. If it's a solo block/all-day task, provide a ruthless standard to hold Jaja accountable.
        
        Raw Schedule:
        ${promptData}
        
        Output strictly as a JSON array of objects with keys: "id" (string), "title" (string), "objective" (string), "wedge" (string). Do not include markdown blocks like \`\`\`json.
      `;

      const aiResponse = await model.generateContent(prompt);
      let aiText = aiResponse.response.text();
      
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const synthesizedPlan = JSON.parse(aiText);
      setBattlePlan(synthesizedPlan);

    } catch (error) {
      console.error("Pipeline Failed:", error);
      setStatusText('CRITICAL ERROR: Pipeline Failure');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authBox}>
          <Text style={styles.authHeader}>Fallen Crown BV</Text>
          <Text style={styles.authSubtext}>Secure Access Required</Text>
          <GoogleLogin onLoginSuccess={(accessToken) => setToken(accessToken)} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.headerRow}>
          <Text style={styles.header}>🎯 Battle Plan</Text>
          <TouchableOpacity onPress={() => setToken(null)}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0052CC" />
            <Text style={styles.loadingText}>{statusText}</Text>
          </View>
        ) : battlePlan.length === 0 ? (
          <Text style={styles.emptyText}>No events found across any calendars for the next 7 days.</Text>
        ) : (
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