// ─────────────────────────────────────────────────────────────────────────────
// src/screens/SettingsScreen.tsx
// Settings hub. Covers:
//  • Platform subscription management (§0 compliance — declared, not probed)
//  • AniList / MAL import (§13.1)
//  • Notification preferences
//  • Region selector
//  • Platform Tags link (§14)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { Platform as PlatformType, UserSubscription } from '../types';
import {
  getAllPlatforms, getUserSubscriptions,
  upsertSubscription, deactivateSubscription,
} from '../db/dao/TitleDAO';
import { execute, query } from '../db/database';
import { launchOAuthFlow } from '../services/AniListClient';
import { runAniListImport, ImportResult } from '../services/ImportService';

// ─── REGION OPTIONS ──────────────────────────────────────────────────────────

const REGIONS = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
  { code: 'JP', label: 'Japan' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'MX', label: 'Mexico' },
  { code: 'BR', label: 'Brazil' },
];

// ─── SETTING ROW ─────────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string;
  sublabel?: string;
  value?: boolean;
  onToggle?: (v: boolean) => void;
  onPress?: () => void;
  rightLabel?: string;
  color?: string;
}

function SettingRow({ label, sublabel, value, onToggle, onPress, rightLabel, color }: SettingRowProps) {
  return (
    <TouchableOpacity
      style={settingStyles.row}
      onPress={onPress}
      disabled={!onPress && onToggle === undefined}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={settingStyles.rowText}>
        <Text style={[settingStyles.label, color ? { color } : {}]}>{label}</Text>
        {sublabel ? <Text style={settingStyles.sublabel}>{sublabel}</Text> : null}
      </View>
      {onToggle !== undefined && value !== undefined && (
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: Colors.borderMid, true: Colors.gold }}
          thumbColor={value ? Colors.void : Colors.dim}
        />
      )}
      {rightLabel && (
        <Text style={settingStyles.rightLabel}>{rightLabel}</Text>
      )}
      {onPress && !rightLabel && (
        <Text style={settingStyles.arrow}>›</Text>
      )}
    </TouchableOpacity>
  );
}

const settingStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
    gap: Spacing.sm,
  },
  rowText: { flex: 1 },
  label: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream },
  sublabel: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, marginTop: 2 },
  rightLabel: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold },
  arrow: { fontFamily: Fonts.body, fontSize: 28, color: Colors.borderMid },
});

// ─── PLATFORM TOGGLE CARD ────────────────────────────────────────────────────

interface PlatformCardProps {
  platform: PlatformType;
  subscribed: boolean;
  region: string;
  onToggle: (platformId: string, subscribed: boolean) => void;
}

function PlatformCard({ platform, subscribed, region, onToggle }: PlatformCardProps) {
  return (
    <View style={platStyles.card}>
      <View style={platStyles.info}>
        <Text style={platStyles.name}>{platform.display_name}</Text>
        <Text style={platStyles.meta}>
          {platform.auth_type === 'OAUTH' ? '⚡ OAuth' : '📋 Self-declared'}
          {platform.supports_timestamp ? '  ·  ⏱ Timestamp' : ''}
        </Text>
      </View>
      <Switch
        value={subscribed}
        onValueChange={v => onToggle(platform.platform_id, v)}
        trackColor={{ false: Colors.borderMid, true: Colors.gold }}
        thumbColor={subscribed ? Colors.void : Colors.dim}
      />
    </View>
  );
}

const platStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm, gap: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
  },
  info: { flex: 1 },
  name: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream },
  meta: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
});

// ─── ANILIST SECTION ─────────────────────────────────────────────────────────

interface AniListSectionProps {
  region: string;
}

