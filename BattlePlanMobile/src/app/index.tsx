/**
 * App.tsx - v1.27 (IFrame Print Engine)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Connects to Supabase, persists auth, archives briefs, and implements a multi-page web print engine.
 */

import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { GoogleGenerativeAI } from '@google/generative-ai';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import GoogleLogin from './GoogleLogin';
import { supabase } from '../lib/supabase';

const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_API_KEY!);

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
  const [isExporting, setIsExporting] = useState(false);
  
  const [statusText, setStatusText] = useState(''); 
  const [loadingTip, setLoadingTip] = useState('');
  
  const [hasError, setHasError] = useState(false); 
  const [feedbackLedger, setFeedbackLedger] = useState<string[]>([]);
  const [votedCards, setVotedCards] = useState<{[key: string]: 'up' | 'down'}>({});

  useEffect(() => {
    const rehydrateSession = async () => {
      try {
        const savedToken = await AsyncStorage.getItem('@jaja_auth_token');
        if (savedToken) {
          setToken(savedToken);
        }
      } catch (e) {
        console.error("Failed to rehydrate session:", e);
      }
    };
    rehydrateSession();
  }, []);

  const handleSetToken = async (newToken: string | null) => {
    setToken(newToken);
    if (newToken) {
      await AsyncStorage.setItem('@jaja_auth_token', newToken);
    } else {
      await AsyncStorage.removeItem('@jaja_auth_token');
    }
  };

  useEffect(() => {
    const loadCloudFeedback = async () => {
      try {
        const { data, error } = await supabase
          .from('feedback_ledger')
          .select('rule_text')
          .order('created_at', { ascending: false })
          .limit(10);
          
        if (data && !error) {
          setFeedbackLedger(data.map(row => row.rule_text));
        }
      } catch (e) {
        console.error("Failed to load cloud ledger", e);
      }
    };
    loadCloudFeedback();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      const tips = [
        "Calibrating strategic objectives...",
        "Pulling latest parameters from the cloud ledger...",
        "Cross-referencing leisure with presence standards...",
        "Identifying tactical wedges for upcoming meetings...",
        "Archiving data to secure storage..."
      ];
      let i = 0;
      setLoadingTip(tips[0]);
      interval = setInterval(() => {
        i = (i + 1) % tips.length;
        setLoadingTip(tips[i]);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (token) {
      executeBattlePlanPipeline(token);
    }
  }, [token]);

  // 🚨 PATCH: IFrame Printing Engine
  const exportBriefingToPDF = async () => {
    if (!battlePlan) return;
    setIsExporting(true);

    try {
      const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      
      const htmlContent = `
        <html>
          <head>
            <style>
              @page { size: auto; margin: 20mm; }
              body { font-family: 'Helvetica Neue', Helvetica, sans-serif; color: #111; line-height: 1.6; }
              .card { page-break-inside: avoid; margin-bottom: 30px; }
              .section-title { margin-top: 40px; border-bottom: 1px solid #000; }
            </style>
          </head>
          <body>
            <h1>Executive Briefing | ${today}</h1>
            <p>${battlePlan.atAGlance}</p>
            ${battlePlan.businessEngagements.map(item => `
              <div class="card">
                <h3>${item.title}</h3>
                <p><b>Objective:</b> ${item.objective}</p>
                <p><b>Prep:</b> ${item.prep}</p>
              </div>
            `).join('')}
          </body>
        </html>
      `;

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
          printWindow.close();
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html: htmlContent });
        await Sharing.shareAsync(uri);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to render PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownvote = async (title: string, wedge: string, index: number) => {
    setVotedCards(prev => ({ ...prev, [`${title}-${index}`]: 'down' }));
    const newRule = `For the event '${title}', you suggested: "${wedge}". The user REJECTED this. Shift your approach to be more grounded and specific next time.`;
    const updatedLedger = [...feedbackLedger, newRule].slice(-10);
    setFeedbackLedger(updatedLedger);
    
    try {
      await supabase.from('feedback_ledger').insert([{ rule_text: newRule }]);
    } catch (e) {
      console.error("Cloud sync failed:", e);
    }
  };

  const handleUpvote = (title: string, index: number) => {
    setVotedCards(prev => ({ ...prev, [`${title}-${index}`]: 'up' }));
  };

  const executeBattlePlanPipeline = async (accessToken: string) => {
    setLoading(true);
    setHasError(false); 
    setVotedCards({}); 
    
    try {
      setStatusText('Syncing Calendar Topology...');
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const horizonDate = new Date();
      horizonDate.setDate(startOfToday.getDate() + 7);

      const calendarListResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      if (calendarListResponse.status === 401) throw new Error("TOKEN_EXPIRED");
      
      const calendarListData = await calendarListResponse.json();
      const activeCalendars = (calendarListData.items || []).filter((c: any) => c.selected);

      setStatusText(`Pulling ${activeCalendars.length} Data Layers...`);
      let rawEvents: any[] = [];

      await Promise.all(activeCalendars.map(async (calendar: any) => {
        try {
          const eventsResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?timeMin=${startOfToday.toISOString()}&timeMax=${horizonDate.toISOString()}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          
          if (eventsResponse.status === 401) throw new Error("TOKEN_EXPIRED");
          
          const eventsData = await eventsResponse.json();
          if (eventsData.items) {
            rawEvents = rawEvents.concat(eventsData.items);
          }
        } catch (err: any) {
          if (err.message === "TOKEN_EXPIRED") throw err; 
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
          atAGlance: "Your radar is clear. No active engagements detected.", 
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

      setStatusText('Drafting Executive Briefing...');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const feedbackContext = feedbackLedger.length > 0 
        ? `\nCRITICAL FEEDBACK - AVOID THESE MISTAKES:\n${feedbackLedger.join('\n')}\n` 
        : '';

      const prompt = `
        You are a highly competent, loyal, and grounded human Chief of Staff to Jaja at Fallen Crown BV. 
        Analyze the deduplicated schedule. Group minor/routine events to aggressively shorten the list. 
        ${feedbackContext}
        Rules for the JSON object structure:
        1. "atAGlance": A warm, fiercely concise, and highly grounded 2-sentence human briefing. Talk directly to Jaja like a real person. Zero AI filler, zero corporate buzzwords. Just the reality of his week.
        2. "weeklyStats": Array of 3 key metrics (e.g., {"label": "Client Pushes", "count": 4}).
        3. "businessEngagements": Array of clustered business events.
           - "title": Clean event name.
           - "objective": Brutal business goal.
           - "prep": Actionable intelligence (metrics to review, documents to prep).
           - "wedge": A sharp question to control the room.
        4. "leisureEngagements": Array of clustered personal/family events.
           - "title": Event name.
           - "objective": Goal focused on presence, health, or family.
           - "prep": Active research (e.g., highly-rated cafes if location missing, specific gift ideas).
           - "wedge": A mental standard to stay present.
        
        Raw Schedule:
        ${promptData}
        
        Output strictly as JSON. No markdown formatting.
      `;

      const aiResponse = await model.generateContent(prompt);
      let aiText = aiResponse.response.text();
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      const synthesizedPlan = JSON.parse(aiText);
      setBattlePlan(synthesizedPlan);

      try {
        await supabase.from('briefings').insert([{
          at_a_glance: synthesizedPlan.atAGlance,
          weekly_stats: synthesizedPlan.weeklyStats,
          business_engagements: synthesizedPlan.businessEngagements,
          leisure_engagements: synthesizedPlan.leisureEngagements
        }]);
      } catch (cloudError) {
        console.error("Failed to archive briefing:", cloudError);
      }

    } catch (error: any) {
      console.error("Pipeline Failed:", error);
      if (error.message === "TOKEN_EXPIRED") {
        Alert.alert("Session Expired", "Please authenticate again.");
        handleSetToken(null); 
        return;
      }
      setHasError(true);
      setStatusText('CRITICAL ERROR: AI capacity overload.');
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
          <Text style={styles.authSubtext}>Authenticate to sync radar.</Text>
          <GoogleLogin onLoginSuccess={(accessToken) => handleSetToken(accessToken)} />
        </View>
      </SafeAreaView>
    );
  }

  const renderEventCard = (item: Engagement, index: number, isBusiness: boolean) => {
    const cardKey = `${item.title}-${index}`;
    const voteStatus = votedCards[cardKey];

    return (
      <View key={item.id || index.toString()} style={styles.eventCard}>
        <View style={styles.cardHeaderFlex}>
          <Text style={styles.cardTitle}>{item.title}</Text>
        </View>
        <View style={styles.dataGroup}>
          <Text style={styles.label}>OBJECTIVE</Text>
          <Text style={styles.bodyText}>{item.objective}</Text>
        </View>
        <View style={styles.dataGroup}>
          <Text style={styles.label}>{isBusiness ? "TACTICAL PREP" : "RESEARCH & LOGISTICS"}</Text>
          <Text style={styles.prepText}>{item.prep}</Text>
        </View>
        <View style={styles.dataGroup}>
          <Text style={styles.label}>{isBusiness ? "THE WEDGE" : "PRESENCE STANDARD"}</Text>
          <Text style={styles.wedgeText}>{item.wedge}</Text>
        </View>
        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackLabel}>Calibrate</Text>
          <View style={styles.feedbackButtons}>
            <TouchableOpacity 
              style={[styles.voteButton, voteStatus === 'up' && styles.voteButtonActive]} 
              onPress={() => handleUpvote(item.title, index)}
              disabled={!!voteStatus}
            >
              <Text style={[styles.voteEmoji, voteStatus === 'up' && styles.voteEmojiActive]}>👍</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.voteButton, voteStatus === 'down' && styles.voteButtonActive]} 
              onPress={() => handleDownvote(item.title, item.wedge, index)}
              disabled={!!voteStatus}
            >
              <Text style={[styles.voteEmoji, voteStatus === 'down' && styles.voteEmojiActive]}>👎</Text>
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
          <Text style={styles.header}>Radar</Text>
          <View style={styles.headerActions}>
            {battlePlan && (
              <TouchableOpacity onPress={exportBriefingToPDF} disabled={isExporting} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>{isExporting ? 'Compiling...' : 'Export PDF'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleSetToken(null)} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111" />
            <Text style={styles.loadingStatusText}>{statusText}</Text>
            <Text style={styles.loadingTipText}>{loadingTip}</Text>
          </View>
        ) : hasError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorHeader}>Radar Offline</Text>
            <Text style={styles.errorBody}>API capacity exceeded.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => token && executeBattlePlanPipeline(token)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !battlePlan || (battlePlan.businessEngagements.length === 0 && battlePlan.leisureEngagements.length === 0) ? (
          <Text style={styles.emptyText}>Your week is entirely clear.</Text>
        ) : (
          <View>
            <View style={styles.executiveHeader}>
              <Text style={styles.executiveGreeting}>{battlePlan.atAGlance}</Text>
              <View style={styles.metricsRow}>
                {battlePlan.weeklyStats && battlePlan.weeklyStats.map((stat, i) => (
                  <View key={i} style={styles.metricPill}>
                    <Text style={styles.metricValue}>{stat.count}</Text>
                    <Text style={styles.metricLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            {battlePlan.businessEngagements && battlePlan.businessEngagements.length > 0 && (
              <>
                <Text style={styles.sectionTitleMain}>Business</Text>
                {battlePlan.businessEngagements.map((item, index) => renderEventCard(item, index, true))}
              </>
            )}
            {battlePlan.leisureEngagements && battlePlan.leisureEngagements.length > 0 && (
              <>
                <Text style={styles.sectionTitleMain}>Leisure</Text>
                {battlePlan.leisureEngagements.map((item, index) => renderEventCard(item, index, false))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const systemFont = Platform.select({ ios: 'Helvetica Neue', android: 'Roboto', default: 'sans-serif' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 80 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  header: { color: '#111', fontSize: 32, fontWeight: '800', letterSpacing: -1, fontFamily: systemFont },
  headerActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#EEE', borderRadius: 20 },
  actionBtnText: { color: '#333', fontSize: 11, fontWeight: '700', fontFamily: systemFont, textTransform: 'uppercase', letterSpacing: 0.5 },
  authContainer: { flex: 1, backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center' },
  authBox: { width: '85%', alignItems: 'flex-start', padding: 0 },
  authHeader: { color: '#111', fontSize: 36, fontWeight: '800', marginBottom: 8, letterSpacing: -1, fontFamily: systemFont },
  authSubtext: { color: '#666', fontSize: 16, marginBottom: 32, fontFamily: systemFont },
  loadingContainer: { marginTop: 80, alignItems: 'center', paddingHorizontal: 20 },
  loadingStatusText: { color: '#111', marginTop: 24, fontSize: 16, fontWeight: '700', fontFamily: systemFont, textAlign: 'center' },
  loadingTipText: { color: '#888', marginTop: 12, fontSize: 14, fontStyle: 'italic', fontFamily: systemFont, textAlign: 'center', lineHeight: 22 },
  errorContainer: { backgroundColor: '#FFF', padding: 24, borderRadius: 12, borderWidth: 1, borderColor: '#EEE', marginTop: 20 },
  errorHeader: { color: '#111', fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: systemFont },
  errorBody: { color: '#666', fontSize: 14, marginBottom: 20, lineHeight: 20, fontFamily: systemFont },
  retryButton: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 6, alignSelf: 'flex-start' },
  retryText: { color: '#FFF', fontWeight: '600', fontSize: 13, fontFamily: systemFont },
  sectionTitleMain: { color: '#111', fontSize: 22, fontWeight: '700', marginTop: 32, marginBottom: 20, letterSpacing: -0.5, fontFamily: systemFont },
  executiveHeader: { marginBottom: 40, paddingBottom: 32, borderBottomWidth: 1, borderBottomColor: '#EAEAEA' },
  executiveGreeting: { color: '#111', fontSize: 22, lineHeight: 32, fontWeight: '400', marginBottom: 24, fontFamily: systemFont },
  metricsRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  metricPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0F0', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, gap: 8 },
  metricValue: { color: '#111', fontSize: 14, fontWeight: '800', fontFamily: systemFont },
  metricLabel: { color: '#666', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: systemFont },
  eventCard: { backgroundColor: '#FFF', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#EAEAEA', marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  cardHeaderFlex: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  cardTitle: { color: '#111', fontSize: 19, fontWeight: '700', letterSpacing: -0.4, flex: 1, fontFamily: systemFont },
  dataGroup: { marginBottom: 20 },
  label: { color: '#A0A0A0', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase', fontFamily: systemFont },
  bodyText: { color: '#333', fontSize: 15, lineHeight: 22, fontFamily: systemFont },
  prepText: { color: '#8C6239', fontSize: 15, lineHeight: 22, fontWeight: '600', fontFamily: systemFont },
  wedgeText: { color: '#111', fontSize: 15, fontWeight: '600', fontStyle: 'italic', lineHeight: 22, fontFamily: systemFont },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 20 },
  emptyText: { color: '#888', textAlign: 'center', marginTop: 40, fontSize: 15, fontFamily: systemFont },
  feedbackContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  feedbackLabel: { color: '#888', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, fontFamily: systemFont },
  feedbackButtons: { flexDirection: 'row', gap: 8 },
  voteButton: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#FAFAFA', borderRadius: 8, borderWidth: 1, borderColor: '#EAEAEA' },
  voteButtonActive: { backgroundColor: '#EAEAEA', borderColor: '#CCC' },
  voteEmoji: { fontSize: 14, opacity: 0.6 },
  voteEmojiActive: { opacity: 1 },
});