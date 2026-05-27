/**
 * supabase.ts
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Initializes the Supabase client using secure environment variables.
 * Includes a Server-Side Rendering (SSR) safe storage wrapper to prevent Node.js crashes on Expo Web.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// 🚨 ARCHITECTURAL FIX: Zero-Dependency WebSocket Mock
if (typeof global.WebSocket === 'undefined') {
  (global as any).WebSocket = class {};
}

// 🚨 ARCHITECTURAL FIX: SSR-Safe Storage Adapter
// Protects the Metro bundler from crashing when Node.js tries to access the browser's 'window' object
const SafeStorage = {
  getItem: (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    AsyncStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    AsyncStorage.removeItem(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Export the initialized client using our custom SafeStorage wrapper
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SafeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});