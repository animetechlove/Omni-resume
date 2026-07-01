// ─────────────────────────────────────────────────────────────────────────────
// src/services/NotificationService.ts
// Implements §12 — two delivery paths:
//  §12.1 Local on-device scheduling (dozed-off detection §7.1e)
//  §12.2 Server push handler (episode drops, migration alerts)
//
// Firebase is OPTIONAL — the app runs fully without it.
// Local notifications (sleep detection, left-behind alerts) work without Firebase.
// Only server-push episode-drop and migration alerts need Firebase.
// ─────────────────────────────────────────────────────────────────────────────

import notifee, {
  AndroidImportance,
  AndroidStyle,
  EventType,
  TriggerType,
} from '@notifee/react-native';
import type { CheckInContext } from '../types';

const CHANNEL_RESUME = 'omni_resume';
const CHANNEL_ALERTS = 'omni_alerts';
const CHANNEL_DOZE   = 'omni_doze';

// ─── FIREBASE OPTIONAL LOADER ─────────────────────────────────────────────────
// Wrapped in try/catch so the app works without google-services.json.
// Firebase is only needed for server-push episode-drop and migration alerts.

let _fcmToken: string | null = null;
let _firebaseAvailable = false;

async function tryInitFirebase(): Promise<void> {
  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;
    _fcmToken = await messaging().getToken();
    _firebaseAvailable = true;
    console.log('[NotificationService] Firebase ready. FCM token:', _fcmToken);

    messaging().setBackgroundMessageHandler(async remoteMessage => {
      await handleServerPush(remoteMessage.data ?? {});
    });
  } catch (e) {
    console.log('[NotificationService] Firebase not configured — server-push notifications disabled. Local notifications still work.');
    _firebaseAvailable = false;
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_RESUME,
    name: 'Continue Watching',
    importance: AndroidImportance.HIGH,
  });
  await notifee.createChannel({
    id: CHANNEL_ALERTS,
    name: 'Alerts',
    importance: AndroidImportance.DEFAULT,
  });
  await notifee.createChannel({
    id: CHANNEL_DOZE,
    name: 'Sleep Check-in',
    importance: AndroidImportance.HIGH,
  });

  // Try Firebase — safe to fail
  await tryInitFirebase();

  // Handle notification tap events
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      handleNotificationTap(detail.notification?.data ?? {});
    }
  });

  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === EventType.PRESS) {
      handleNotificationTap(detail.notification?.data ?? {});
    }
    if (type === EventType.ACTION_PRESS) {
      await handleActionPress(
        detail.notification?.data ?? {},
        detail.pressAction?.id ?? '',
      );
    }
  });
}

// ─── §12.1 LOCAL SCHEDULING ───────────────────────────────────────────────────

