// ─────────────────────────────────────────────────────────────────────────────
// src/components/PixelUI.tsx
// Core reusable pixel/JRPG components.
// All design decisions derived from src/theme/pixelTheme.ts.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Animated, AccessibilityInfo,
} from 'react-native';
import {
  Colors, Fonts, FontSizes, Spacing, bevelBorder,
  panelLabelStyle, StatusColors, PlayStatusColors,
} from '../theme/pixelTheme';
import type { ProgressPayload, WatchStatus, PlayStatus, ActiveMode } from '../types';

// ─── PANEL ───────────────────────────────────────────────────────────────────

interface PanelProps {
  label?: string;
  children: React.ReactNode;
  style?: object;
}

export function Panel({ label, children, style }: PanelProps) {
  return (
    <View style={[styles.panel, style]}>
      {label && (
        <View style={styles.panelLabelWrap}>
          <Text style={styles.panelLabel}>{label}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

// ─── PIXEL BUTTON ─────────────────────────────────────────────────────────────

interface PixelButtonProps {
  label: string;
  onPress: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: object;
}

export function PixelButton({
  label, onPress, color = Colors.gold,
  textColor = Colors.void, disabled = false,
  accessibilityLabel, style,
}: PixelButtonProps) {
  const [pressed, setPressState] = useState(false);

  return (
    <TouchableOpacity
      onPressIn={() => setPressState(true)}
      onPressOut={() => setPressState(false)}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.pixelBtn,
        { backgroundColor: disabled ? Colors.dim : color },
        pressed && styles.pixelBtnPressed,
        style,
      ]}
    >
      <Text style={[styles.pixelBtnText, { color: disabled ? Colors.borderLo : textColor }]}>
        {'▶ '}{label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── STATUS PILL ─────────────────────────────────────────────────────────────

interface StatusPillProps {
  status: WatchStatus;
  timestampLabel?: string;  // e.g. "~14:22"
}

export function WatchStatusPill({ status, timestampLabel }: StatusPillProps) {
  const cfg = StatusColors[status] ?? StatusColors.DISCOVERED;
  const label = timestampLabel ? `${cfg.label} · ${timestampLabel}` : cfg.label;
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.pillText, { color: cfg.text }]}>{label}</Text>
    </View>
  );
}

interface PlayStatusPillProps { status: PlayStatus; }
export function PlayStatusPill({ status }: PlayStatusPillProps) {
  const cfg = PlayStatusColors[status] ?? PlayStatusColors.NONE;
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.pillText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── COMMAND MENU (Watch / Play toggle) ──────────────────────────────────────

interface CommandMenuProps {
  activeMode: ActiveMode;
  onSelect: (mode: ActiveMode) => void;
  playAvailable?: boolean;
}

export function CommandMenu({ activeMode, onSelect, playAvailable = false }: CommandMenuProps) {
  return (
    <View style={styles.commandGrid}>
      <CommandOption
        label="WATCH"
        active={activeMode === 'WATCH'}
        onPress={() => onSelect('WATCH')}
      />
      <CommandOption
        label="PLAY"
        active={activeMode === 'PLAY'}
        onPress={() => playAvailable && onSelect('PLAY')}
        dimmed={!playAvailable}
      />
    </View>
  );
}

interface CommandOptionProps {
  label: string;
  active: boolean;
  onPress: () => void;
  dimmed?: boolean;
}

function CommandOption({ label, active, onPress, dimmed = false }: CommandOptionProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled: dimmed }}
      style={[styles.commandOpt, active && styles.commandOptActive]}
    >
      <Text style={[
        styles.commandCursor,
        { color: Colors.gold, opacity: active ? 1 : 0 },
      ]}>▶ </Text>
      <Text style={[
        styles.commandLabel,
        { color: active ? Colors.cream : dimmed ? Colors.borderMid : Colors.dim },
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── OMNI-RESUME DASHBOARD CARD ───────────────────────────────────────────────

interface OmniResumeCardProps {
  payload: ProgressPayload;
  onInstantContinue: () => void;
  onModeChange: (mode: ActiveMode) => void;
  onMigrationConfirm: () => void;
  region: string;
}

export function OmniResumeCard({
  payload, onInstantContinue, onModeChange, onMigrationConfirm, region,
}: OmniResumeCardProps) {
  const { title, episode, progress, sources, resume_recommendation } = payload;

  const watchSrc = sources.find(s =>
    s.platform.platform_id === progress.last_platform_id && !s.platform.supports_play_mode
  );

  const availablePlatformNames = sources
    .filter(s => s.availability.is_available && s.subscription.is_active && !s.platform.supports_play_mode)
    .map(s => s.platform.display_name);

  const episodeLabel = episode
    ? `S${episode ? '1' : '?'} · EP ${String(episode.absolute_number).padStart(3, '0')}`
    : '';

  const timestampLabel = progress.watch_timestamp_ms > 0
    ? `${progress.provenance === 'MANUAL' ? '~' : ''}${formatMs(progress.watch_timestamp_ms)}`
    : '';

  const isMigrated = progress.watch_status === 'MIGRATED';
  const btnLabel = isMigrated
    ? `✓ SWITCH TO ${resume_recommendation.to_platform_id?.toUpperCase()}`
    : 'INSTANT CONTINUE';

  const playAvailable = sources.some(s => s.platform.supports_play_mode && s.availability.is_available);

  return (
    <Panel label="STATUS WINDOW">
      <View style={styles.statusRow}>
        {/* Cover art */}
        <View style={styles.spriteBox}>
          {title.cover_image_url
            ? <Image source={{ uri: title.cover_image_url }} style={styles.coverArt} resizeMode="cover" />
            : <View style={styles.spritePlaceholder} />
          }
        </View>

        {/* Text block */}
        <View style={styles.statusText}>
          <Text style={styles.showTitle} numberOfLines={2}>
            {title.english_title ?? title.romaji_title}
          </Text>
          {episodeLabel ? <Text style={styles.epLine}>{episodeLabel}</Text> : null}
          <WatchStatusPill
            status={progress.watch_status}
            timestampLabel={timestampLabel || undefined}
          />
        </View>
      </View>

      {/* Primary action button */}
      {progress.watch_status !== 'UNAVAILABLE' && (
        <PixelButton
          label={btnLabel}
          onPress={isMigrated ? onMigrationConfirm : onInstantContinue}
          color={isMigrated ? Colors.blue : Colors.gold}
          style={styles.continueBtn}
        />
      )}

      {/* Migration prompt */}
      {isMigrated && resume_recommendation.prompt && (
        <Text style={styles.migrationHint}>{resume_recommendation.prompt}</Text>
      )}

      {/* Availability row */}
      {availablePlatformNames.length > 0 && (
        <Text style={styles.availRow}>
          ON: <Text style={{ color: Colors.mint }}>
            {availablePlatformNames.slice(0, 3).join(' · ')}
          </Text>
        </Text>
      )}

      {/* Mode toggle */}
      <CommandMenu
        activeMode={progress.active_mode}
        onSelect={onModeChange}
        playAvailable={playAvailable}
      />
    </Panel>
  );
}

// ─── CHECK-IN SHEET ───────────────────────────────────────────────────────────

interface CheckInSheetProps {
  episodeLabel: string;
  estimatedTimestampMs: number;
  onFinished: () => void;
  onStillWatching: (timestampMs: number) => void;
  onNothingChanged: () => void;
}

export function CheckInSheet({
  episodeLabel, estimatedTimestampMs,
  onFinished, onStillWatching, onNothingChanged,
}: CheckInSheetProps) {
  const [manualTimestamp, setManualTs] = useState(estimatedTimestampMs);

  return (
    <Panel label="CHECK IN">
      <Text style={styles.checkInQuestion}>
        Still on {episodeLabel}?
      </Text>
      <PixelButton label="✓ FINISHED IT"           onPress={onFinished}                   color={Colors.mint}  />
      <View style={styles.spacerSm} />
      <PixelButton label="⏱ STILL WATCHING"        onPress={() => onStillWatching(manualTimestamp)} color={Colors.coral} />
      <View style={styles.spacerSm} />
      <PixelButton label="— NOTHING CHANGED"        onPress={onNothingChanged}             color={Colors.dim} textColor={Colors.cream} />
      <Text style={styles.checkInHint}>
        Estimated spot: {formatMs(estimatedTimestampMs)}
      </Text>
    </Panel>
  );
}

// ─── EPISODE QUEST LOG GRID ───────────────────────────────────────────────────

interface EpisodeGridProps {
  episodes: Array<{
    episode_id: string;
    absolute_number: number;
    canonical_kind: string;
    status: 'watched' | 'current' | 'upcoming' | 'ova';
  }>;
  onTileTap: (episodeId: string, absoluteNumber: number) => void;
  onTileLongPress?: (episodeId: string, absoluteNumber: number) => void;
}

export function EpisodeGrid({ episodes, onTileTap, onTileLongPress }: EpisodeGridProps) {
  const STATE_MARKS: Record<string, string> = {
    watched:  '✓',
    current:  '◉',
    upcoming: '▢',
    ova:      '★',
  };
  const STATE_COLORS: Record<string, string> = {
    watched:  Colors.mint,
    current:  Colors.gold,
    upcoming: Colors.borderMid,
    ova:      Colors.violet,
  };

  return (
    <View style={styles.questGrid}>
      {episodes.map(ep => (
        <TouchableOpacity
          key={ep.episode_id}
          style={[
            styles.epTile,
            { borderColor: STATE_COLORS[ep.status] ?? Colors.borderMid },
          ]}
          onPress={() => onTileTap(ep.episode_id, ep.absolute_number)}
          onLongPress={onTileLongPress
            ? () => onTileLongPress(ep.episode_id, ep.absolute_number)
            : undefined}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={`Episode ${ep.absolute_number}, ${ep.status}${onTileLongPress ? ', long press to set platform' : ''}`}
        >
          <Text style={[styles.epMark, { color: STATE_COLORS[ep.status] ?? Colors.borderMid }]}>
            {STATE_MARKS[ep.status] ?? '▢'}
          </Text>
          <Text style={[styles.epNum, { color: STATE_COLORS[ep.status] ?? Colors.borderMid }]}>
            EP{String(ep.absolute_number).padStart(2, '0')}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  return `${m}:${String(s % 60).padStart(2,'0')}`;
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.panel,
    borderWidth: 3,
    borderTopColor: Colors.borderHi,
    borderLeftColor: Colors.borderHi,
    borderBottomColor: Colors.borderMid,
    borderRightColor: Colors.borderMid,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  panelLabelWrap: {
    marginBottom: Spacing.sm,
    alignSelf: 'flex-start',
    marginTop: -Spacing.md - 3,
    marginLeft: -2,
  },
  panelLabel: {
    ...panelLabelStyle,
    fontSize: FontSizes.displayXs,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: Colors.borderLo,
    marginTop: Spacing.xs,
  },
  pillText: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayXs,
    letterSpacing: 1,
  },
  statusRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  spriteBox: {
    width: 64, height: 64,
    backgroundColor: Colors.panelDeep,
    borderWidth: 3,
    borderTopColor: Colors.borderMid,
    borderLeftColor: Colors.borderMid,
    borderBottomColor: Colors.borderLo,
    borderRightColor: Colors.borderLo,
    overflow: 'hidden',
  },
  coverArt: { width: 64, height: 64 },
  spritePlaceholder: { flex: 1, backgroundColor: Colors.borderMid },
  statusText: { flex: 1 },
  showTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySm,
    color: Colors.cream,
    lineHeight: 22,
    marginBottom: Spacing.xs,
  },
  epLine: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim },
  continueBtn: { marginTop: Spacing.md },
  migrationHint: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm,
    color: Colors.blue, marginTop: Spacing.xs,
  },
  availRow: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim,
    borderTopWidth: 2, borderTopColor: Colors.borderMid,
    paddingTop: Spacing.sm, marginTop: Spacing.sm,
  },
  pixelBtn: {
    width: '100%', padding: Spacing.md,
    borderWidth: 3, borderColor: Colors.borderLo,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.borderLo, shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1, shadowRadius: 0, elevation: 4,
  },
  pixelBtnPressed: { transform: [{ translateX: 4 }, { translateY: 4 }], elevation: 0 },
  pixelBtnText: {
    fontFamily: Fonts.display, fontSize: FontSizes.displaySm, letterSpacing: 1,
  },
  commandGrid: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  commandOpt: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.panelDeep,
    borderWidth: 3, borderTopColor: Colors.borderMid, borderLeftColor: Colors.borderMid,
    borderBottomColor: Colors.borderLo, borderRightColor: Colors.borderLo,
    padding: Spacing.sm,
  },
  commandOptActive: {
    borderTopColor: Colors.gold, borderLeftColor: Colors.gold,
  },
  commandCursor: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs },
  commandLabel: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, letterSpacing: 1 },
  checkInQuestion: {
    fontFamily: Fonts.display, fontSize: FontSizes.displaySm,
    color: Colors.cream, marginBottom: Spacing.md, lineHeight: 22,
  },
  checkInHint: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm,
    color: Colors.dim, marginTop: Spacing.sm, textAlign: 'center',
  },
  spacerSm: { height: Spacing.sm },
  questGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs,
  },
  epTile: {
    width: '14%', aspectRatio: 1,
    backgroundColor: Colors.panelDeep,
    borderWidth: 2, borderColor: Colors.borderMid,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  epMark: { fontFamily: Fonts.body, fontSize: 18, lineHeight: 18 },
  epNum:  { fontFamily: Fonts.display, fontSize: 7, lineHeight: 10 },
});