function AniListSection({ region }: AniListSectionProps) {
  const [connected, setConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    const rows = await query<{ last_synced_at: number | null }>(
      `SELECT last_synced_at FROM user_external_account WHERE provider='ANILIST' LIMIT 1`,
    );
    if (rows.length > 0) {
      setConnected(true);
      setLastSynced(rows[0].last_synced_at ?? null);
    }
  }

  const handleConnect = () => {
    Alert.alert(
      'Connect AniList',
      'You\'ll be taken to AniList to authorize Omni-Resume to read your watch list.\n\nOmni-Resume only reads your list — it never posts or modifies anything automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open AniList', onPress: launchOAuthFlow },
      ],
    );
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await runAniListImport();
      setImportResult(result);
      await checkConnection();
      Alert.alert(
        'Import Complete',
        `Applied: ${result.applied}\nSkipped (already ahead): ${result.skipped}\nErrors: ${result.errors}`,
      );
    } catch (e: any) {
      Alert.alert('Import Failed', e.message ?? 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect AniList?',
      'Your local progress is kept. AniList import will no longer be available until you reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await execute(`DELETE FROM user_external_account WHERE provider='ANILIST'`);
            setConnected(false);
            setLastSynced(null);
          },
        },
      ],
    );
  };

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <Panel label="ANILIST IMPORT">
      <Text style={styles.sectionNote}>
        Import your AniList watch list into Omni-Resume. Progress is only pulled in —
        nothing is ever automatically pushed back. §13.1
      </Text>

      {connected ? (
        <>
          <SettingRow
            label="AniList"
            sublabel={lastSynced ? `Last synced: ${formatDate(lastSynced)}` : 'Never synced'}
            rightLabel="CONNECTED"
            color={Colors.mint}
          />
          <View style={styles.buttonRow}>
            <PixelButton
              label={importing ? 'IMPORTING...' : '⬇ IMPORT NOW'}
              onPress={handleImport}
              disabled={importing}
              color={Colors.gold}
              style={{ flex: 1 }}
            />
            <PixelButton
              label="DISCONNECT"
              onPress={handleDisconnect}
              color={Colors.coral}
              style={{ flex: 1 }}
            />
          </View>
          {importResult && (
            <Text style={styles.importResult}>
              Last import: {importResult.applied} applied · {importResult.skipped} skipped
              {importResult.errors > 0 ? ` · ${importResult.errors} errors` : ''}
            </Text>
          )}
        </>
      ) : (
        <>
          <SettingRow label="AniList" sublabel="Not connected" rightLabel="—" />
          <PixelButton label="🔗 CONNECT ANILIST" onPress={handleConnect} color={Colors.gold} />
        </>
      )}
    </Panel>
  );
}

// ─── REGION PICKER ───────────────────────────────────────────────────────────

interface RegionPickerProps {
  current: string;
  onChange: (code: string) => void;
}

