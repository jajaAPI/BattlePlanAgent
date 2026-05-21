/**
 * GoogleLogin.tsx
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Secure OAuth 2.0 handshake requesting Calendar permissions.
 */

import * as React from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export default function GoogleLogin({ onLoginSuccess }: { onLoginSuccess: (token: string) => void }) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    // IMPORTANT: Replace these with your actual IDs from the Google Console
    iosClientId: '326304808014-m9je1149ff6tmvhpm6sl0gdvsic99fsk.apps.googleusercontent.com',
    webClientId: '326304808014-m9je1149ff6tmvhpm6sl0gdvsic99fsk.apps.googleusercontent.com',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  React.useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.accessToken) {
        onLoginSuccess(authentication.accessToken);
      }
    }
  }, [response]);

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.button, !request && styles.buttonDisabled]} 
        disabled={!request}
        onPress={() => promptAsync()}
      >
        <Text style={styles.buttonText}>Authenticate with Google</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center', marginTop: 30 },
  button: { backgroundColor: '#0052CC', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, width: '80%', alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#333' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' }
});