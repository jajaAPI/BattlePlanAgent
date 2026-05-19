import React from 'react';
import { StyleSheet, Text, View, ScrollView, SafeAreaView, StatusBar } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>🎯 Battle Plan</Text>

        {/* This is the 'Low-Hanging Fruit' UI we discussed */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>italki: Dutch Lesson</Text>
          
          <Text style={styles.label}>STRATEGIC OBJECTIVE</Text>
          <Text style={styles.bodyText}>
            Master "V2" word order in sub-clauses today. No drift.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.label}>TACTICAL WEDGE</Text>
          <Text style={styles.wedgeText}>
            "Timothy, can we drill sentences starting with 'Omdat' today?"
          </Text>
        </View>

        <Text style={{ color: '#444', textAlign: 'center', marginTop: 30, fontSize: 12 }}>
          Synced for Jaja | Amsterdam
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000', // Stealth mode
  },
  scrollContent: {
    padding: 20,
    paddingTop: 40,
  },
  header: {
    color: '#0052CC', // Atlassian Blue
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 30,
  },
  card: {
    backgroundColor: '#1A1A1A',
    padding: 24,
    borderRadius: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#0052CC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  cardTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  label: {
    color: '#666',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  bodyText: {
    color: '#DDD',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  wedgeText: {
    color: '#0052CC',
    fontSize: 17,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 16,
  },
});