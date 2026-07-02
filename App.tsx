// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — root entry point (final version, all screens wired)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { Linking, StatusBar } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors, Fonts } from './src/theme/pixelTheme';
import { getDatabase, runMigrations } from './src/db/database';
import { NotificationService } from './src/services/NotificationService';
import { handleInternalDeepLink } from './src/services/QRService';

// ─── SCREENS ─────────────────────────────────────────────────────────────────
import HomeScreen         from './src/screens/HomeScreen';
import TrackerScreen      from './src/screens/TrackerScreen';
import FranchiseMapScreen from './src/screens/FranchiseMapScreen';
import SettingsScreen     from './src/screens/SettingsScreen';
import PlatformTagsScreen from './src/screens/PlatformTagsScreen';
import LibraryScreen      from './src/screens/LibraryScreen';
import NowAiringScreen    from './src/screens/NowAiringScreen';
import TrophiesScreen     from './src/screens/TrophiesScreen';
import SearchScreen       from './src/screens/SearchScreen';

// ─── NAVIGATION PARAM LIST ───────────────────────────────────────────────────
export type RootStackParamList = {
  Home:         undefined;
  Tracker:      { title_id: string };
  FranchiseMap: { title_id: string };
  Settings:     undefined;
  PlatformTags: { scanned_platform_id?: string } | undefined;
  Library:      undefined;
  NowAiring:    undefined;
  Trophies:     undefined;
  Search:       undefined;
  CheckIn:      { title_id: string; session_id?: string; episode_label?: string };
  TitleDetail:  { title_id: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── DEEP LINK CONFIG ────────────────────────────────────────────────────────
const linking = {
  prefixes: ['omniresume://'],
  config: {
    screens: {
      Home:         '',
      Tracker:      'tracker/:title_id',
      FranchiseMap: 'franchise/:title_id',
      Settings:     'settings',
      PlatformTags: 'platform-tags',
      Library:      'library',
      NowAiring:    'now-airing',
      Trophies:     'trophies',
      Search:       'search',
      CheckIn:      'checkin/:title_id',
      TitleDetail:  'title/:title_id',
    },
  },
};

const screenOptions = {
  headerStyle:      { backgroundColor: Colors.panel },
  headerTitleStyle: { fontFamily: 'PressStart2P-Regular', fontSize: 10, color: Colors.gold },
  headerTintColor:  Colors.gold,
  animation:        'fade' as const,
};

// ─── ROOT ────────────────────────────────────────────────────────────────────
export default function App() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    // Bootstrap DB — runs migrations and sets up all tables
    runMigrations().catch(e => console.error('[App] DB migration failed:', e));
    NotificationService.init().catch(e => console.error('[App] Notif init failed:', e));

    if (navigationRef.current) {
      NotificationService.setNavigationRef(navigationRef.current);
    }

    const sub = Linking.addEventListener('url', ({ url }) => {
      handleInternalDeepLink(url, platformId => {
        navigationRef.current?.navigate('PlatformTags', { scanned_platform_id: platformId });
      });
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.void} />
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        theme={{
          dark: true,
          colors: {
            primary:      Colors.gold,
            background:   Colors.void,
            card:         Colors.panel,
            text:         Colors.cream,
            border:       Colors.borderMid,
            notification: Colors.coral,
          },
        }}
      >
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen name="Home"         component={HomeScreen}         options={{ headerShown: false }} />
          <Stack.Screen name="Tracker"      component={TrackerScreen}      options={{ title: 'TRACKER' }} />
          <Stack.Screen name="FranchiseMap" component={FranchiseMapScreen} options={{ title: 'FRANCHISE MAP' }} />
          <Stack.Screen name="Library"      component={LibraryScreen}      options={{ title: 'MY LIBRARY' }} />
          <Stack.Screen name="Search"       component={SearchScreen}       options={{ title: 'SEARCH ANIME' }} />
          <Stack.Screen name="NowAiring"    component={NowAiringScreen}    options={{ title: 'NOW AIRING' }} />
          <Stack.Screen name="Trophies"     component={TrophiesScreen}     options={{ title: 'TROPHIES' }} />
          <Stack.Screen name="Settings"     component={SettingsScreen}     options={{ title: 'SETTINGS' }} />
          <Stack.Screen name="PlatformTags" component={PlatformTagsScreen} options={{ title: 'PLATFORM TAGS' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
