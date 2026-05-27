/**
 * supabase.ts
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Initializes the Supabase client using Expo secure environment variables and local storage for session persistence.
 */

import 'react-native-url-polyfill/auto'; // Required network polyfill for React Native execution
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Pull the exact keys securely from the local .env pipeline
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Export the initialized client with AsyncStorage configured to keep the user logged in across app restarts
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});