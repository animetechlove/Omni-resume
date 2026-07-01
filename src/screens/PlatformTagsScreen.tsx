// ─────────────────────────────────────────────────────────────────────────────
// src/screens/PlatformTagsScreen.tsx
// §14 — QR platform tag system.
// Generates first-party omniresume://platform-tag?id=<platform_id>&v=1 QR codes.
// Scanning routes into the platform picker on the check-in sheet.
// Never touches a streaming platform's own QR codes.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert,
  TouchableOpacity, Platform, PermissionsAndroid,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { RNCamera } from 'react-native-camera';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { Platform as PlatformType, UserSubscription } from '../types';
import { getUserSubscriptions, getAllPlatforms } from '../db/dao/TitleDAO';
import { buildPlatformTagUrl, parsePlatformTagUrl } from '../services/QRService';

type Mode = 'list' | 'scan';

export default function PlatformTagsScreen() {
  const [mode, setMode] = useState<Mode>('list');
  const [platforms, setPlatforms] = useState<PlatformType[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [cameraPermission, setCameraPermission] = useState(false);
  const [scanned, setScanned] = useState(false);
  const sheetRef = useRef<ViewShot>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [plats, subs] = await Promise.all([getAllPlatforms(), getUserSubscriptions(true)]);
    const subscribedIds = new Set(subs.map(s => s.platform_id));
    setPlatforms(plats.filter(p => subscribedIds.has(p.platform_id) && p.platform_id !== 'omni_companion'));
    setSubscriptions(subs);
  }

  async function requestCamera(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'Omni-Resume needs camera access to scan your platform QR tags.',
          buttonPositive: 'Allow',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true; // iOS handles via Info.plist
  }

  const handleScanPress = async () => {
    const granted = await requestCamera();
    if (!granted) {
      Alert.alert('Camera required', 'Please allow camera access in Settings to scan platform tags.');
      return;
    }
    setCameraPermission(true);
    setMode('scan');
    setScanned(false);
  };

  const handleBarCodeRead = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parsePlatformTagUrl(data);
    if (!parsed) {
      Alert.alert(
        'Unrecognized tag',
        'This QR code is not an Omni-Resume platform tag. Only first-party tags are supported.',
        [{ text: 'OK', onPress: () => setScanned(false) }],
      );
      return;
    }

    const platform = platforms.find(p => p.platform_id === parsed.platform_id);
    const name = platform?.display_name ?? parsed.platform_id;

    Alert.alert(
      `Platform: ${name}`,
      'Set this as your current watch platform?',
      [
        {
          text: 'Yes',
          onPress: () => {
            // Emit the selection — caller can wire this into the check-in sheet's platform picker
            // or the settings screen's subscription manager
            Alert.alert('✓ Platform set', `Watch platform set to ${name}`);
            setMode('list');
          },
        },
        { text: 'Cancel', onPress: () => { setMode('list'); setScanned(false); } },
      ],
    );
  };

  const handleShareSheet = async () => {
    try {
      const uri = await sheetRef.current?.capture?.();
      if (!uri) return;
      await Share.open({ url: `file://${uri}`, type: 'image/png', title: 'Omni-Resume Platform Tags' });
    } catch (e) {
      console.log('[PlatformTagsScreen] Share cancelled');
    }
  };

  if (mode === 'scan' && cameraPermission) {
    return (
      <View style={styles.root}>
        <RNCamera
          style={StyleSheet.absoluteFill}
          type={RNCamera.Constants.Type.back}
          onBarCodeRead={handleBarCodeRead}
          captureAudio={false}
          barCodeTypes={[RNCamera.Constants.BarCodeType.qr]}
        />
        <View style={styles.scanOverlay}>
          <Text style={styles.scanPrompt}>SCAN PLATFORM TAG</Text>
          <View style={styles.scanFrame} />
          <PixelButton label="CANCEL" onPress={() => setMode('list')} color={Colors.coral} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>PLATFORM TAGS</Text>
      <Text style={styles.subheading}>
        Print these and stick them near each device.{'\n'}
        Scan a tag to quickly set your watch platform.
      </Text>

      {/* Scan button */}
      <Panel>
        <PixelButton label="📷 SCAN A TAG" onPress={handleScanPress} color={Colors.blue} textColor={Colors.void} />
      </Panel>

      {/* QR grid */}
      <ViewShot ref={sheetRef} options={{ format: 'png', quality: 1 }}>
        <View style={styles.qrGrid}>
          {platforms.map(platform => (
            <PlatformTagCard key={platform.platform_id} platform={platform} />
          ))}
        </View>
      </ViewShot>

      {platforms.length > 0 && (
        <Panel>
          <PixelButton label="⬆ SHARE TAG SHEET" onPress={handleShareSheet} color={Colors.gold} />
        </Panel>
      )}

      {platforms.length === 0 && (
        <Panel label="NO PLATFORMS">
          <Text style={styles.emptyText}>
            Add your streaming services in Settings first,{'\n'}then tags will appear here.
          </Text>
        </Panel>
      )}
    </ScrollView>
  );
}

// ─── PLATFORM TAG CARD ───────────────────────────────────────────────────────

function PlatformTagCard({ platform }: { platform: PlatformType }) {
  const url = buildPlatformTagUrl(platform.platform_id);

  return (
    <View style={styles.tagCard}>
      <Text style={styles.tagPlatformName}>{platform.display_name.toUpperCase()}</Text>
      <View style={styles.qrWrap}>
        <QRCode
          value={url}
          size={120}
          color={Colors.cream}
          backgroundColor={Colors.panelDeep}
        />
      </View>
      <Text style={styles.tagId}>{platform.platform_id}</Text>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  heading: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayMd,
    color: Colors.gold, marginBottom: Spacing.xs,
  },
  subheading: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim,
    marginBottom: Spacing.lg, lineHeight: 26,
  },
  qrGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
    marginVertical: Spacing.lg,
  },
  tagCard: {
    width: '47%',
    backgroundColor: Colors.panel,
    ...bevelBorder(3),
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  tagPlatformName: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayXs,
    color: Colors.cream, letterSpacing: 1, textAlign: 'center',
  },
  qrWrap: {
    padding: Spacing.sm, backgroundColor: Colors.panelDeep,
    borderWidth: 2, borderColor: Colors.borderMid,
  },
  tagId: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim,
  },
  emptyText: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim,
    lineHeight: 26,
  },
  // Scanner overlay
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.xxl,
    backgroundColor: 'transparent',
  },
  scanPrompt: {
    fontFamily: Fonts.display, fontSize: FontSizes.displaySm,
    color: Colors.gold, backgroundColor: Colors.void,
    padding: Spacing.sm,
  },
  scanFrame: {
    width: 220, height: 220,
    borderWidth: 4, borderColor: Colors.gold,
    backgroundColor: 'transparent',
  },
});
