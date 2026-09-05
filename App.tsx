import React from 'react';
import { StyleSheet, Text, View, StatusBar } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content"  />
      <Text style={styles.title}>BLACKOUT</Text>
      <Text style={styles.subtitle}>Physical Privacy Reimagined</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>🟢 SYSTEM READY</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 30,
  },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  badgeText: {
    color: '#10B981',
    fontWeight: '600',
    fontSize: 14,
  },
});