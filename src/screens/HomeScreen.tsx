// ─────────────────────────────────────────────────────────────────────────────
// src/screens/HomeScreen.tsx
// Main dashboard. Renders the Omni-Resume Status Window, Command Menu,
// Quest Log, and franchise map if applicable. Wires up all §7 capture paths.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet, StatusBar,
  RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing } from '../theme/pixelTheme';
import {
  OmniResumeCard, Panel, PixelButton,
  EpisodeGrid, CheckInSheet,
} from '../components/PixelUI';
import type { ProgressPayload, ActiveMode, Episode } from '../types';
import { resolve, launchDeepLink } from '../services/ResumeResolver';
import {
  getMostRecentlyActive, getOpenSession,
  startWatchSession, recordWatchProgress, closeModeSession,
  startPlaySession, savePlayProgress, maybeRaiseArcGate,
  confirmMigration, storeNotificationRef,
} from '../db/dao/ProgressDAO';
import { getEpisodesForTitle } from '../db/dao/TitleDAO';
import { NotificationService } from '../services/NotificationService';
import { useNavigation } from '@react-navigation/native';

const USER_REGION = 'US'; // TODO: detect from device locale

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [payload, setPayload] = useState<ProgressPayload | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPayload = useCallback(async () => {
    const recent = await getMostRecentlyActive();
    if (!recent) { setPayload(null); setLoading(false); return; }

    const result = await resolve({ titleId: recent.title_id, region: USER_REGION });
    setPayload(result);

    if (result?.episode) {
      const eps = await getEpisodesForTitle(recent.title_id);
      setEpisodes(eps);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      // §7.1a: check for an open session on every screen focus (user returning from a platform)
      const checkOpenSession = async () => {
        const recent = await getMostRecentlyActive();
        if (!recent) { await loadPayload(); return; }

        const session = await getOpenSession(recent.title_id);
        if (session && !session.ended_at) {
          setOpenSessionId(session.session_id);
          setShowCheckIn(true); // Surface the check-in sheet immediately
        }
        await loadPayload();
      };
      checkOpenSession();
    }, [loadPayload]),
  );

  const handleInstantContinue = async () => {
    if (!payload) return;
    const { progress, resume_recommendation } = payload;
    if (!resume_recommendation.deep_link) return;

    if (!progress.watch_episode_id) return;

    // Open the session before leaving the app
    const session = await startWatchSession(
      progress.title_id,
      progress.watch_episode_id,
      progress.last_platform_id ?? resume_recommendation.to_platform_id ?? '',
    );

    // §7.1e: schedule dozed-off detection notification
    if (payload.episode?.runtime_ms) {
      const epLabel = `${payload.title.english_title ?? payload.title.romaji_title} EP ${payload.episode.absolute_number}`;
      const notifRef = await NotificationService.scheduleDozedOff(
        session.session_id,
        progress.title_id,
        epLabel,
        payload.episode.runtime_ms,
        epLabel,
      );
      // Store the notification ref so closeModeSession can cancel it (§7.2 side effect 1)
      await storeNotificationRef(session.session_id, notifRef);
    }

    setOpenSessionId(session.session_id);
    await launchDeepLink(resume_recommendation.deep_link);
  };

  const handleMigrationConfirm = async () => {
    if (!payload || !payload.resume_recommendation.to_platform_id) return;
    await confirmMigration(payload.progress.title_id, payload.resume_recommendation.to_platform_id);
    if (payload.resume_recommendation.deep_link) {
      await launchDeepLink(payload.resume_recommendation.deep_link);
    }
    await loadPayload();
  };

  const handleModeChange = async (mode: ActiveMode) => {
    if (!payload) return;
    if (mode === 'PLAY') {
      await startPlaySession(payload.progress.title_id);
      navigation.navigate('Companion', { title_id: payload.progress.title_id });
    } else {
      // Switch back to Watch — reload to re-run resolver
      await loadPayload();
    }
  };

  // ── Check-in handlers (§7.1a) ──

  const handleFinished = async () => {
    if (!payload || !payload.progress.watch_episode_id) return;
    const { progress, episode } = payload;

    await recordWatchProgress(
      progress.title_id,
      progress.watch_episode_id,
      payload.episode?.runtime_ms ?? 0,
      progress.last_platform_id ?? '',
      'COMPLETED',
      'MANUAL',
    );

    if (openSessionId) {
      await closeModeSession(openSessionId, 'COMPLETED');
    }

    // Raise arc gate if last ep in arc
    if (episode?.absolute_number) {
      const raised = await maybeRaiseArcGate(progress.title_id, episode.absolute_number);
      if (raised) {
        Alert.alert('🎉 ARC COMPLETE', 'Play mode content for the next arc is now unlocked!');
      }
    }

    setShowCheckIn(false);
    setOpenSessionId(null);
    await loadPayload();
  };

  const handleStillWatching = async (timestampMs: number) => {
    if (!payload || !payload.progress.watch_episode_id) return;
    const { progress } = payload;

    await recordWatchProgress(
      progress.title_id,
      progress.watch_episode_id,
      timestampMs,
      progress.last_platform_id ?? '',
      'PAUSED',
      'MANUAL',
    );

    if (openSessionId) {
      await closeModeSession(openSessionId, 'PAUSED');
    }

    setShowCheckIn(false);
    setOpenSessionId(null);
    await loadPayload();
  };

  const handleNothingChanged = async () => {
    // §7.2: closeModeSession is not a no-op here — it applies the STREAMING→PAUSED safety net
    if (openSessionId) {
      await closeModeSession(openSessionId, 'BACKGROUNDED');
    }
    setShowCheckIn(false);
    setOpenSessionId(null);
    await loadPayload();
  };

  // ── Episode tile tap (§7.1b) ──

  const handleEpisodeTap = async (episodeId: string, absoluteNumber: number) => {
    if (!payload) return;
    const { progress } = payload;

    const currentAbs = episodes.find(e => e.episode_id === progress.watch_episode_id)?.absolute_number ?? 0;
    if (absoluteNumber <= currentAbs) {
      // Tapping a watched tile — already done
      Alert.alert('Already watched', `You've seen up to episode ${currentAbs}.`);
      return;
    }

    Alert.alert(
      'Mark as watched?',
      `Mark everything through Episode ${absoluteNumber} as watched?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          onPress: async () => {
            await recordWatchProgress(
              progress.title_id,
              episodeId,
              0,
              progress.last_platform_id ?? '',
              absoluteNumber === (payload.title.total_episodes ?? 0) ? 'COMPLETED' : 'PAUSED',
              'MANUAL',
            );
            await loadPayload();
          },
        },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPayload();
    setRefreshing(false);
  };

  // Compute episode states for the grid
  const currentAbsolute = episodes.find(
    e => e.episode_id === payload?.progress.watch_episode_id,
  )?.absolute_number ?? 0;

  const episodeStates = episodes.map(ep => ({
    ...ep,
    status: (ep.absolute_number < currentAbsolute
      ? 'watched'
      : ep.absolute_number === currentAbsolute
      ? 'current'
      : ep.canonical_kind === 'OVA' || ep.canonical_kind === 'SPECIAL'
      ? 'ova'
      : 'upcoming') as 'watched' | 'current' | 'upcoming' | 'ova',
  }));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.void} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />}
      >
        {/* Title */}
        <View style={styles.titleScreen}>
          <Text style={styles.titleText}>OMNI-RESUME</Text>
          <Text style={styles.titleSub}>▶ ANIME QUEST TRACKER</Text>
        </View>

        {/* Check-in sheet — appears on return from a streaming platform */}
        {showCheckIn && payload && (
          <CheckInSheet
            episodeLabel={payload.episode
              ? `${payload.title.english_title ?? payload.title.romaji_title} · EP ${payload.episode.absolute_number}`
              : payload.title.english_title ?? payload.title.romaji_title}
            estimatedTimestampMs={payload.progress.watch_timestamp_ms}
            onFinished={handleFinished}
            onStillWatching={handleStillWatching}
            onNothingChanged={handleNothingChanged}
          />
        )}

        {/* Main status card */}
        {payload && !showCheckIn && (
          <OmniResumeCard
            payload={payload}
            onInstantContinue={handleInstantContinue}
            onModeChange={handleModeChange}
            onMigrationConfirm={handleMigrationConfirm}
            region={USER_REGION}
          />
        )}

        {!payload && !loading && (
          <Panel label="STATUS WINDOW">
            <Text style={styles.emptyText}>No active titles.{'\n'}Search to add your first anime.</Text>
            <PixelButton
              label="ADD ANIME"
              onPress={() => navigation.navigate('Search')}
              color={Colors.gold}
            />
          </Panel>
        )}

        {/* Episode quest log */}
        {episodeStates.length > 0 && payload && !showCheckIn && (
          <Panel label="QUEST LOG: EPISODES">
            <EpisodeGrid episodes={episodeStates} onTileTap={handleEpisodeTap} />
            <View style={styles.legend}>
              <Text style={styles.legendItem}><Text style={{ color: Colors.mint }}>✓</Text> watched</Text>
              <Text style={styles.legendItem}><Text style={{ color: Colors.gold }}>◉</Text> current</Text>
              <Text style={styles.legendItem}><Text style={{ color: Colors.borderMid }}>▢</Text> upcoming</Text>
              <Text style={styles.legendItem}><Text style={{ color: Colors.violet }}>★</Text> ova</Text>
            </View>
          </Panel>
        )}

        {/* Navigation buttons */}
        <Panel>
          <PixelButton label="MY LIBRARY"     onPress={() => navigation.navigate('Library')} color={Colors.borderMid} textColor={Colors.cream} />
          <View style={{ height: Spacing.sm }} />
          <PixelButton label="NOW AIRING"     onPress={() => navigation.navigate('NowAiring')} color={Colors.borderMid} textColor={Colors.cream} />
          <View style={{ height: Spacing.sm }} />
          <PixelButton label="TROPHIES"       onPress={() => navigation.navigate('Trophies')} color={Colors.borderMid} textColor={Colors.cream} />
          <View style={{ height: Spacing.sm }} />
          <PixelButton label="SETTINGS"       onPress={() => navigation.navigate('Settings')} color={Colors.borderMid} textColor={Colors.cream} />
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  scroll: { flex: 1 },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  titleScreen: { alignItems: 'center', paddingVertical: Spacing.lg },
  titleText: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayLg,
    color: Colors.gold,
    textShadowColor: Colors.coral, textShadowOffset: { width: 3, height: 3 }, textShadowRadius: 0,
    letterSpacing: 2,
  },
  titleSub: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayXs,
    color: Colors.dim, letterSpacing: 3, marginTop: 8,
  },
  emptyText: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim,
    marginBottom: Spacing.md, lineHeight: 28,
  },
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
    borderTopWidth: 2, borderTopColor: Colors.borderMid,
    marginTop: Spacing.md, paddingTop: Spacing.sm,
  },
  legendItem: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
});
