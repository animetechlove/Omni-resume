import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function init(): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as Record<string, string>;
    handleNotificationTap(data, response.actionIdentifier);
  });
}

export async function scheduleDozedOff(
  sessionId: string,
  titleId: string,
  episodeTitle: string,
  runtimeMs: number,
  episodeLabel: string,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Still watching?',
      body: 'You stopped mid-episode — ' + episodeLabel + '. Still up?',
      data: { type: 'DOZED_OFF', session_id: sessionId, title_id: titleId, episode_label: episodeLabel },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.floor((runtimeMs + 360000) / 1000),
    },
  });
}

export async function cancelScheduled(ref: string): Promise<void> {
  try { await Notifications.cancelScheduledNotificationAsync(ref); } catch {}
}

export async function sendLeftBehindReminder(params: {
  titleId: string; episodeLabel: string; timestampLabel: string; daysSince: number;
}): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Unfinished episode',
      body: 'You left ' + params.episodeLabel + ' paused. Pick up near ' + params.timestampLabel + '?',
      data: { type: 'LEFT_BEHIND', title_id: params.titleId },
    },
    trigger: null,
  });
}

let _nav: { navigate: (s: string, p?: object) => void } | null = null;
export function setNavigationRef(ref: { navigate: (s: string, p?: object) => void }): void { _nav = ref; }

async function handleNotificationTap(data: Record<string, string>, actionId: string): Promise<void> {
  if (data.type === 'DOZED_OFF') {
    if (actionId === 'stop') {
      const { closeModeSession } = await import('../db/dao/ProgressDAO');
      if (data.session_id) await closeModeSession(data.session_id, 'BACKGROUNDED');
    } else {
      _nav?.navigate('Home', { open_checkin: true, session_id: data.session_id, title_id: data.title_id } as any);
    }
    return;
  }
  if (data.type === 'EPISODE_DROP' || data.type === 'MIGRATION') {
    if (data.deep_link) require('react-native').Linking.openURL(data.deep_link);
    else _nav?.navigate('Tracker', { title_id: data.title_id });
  }
}

export const NotificationService = { init, scheduleDozedOff, cancelScheduled, sendLeftBehindReminder, setNavigationRef };