export async function scheduleDozedOff(
  sessionId: string,
  titleId: string,
  episodeTitle: string,
  runtimeMs: number,
  episodeLabel: string,
): Promise<string> {
  const GRACE_MS = 6 * 60 * 1000;
  const triggerTimestamp = Date.now() + runtimeMs + GRACE_MS;

  const notificationId = await notifee.createTriggerNotification(
    {
      id: `doze_${sessionId}`,
      title: '🌙 Still watching?',
      body: `You stopped mid-episode — ${episodeLabel}. Still up?`,
      android: {
        channelId: CHANNEL_DOZE,
        importance: AndroidImportance.HIGH,
        style: {
          type: AndroidStyle.BIGTEXT,
          text: `You stopped mid-episode — ${episodeLabel}. Still up?`,
        },
        actions: [
          {
            title: '▶ Continue',
            pressAction: { id: 'continue', launchActivity: 'default' },
          },
          {
            title: '🌙 Stop for tonight',
            pressAction: { id: 'stop' },
          },
        ],
      },
      data: {
        type: 'DOZED_OFF',
        session_id: sessionId,
        title_id: titleId,
        episode_label: episodeLabel,
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerTimestamp,
      alarmManager: { allowWhileIdle: true },
    },
  );

  return notificationId;
}

export async function cancelScheduled(notificationRef: string): Promise<void> {
  try {
    await notifee.cancelNotification(notificationRef);
  } catch (e) {
    console.log('[NotificationService] Cancel no-op for', notificationRef);
  }
}

// ─── §12.2 SERVER PUSH HANDLER ────────────────────────────────────────────────

interface PushPayload {
  type?: string;
  title_id?: string;
  episode_label?: string;
  platform_id?: string;
  deep_link?: string;
  [key: string]: string | undefined;
}

async function handleServerPush(data: PushPayload): Promise<void> {
  if (data.type === 'EPISODE_DROP') {
    await notifee.displayNotification({
      title: '🆕 New episode available',
      body: `${data.episode_label} is ready to watch`,
      android: {
        channelId: CHANNEL_ALERTS,
        actions: [
          {
            title: '▶ Watch Now',
            pressAction: { id: 'watch_now', launchActivity: 'default' },
          },
        ],
      },
      data: {
        type: 'EPISODE_DROP',
        title_id: data.title_id ?? '',
        deep_link: data.deep_link ?? '',
      },
    });
  } else if (data.type === 'MIGRATION') {
    await notifee.displayNotification({
      title: '⇄ Stream moved',
      body: `Now available on ${data.platform_id}`,
      android: { channelId: CHANNEL_ALERTS },
      data: {
        type: 'MIGRATION',
        title_id: data.title_id ?? '',
        deep_link: data.deep_link ?? '',
      },
    });
  }
}

// ─── NOTIFICATION TAP ROUTING ─────────────────────────────────────────────────

let _navigationRef: {
  navigate: (screen: string, params?: object) => void;
} | null = null;

export function setNavigationRef(ref: {
  navigate: (screen: string, params?: object) => void;
}): void {
  _navigationRef = ref;
}

function handleNotificationTap(data: Record<string, string>): void {
  if (!_navigationRef) return;

  if (data.type === 'DOZED_OFF') {
    // §12.3: dozed-off tap opens the in-app check-in sheet, NOT the external player
    _navigationRef.navigate('Home', {
      open_checkin: true,
      session_id: data.session_id,
      title_id: data.title_id,
    } as any);
    return;
  }

  if (data.type === 'EPISODE_DROP' || data.type === 'MIGRATION') {
    if (data.deep_link) {
      require('react-native').Linking.openURL(data.deep_link);
    } else {
      _navigationRef.navigate('Tracker', { title_id: data.title_id });
    }
  }
}

async function handleActionPress(
  data: Record<string, string>,
  actionId: string,
): Promise<void> {
  const { closeModeSession } = await import('../db/dao/ProgressDAO');

  if (data.type === 'DOZED_OFF') {
    if (actionId === 'stop') {
      if (data.session_id) {
        await closeModeSession(data.session_id, 'BACKGROUNDED');
      }
    } else if (actionId === 'continue') {
      handleNotificationTap(data);
    }
  }
}

// ─── LEFT BEHIND REMINDER ─────────────────────────────────────────────────────

export async function sendLeftBehindReminder(params: {
  titleId: string;
  episodeLabel: string;
  timestampLabel: string;
  daysSince: number;
}): Promise<void> {
  await notifee.displayNotification({
    title: '⏸ Unfinished episode',
    body: `You left ${params.episodeLabel} paused ${
      params.daysSince > 1 ? `${params.daysSince} days ago` : 'earlier'
    }. Pick up near ${params.timestampLabel}?`,
    android: {
      channelId: CHANNEL_RESUME,
      actions: [
        {
          title: '▶ Resume',
          pressAction: { id: 'watch_now', launchActivity: 'default' },
        },
      ],
    },
    data: { type: 'LEFT_BEHIND', title_id: params.titleId },
  });
}

export const NotificationService = {
  init,
  scheduleDozedOff,
  cancelScheduled,
  sendLeftBehindReminder,
  setNavigationRef,
};
