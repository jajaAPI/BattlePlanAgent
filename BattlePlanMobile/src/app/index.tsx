/**
 * App.tsx - v1.3 (Live Calendar Feed)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Fetches live data and renders the Battle Plan.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';

// 🚨 CORRECTED PATH 🚨
// Because GoogleLogin.tsx is sitting right next to index.tsx inside src/app/, we use './'
import GoogleLogin from './GoogleLogin';

export default function App() {
  // State management for OAuth token and fetched meetings
  const [token, setToken] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Trigger the fetch the moment the token state is populated
  useEffect(() => {
    if (token) {
      fetchCalendarEvents(token);
    }
  }, [token]);

  // Async function to hit the Google Calendar API
  const fetchCalendarEvents = async (accessToken: string) => {
    setLoading(true);
    try {
      // Set the time window: Now until 24 hours from now
      const now = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(now.getDate() + 1);

      // Fetch from Google's primary calendar endpoint
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${tomorrow.toISOString()}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await response.json();
      
      // Filter out solo blocks (events with no attendees) to focus only on actual meetings
      const validMeetings = (data.items || []).filter((e: any) => e.attendees && e.attendees.length > 0);
      setMeetings(validMeetings);
    } catch (error) {
      console.error("Calendar Sync Failed:", error);
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
          
          {/* Inject the Google Login button component */}
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
          
          {/* Logout button resets token to null, forcing the auth screen to render */}
          <TouchableOpacity onPress={() => setToken(null)}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        {/* Conditional rendering based on API fetch state */}
        {loading ? (
          <ActivityIndicator size="large" color="#0052CC" style={{ marginTop: 50 }} />
        ) : meetings.length === 0 ? (
          <Text style={styles.emptyText}>No external meetings found for the next 24 hours.</Text>
        ) : (
          // Map through the live meeting data and render cards
          meetings.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.summary || "Untitled Event"}</Text>
              
              <Text style={styles.label}>AI PENDING</Text>
              <Text style={styles.bodyText}>Gemini synthesis not yet connected to this client.</Text>
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
  card: { backgroundColor: '#1A1A1A', padding: 24, borderRadius: 20, borderLeftWidth: 4, borderLeftColor: '#333', marginBottom: 20 },
  cardTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  label: { color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  bodyText: { color: '#888', fontSize: 15, fontStyle: 'italic' },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 40, fontSize: 16 },
});