function RegionPicker({ current, onChange }: RegionPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const currentLabel = REGIONS.find(r => r.code === current)?.label ?? current;

  return (
    <View>
      <SettingRow
        label="Region"
        sublabel={currentLabel}
        onPress={() => setExpanded(e => !e)}
        rightLabel={expanded ? '▲' : '▼'}
      />
      {expanded && (
        <View style={styles.regionList}>
          {REGIONS.map(r => (
            <TouchableOpacity
              key={r.code}
              style={styles.regionRow}
              onPress={() => { onChange(r.code); setExpanded(false); }}
            >
              <Text style={[
                styles.regionLabel,
                current === r.code && { color: Colors.gold },
              ]}>
                {current === r.code ? '▶ ' : '   '}{r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [platforms, setPlatforms] = useState<PlatformType[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [region, setRegion] = useState('US');
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [dozeEnabled, setDozeEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [plats, subs] = await Promise.all([
      getAllPlatforms(),
      getUserSubscriptions(false),
    ]);
    // Exclude first-party companion from platform list
    setPlatforms(plats.filter(p => p.platform_id !== 'omni_companion'));
    setSubscriptions(subs);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const subscribedIds = new Set(subscriptions.filter(s => s.is_active).map(s => s.platform_id));

  const handlePlatformToggle = async (platformId: string, nowSubscribed: boolean) => {
    // Optimistic update — move the toggle immediately before the async DB write
    const newSubs = nowSubscribed
      ? [...subscriptions.filter(s => s.platform_id !== platformId), {
          user_subscription_id: platformId,
          platform_id: platformId,
          region,
          source: 'DECLARED' as const,
          is_active: true,
        }]
      : subscriptions.map(s => s.platform_id === platformId ? { ...s, is_active: false } : s);
    setSubscriptions(newSubs);
    try {
      if (nowSubscribed) {
        await upsertSubscription({ platform_id: platformId, region, source: 'DECLARED', is_active: true });
      } else {
        await deactivateSubscription(platformId, region);
      }
    } catch (e) {
      // Revert on error
      await load();
    }
  };

  const handleRegionChange = async (code: string) => {
    setRegion(code);
    // Re-upsert all active subscriptions under the new region
    // (existing rows for old region stay; new region rows are created)
    for (const sub of subscriptions.filter(s => s.is_active)) {
      await upsertSubscription({
        platform_id: sub.platform_id,
        region: code,
        source: 'DECLARED',
        is_active: true,
      });
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>

      {/* Platforms */}
      <Panel label="MY STREAMING SERVICES">
        <Text style={styles.sectionNote}>
          Tell Omni-Resume which services you have. This is self-declared only —
          the app never accesses your accounts or reads subscription state. §0
        </Text>
        {platforms.map(p => (
          <PlatformCard
            key={p.platform_id}
            platform={p}
            subscribed={subscribedIds.has(p.platform_id)}
            region={region}
            onToggle={handlePlatformToggle}
          />
        ))}
      </Panel>

      {/* Region */}
      <Panel label="REGION">
        <Text style={styles.sectionNote}>
          Sets which platform availability data is used for the Switch-Sleuth engine.
        </Text>
        <RegionPicker current={region} onChange={handleRegionChange} />
      </Panel>

      {/* AniList import */}
      <AniListSection region={region} />

      {/* Notifications */}
      <Panel label="NOTIFICATIONS">
        <SettingRow
          label="All notifications"
          sublabel="New episodes, migration alerts, reminders"
          value={notifEnabled}
          onToggle={setNotifEnabled}
        />
        <SettingRow
          label="Sleep check-in"
          sublabel="'Still watching?' when an episode should be done"
          value={dozeEnabled}
          onToggle={v => { setDozeEnabled(v); }}
        />
      </Panel>

      {/* Platform Tags */}
      <Panel label="PLATFORM TAGS">
        <Text style={styles.sectionNote}>
          Generate first-party QR codes for your services and scan them
          to quickly log which platform you just watched on. §14
        </Text>
        <PixelButton
          label="📷 MANAGE PLATFORM TAGS"
          onPress={() => navigation.navigate('PlatformTags')}
          color={Colors.blue}
          textColor={Colors.void}
        />
      </Panel>

      {/* About */}
      <Panel label="ABOUT">
        <SettingRow label="Version" rightLabel="1.0.0" />
        <SettingRow
          label="Compliance & Privacy"
          sublabel="What Omni-Resume does and does not do"
          onPress={() =>
            Alert.alert(
              'Compliance',
              '• Progress is self-declared or imported from your own AniList/MAL account.\n' +
              '• No streaming app accounts are accessed, read, or probed.\n' +
              '• No cookies or session tokens from third parties are stored.\n' +
              '• Cover art comes from AniList/MAL APIs under their terms.\n' +
              '• Platform names are used nominatively only.',
            )
          }
        />
        <SettingRow
          label="AniList API"
          sublabel="Open data source for anime metadata"
          onPress={() => Linking.openURL('https://anilist.co')}
        />
      </Panel>

    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  loading: { flex: 1, backgroundColor: Colors.void, alignItems: 'center', justifyContent: 'center' },
  sectionNote: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm,
    color: Colors.dim, lineHeight: 22, marginBottom: Spacing.sm,
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  importResult: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm,
    color: Colors.mint, marginTop: Spacing.xs,
  },
  regionList: {
    backgroundColor: Colors.panelDeep,
    borderWidth: 1, borderColor: Colors.borderMid,
    marginTop: 2,
  },
  regionRow: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  regionLabel: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim },
});
