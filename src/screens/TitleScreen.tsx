// ─────────────────────────────────────────────────────────────────────────────
// src/screens/TitleScreen.tsx
// Retro SNES-style title screen — the app's front door. Blinking "PRESS
// START" prompt, AniList sign-in, and a way into Settings before you ever
// touch your library. Sets the game-console tone for everything after it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { PixelButton } from '../components/PixelUI';
import { query } from '../db/database';
import { launchOAuthFlow } from '../services/AniListClient';

export default function TitleScreen() {
  const navigation = useNavigation<any>();
  const [connected, setConnected] = useState(false);
  const blink = useRef(new Animated.Value(1)).current;

  const checkConnection = useCallback(async () => {
    const rows = await query<{ external_user_id: string }>(
      `SELECT external_user_id FROM user_external_account WHERE provider='ANILIST' LIMIT 1`,
    );
    setConnected(rows.length > 0);
  }, []);

  // Re-check whenever this screen regains focus (e.g. returning from the
  // AniList OAuth browser flow, or after disconnecting in Settings).
  useFocusEffect(useCallback(() => { checkConnection(); }, [checkConnection]));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  const handleStart = () => {
    navigation.replace('Home');
  };

  const handleConnect = () => {
    Alert.alert(
      'Connect AniList',
      "You'll be taken to AniList to authorize Omni-Resume to read your watch list.\n\nOmni-Resume only reads your list — it never posts or modifies anything automatically.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open AniList', onPress: launchOAuthFlow },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.crt}>
        <Text style={styles.kicker}>ANIME WATCH TRACKER</Text>
        <Text style={styles.titleLine1}>OMNI</Text>
        <Text style={styles.titleLine2}>RESUME</Text>

        <View style={styles.menu}>
          <TouchableOpacity onPress={handleStart} activeOpacity={0.7}>
            <Animated.Text style={[styles.pressStart, { opacity: blink }]}>
              ▶ PRESS START
            </Animated.Text>
          </TouchableOpacity>

          <View style={styles.accountRow}>
            <View style={[styles.dot, { backgroundColor: connected ? Colors.mint : Colors.dim }]} />
            <Text style={styles.accountLabel}>
              {connected ? 'ANILIST CONNECTED' : 'ANILIST NOT CONNECTED'}
            </Text>
          </View>

          {!connected && (
            <PixelButton
              label="CONNECT ANILIST"
              onPress={handleConnect}
              color={Colors.gold}
              style={{ marginTop: Spacing.sm }}
            />
          )}

          <PixelButton
            label="SETTINGS"
            onPress={() => navigation.navigate('Settings')}
            color={Colors.borderMid}
            textColor={Colors.cream}
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      </View>

      <Text style={styles.footer}>© OMNI-RESUME · NOT AFFILIATED WITH ANILIST</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.void,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  crt: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: Colors.panel,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    ...bevelBorder(4),
  },
  kicker: {
    fontFamily: Fonts.body,
    fontSize: FontSizes.bodySm,
    color: Colors.dim,
    letterSpacing: 3,
    marginBottom: Spacing.lg,
  },
  titleLine1: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLg,
    color: Colors.gold,
    letterSpacing: 2,
  },
  titleLine2: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLg,
    color: Colors.cream,
    letterSpacing: 2,
    marginBottom: Spacing.xxl,
  },
  menu: {
    alignItems: 'center',
    width: '100%',
    gap: Spacing.sm,
  },
  pressStart: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySm,
    color: Colors.mint,
    letterSpacing: 1,
    marginBottom: Spacing.lg,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
  },
  accountLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSizes.bodySm,
    color: Colors.dim,
    letterSpacing: 1,
  },
  footer: {
    fontFamily: Fonts.body,
    fontSize: FontSizes.bodySm,
    color: Colors.borderMid,
    marginTop: Spacing.xl,
    letterSpacing: 0.5,
  },
});
