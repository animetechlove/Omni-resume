import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { Platform as PlatformType } from '../types';
import { getUserSubscriptions, getAllPlatforms } from '../db/dao/TitleDAO';
import { buildPlatformTagUrl, parsePlatformTagUrl } from '../services/QRService';

type Mode = 'list' | 'scan';

export default function PlatformTagsScreen() {
  const [mode, setMode] = useState<Mode>('list');
  const [platforms, setPlatforms] = useState<PlatformType[]>([]);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [plats, subs] = await Promise.all([getAllPlatforms(), getUserSubscriptions(true)]);
    const ids = new Set(subs.map(s => s.platform_id));
    setPlatforms(plats.filter(p => ids.has(p.platform_id) && p.platform_id !== 'omni_companion'));
  }

  const handleScanPress = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera required', 'Please allow camera access.');
        return;
      }
    }
    setMode('scan');
    setScanned(false);
  };

  const handleScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const parsed = parsePlatformTagUrl(data);
    if (!parsed) {
      Alert.alert('Not a platform tag', 'Scan an Omni-Resume tag.',
        [{ text: 'OK', onPress: () => setScanned(false) }]);
      return;
    }
    const name = platforms.find(p => p.platform_id === parsed.platform_id)?.display_name ?? parsed.platform_id;
    Alert.alert('Platform: ' + name, 'Set as watch platform?', [
      { text: 'Yes', onPress: () => { Alert.alert('Set', name + ' selected'); setMode('list'); } },
      { text: 'No', onPress: () => { setMode('list'); setScanned(false); } },
    ]);
  };

  if (mode === 'scan') {
    return (
      <View style={s.root}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={scanned ? undefined : handleScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={s.overlay}>
          <Text style={s.prompt}>SCAN PLATFORM TAG</Text>
          <View style={s.frame} />
          <PixelButton label="CANCEL" onPress={() => setMode('list')} color={Colors.coral} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      <Text style={s.heading}>PLATFORM TAGS</Text>
      <Text style={s.sub}>Print these and stick them near each device.</Text>
      <Panel>
        <PixelButton label="SCAN A TAG" onPress={handleScanPress} color={Colors.blue} textColor={Colors.void} />
      </Panel>
      <View style={s.grid}>
        {platforms.map(p => (
          <View key={p.platform_id} style={s.card}>
            <Text style={s.cardName}>{p.display_name.toUpperCase()}</Text>
            <View style={s.qrWrap}>
              <QRCode value={buildPlatformTagUrl(p.platform_id)} size={120} color={Colors.cream} backgroundColor={Colors.panelDeep} />
            </View>
            <Text style={s.cardId}>{p.platform_id}</Text>
          </View>
        ))}
      </View>
      {platforms.length === 0 && (
        <Panel label="NO PLATFORMS">
          <Text style={s.empty}>Add streaming services in Settings first.</Text>
        </Panel>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: 64 },
  heading: { fontFamily: Fonts.display, fontSize: FontSizes.displayMd, color: Colors.gold, marginBottom: 4 },
  sub: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim, marginBottom: Spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginVertical: Spacing.lg },
  card: { width: '47%', backgroundColor: Colors.panel, ...bevelBorder(3), padding: Spacing.md, alignItems: 'center', gap: Spacing.sm },
  cardName: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.cream, textAlign: 'center' },
  qrWrap: { padding: Spacing.sm, backgroundColor: Colors.panelDeep, borderWidth: 2, borderColor: Colors.borderMid },
  cardId: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  empty: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'space-between', padding: 32 },
  prompt: { fontFamily: Fonts.display, fontSize: FontSizes.displaySm, color: Colors.gold, backgroundColor: Colors.void, padding: Spacing.sm },
  frame: { width: 220, height: 220, borderWidth: 4, borderColor: Colors.gold },
});