/**
 * App.tsx - v1.28 (Nuclear Print Override & Cloud History UI)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Defeats WebKit page clipping, persists sessions, and introduces the History Engine to view past cloud briefs.
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
  
  // 🚨 NEW STATE: View routing for Radar vs History
  const [viewMode, setViewMode] = useState<'radar' | 'history'>('radar');
  const [historyArchive, setHistoryArchive] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  const [statusText, setStatusText] = useState(''); 
  const [loadingTip, setLoadingTip] = useState('');
  
  const [hasError, setHasError] = useState(false); 
  const [feedbackLedger, setFeedbackLedger] = useState<string[]>([]);
  const [votedCards, setVotedCards] = useState<{[key: string]: 'up' | 'down'}>({});

  useEffect(() => {
    const rehydrateSession = async () => {
      try {
        const savedToken = await AsyncStorage.getItem('@jaja_auth_token');
        if (savedToken) setToken(savedToken);
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
        if (data && !error) setFeedbackLedger(data.map(row => row.rule_text));
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
    if (token && viewMode === 'radar' && !battlePlan) {
      executeBattlePlanPipeline(token);
    }
  }, [token, viewMode]);

  // 🚨 NEW LOGIC: Fetch the last 5 briefings from Supabase
  const loadHistory = async () => {
    setViewMode('history');
    setIsLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('briefings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && !error) {
        setHistoryArchive(data);
      }
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // 🚨 PATCH: Nuclear CSS override to force full-height printing
  const exportBriefingToPDF = async (planToExport: BattlePlanState, dateString: string) => {
    setIsExporting(true);
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              /* 🚨 NUCLEAR OVERRIDE: Destroys WebKit's 100vh lock */
              @media print {
                @page { margin: 20mm; size: auto; }
                html, body, #root { 
                  height: auto !important; 
                  min-height: 100% !important; 
                  max-height: none !important;
                  overflow: visible !important; 
                  display: block !important;
                  position: static !important;
                }
              }
              body { font-family: 'Helvetica Neue', Helvetica, sans-serif; color: #111; line-height: 1.6; margin: 0; padding: 20px; }
              .header { border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 30px; }
              .logo { font-size: 24px; font-weight: 800; letter-spacing: -1px; text-transform: uppercase; }
              .date { color: #666; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }
              h1 { font-size: 28px; font-weight: 700; margin-bottom: 10px; }
              .brief { font-size: 18px; color: #333; margin-bottom: 30px; }
              .metrics { display: flex; gap: 20px; margin-bottom: 40px; flex-wrap: wrap; }
              .metric-box { background: #F5F5F5; padding: 15px 20px; border-radius: 8px; margin-bottom: 10px; }
              .metric-val { font-size: 20px; font-weight: 800; }
              .metric-label { font-size: 12px; color: #666; text-transform: uppercase; font-weight: 700; }
              .section-title { font-size: 20px; font-weight: 700; border-bottom: 1px solid #EEE; padding-bottom: 10px; margin-top: 40px; margin-bottom: 20px; }
              /* Force cards to stay together on page breaks */
              .card { margin-bottom: 30px; page-break-inside: avoid; break-inside: avoid; display: block; }
              .card-title { font-size: 18px; font-weight: 700; margin-bottom: 10px; }
              .label { font-size: 10px; color: #888; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; display: block; }
              .text { font-size: 14px; color: #333; margin-bottom: 15px; display: block; }
              .prep { color: #8C6239; font-weight: 600; }
              .wedge { font-style: italic; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="logo">Fallen Crown BV</div>
              <div class="date">Executive Briefing | ${dateString}</div>
            </div>
            <h1>At a Glance</h1>
            <div class="brief">${planToExport.atAGlance}</div>
            <div class="metrics">
              ${planToExport.weeklyStats.map(stat => `
                <div class="metric-box">
                  <div class="metric-val">${stat.count}</div>
                  <div class="metric-label">${stat.label}</div>
                </div>
              `).join('')}
            </div>
            ${planToExport.businessEngagements.length > 0 ? `
              <div class="section-title">Business & Productivity</div>
              ${planToExport.businessEngagements.map(item => `
                <div class="card">
                  <div class="card-title">${item.title}</div>
                  <div class="label">OBJECTIVE</div><div class="text">${item.objective}</div>
                  <div class="label">TACTICAL PREP</div><div class="text prep">${item.prep}</div>
                  <div class="label">THE WEDGE</div><div class="text wedge">${item.wedge}</div>
                </div>
              `).join('')}
            ` : ''}
            ${planToExport.leisureEngagements.length > 0 ? `
              <div class="section-title">Leisure & Personal</div>
              ${planToExport.leisureEngagements.map(item => `
                <div class="card">
                  <div class="card-title">${item.title}</div>
                  <div class="label">OBJECTIVE</div><div class="text">${item.objective}</div>
                  <div class="label">RESEARCH & LOGISTICS</div><div class="text prep">${item.prep}</div>
                  <div class="label">PRESENCE STANDARD</div><div class="text wedge">${item.wedge}</div>
                </div>
              `).join('')}
            ` : ''}
          </body>
        </html>
      `;

      if (Platform.OS === 'web') {
        await Print.printAsync({ html: htmlContent });
      } else {
        const { uri } = await Print.printToFileAsync({ html: htmlContent });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } else {
          Alert.alert('Error', 'Sharing is not available on this device.');
        }
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to generate PDF document.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownvote = async (title: string, wedge: string, index: number) => {
    setVotedCards(prev => ({ ...prev, [`${title}-${index}`]: 'down' }));
    const newRule = `For the event '${title}', you suggested: "${wedge}". The user REJECTED this. Shift your approach to be more grounded and specific next time.`;
    const updatedLedger = [...feedbackLedger, newRule].slice(-10);
    setFeedbackLedger(updatedLedger);
    try { await supabase.from('feedback_ledger').insert([{ rule_text: newRule }]); } catch (e) { console.error(e); }
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
          if (eventsData.items) rawEvents = rawEvents.concat(eventsData.items);
        } catch (err: any) {
          if (err.message === "TOKEN_EXPIRED") throw err; 
        }
      }));

      const uniqueEventsMap = new Map();
      rawEvents.forEach((event) => {
        const timeKey = event.start?.dateTime || event.start?.date;
        const compositeKey = `${event.summary}-${timeKey}`;
        if (!uniqueEventsMap.has(compositeKey)) uniqueEventsMap.set(compositeKey, event);
      });
      
      let deduplicatedEvents = Array.from(uniqueEventsMap.values());
      deduplicatedEvents.sort((a, b) => {
        const dateA = new Date(a.start?.dateTime || a.start?.date).getTime();
        const dateB = new Date(b.start?.dateTime || b.start?.date).getTime();
        return dateA - dateB;
      });

      if (deduplicatedEvents.length === 0) {
        setBattlePlan({ atAGlance: "Your radar is clear.", weeklyStats: [], businessEngagements: [], leisureEngagements: [] });
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
      const feedbackContext = feedbackLedger.length > 0 ? `\nCRITICAL FEEDBACK - AVOID THESE MISTAKES:\n${feedbackLedger.join('\n')}\n` : '';

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

  const renderEventCard = (item: Engagement, index: number, isBusiness: boolean, isHistory: boolean = false) => {
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

        {/* Hide feedback buttons on historical archives */}
        {!isHistory && (
          <View style={styles.feedbackContainer}>
            <Text style={styles.feedbackLabel}>Calibrate</Text>
            <View style={styles.feedbackButtons}>
              <TouchableOpacity style={[styles.voteButton, voteStatus === 'up' && styles.voteButtonActive]} onPress={() => handleUpvote(item.title, index)} disabled={!!voteStatus}>
                <Text style={[styles.voteEmoji, voteStatus === 'up' && styles.voteEmojiActive]}>👍</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.voteButton, voteStatus === 'down' && styles.voteButtonActive]} onPress={() => handleDownvote(item.title, item.wedge, index)} disabled={!!voteStatus}>
                <Text style={[styles.voteEmoji, voteStatus === 'down' && styles.voteEmojiActive]}>👎</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.headerRow}>
          <Text style={styles.header}>{viewMode === 'radar' ? 'Radar' : 'Archive'}</Text>
          <View style={styles.headerActions}>
            
            {/* 🚨 NEW UI: Toggle between Live Radar and Cloud History */}
            {viewMode === 'radar' ? (
              <TouchableOpacity onPress={loadHistory} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>History</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setViewMode('radar')} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Live Radar</Text>
              </TouchableOpacity>
            )}

            {viewMode === 'radar' && battlePlan && (
              <TouchableOpacity onPress={() => exportBriefingToPDF(battlePlan, new Date().toLocaleDateString())} disabled={isExporting} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>{isExporting ? 'Compiling...' : 'Export PDF'}</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity onPress={() => handleSetToken(null)} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ROUTING: Render History Archive */}
        {viewMode === 'history' ? (
          isLoadingHistory ? (
            <ActivityIndicator size="large" color="#111" style={{ marginTop: 60 }} />
          ) : historyArchive.length === 0 ? (
            <Text style={styles.emptyText}>No archived briefings found in the cloud.</Text>
          ) : (
            historyArchive.map((archivedBrief, i) => {
              const formattedDate = new Date(archivedBrief.created_at).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
              
              // We construct a mock BattlePlan object to pass into the PDF generator
              const mappedPlan: BattlePlanState = {
                atAGlance: archivedBrief.at_a_glance,
                weeklyStats: archivedBrief.weekly_stats || [],
                businessEngagements: archivedBrief.business_engagements || [],
                leisureEngagements: archivedBrief.leisure_engagements || []
              };

              return (
                <View key={archivedBrief.id} style={styles.archiveContainer}>
                  <View style={styles.archiveHeaderFlex}>
                    <Text style={styles.archiveDate}>{formattedDate}</Text>
                    <TouchableOpacity onPress={() => exportBriefingToPDF(mappedPlan, formattedDate)} style={styles.archiveExportBtn}>
                      <Text style={styles.archiveExportText}>Export PDF</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.archiveGlance}>{archivedBrief.at_a_glance}</Text>
                </View>
              );
            })
          )
        ) : (
          /* ROUTING: Render Live Radar */
          loading ? (
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
          )
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
  actionBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#EAEAEA', borderRadius: 20 },
  actionBtnText: { color: '#111', fontSize: 11, fontWeight: '700', fontFamily: systemFont, textTransform: 'uppercase', letterSpacing: 0.5 },
  
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

  // Archive UI Styles
  archiveContainer: { backgroundColor: '#FFF', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#EAEAEA', marginBottom: 16 },
  archiveHeaderFlex: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', paddingBottom: 16, marginBottom: 16 },
  archiveDate: { color: '#111', fontSize: 16, fontWeight: '700', fontFamily: systemFont },
  archiveExportBtn: { paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: '#CCC', borderRadius: 12 },
  archiveExportText: { color: '#666', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', fontFamily: systemFont },
  archiveGlance: { color: '#444', fontSize: 14, lineHeight: 22, fontFamily: systemFont }
});