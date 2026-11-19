// Role-aware tab shell with a lightweight pure-JS navigator (no native
// navigation modules — keeps the build lean on Windows/iOS). Everyone gets
// Timetables + Profile; faculty additionally get My Classes (own schedule +
// their request list in one stack); admins get Approvals.
import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from './context/SessionContext';
import { useTheme } from './context/ThemeContext';
import { BrowseScreen } from './screens/BrowseScreen';
import { MyTimetableScreen } from './screens/MyTimetableScreen';
import { MyRequestsScreen } from './screens/MyRequestsScreen';
import { AdminRequestsScreen } from './screens/AdminRequestsScreen';
import { ProfileScreen } from './screens/ProfileScreen';

type TabKey = 'timetables' | 'my' | 'approvals' | 'profile';

// Monoline icon set (brand rule: no emoji as icons).
const TABS: { key: TabKey; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: 'timetables', icon: 'calendar-outline', label: 'Timetables' },
  { key: 'my', icon: 'school-outline', label: 'My Classes' },
  { key: 'approvals', icon: 'checkmark-done-outline', label: 'Approvals' },
  { key: 'profile', icon: 'person-circle-outline', label: 'Profile' },
];

const FacultyTab = () => {
  const [view, setView] = useState<'timetable' | 'requests'>('timetable');
  if (view === 'requests') {
    return <MyRequestsScreen onBack={() => setView('timetable')} />;
  }
  return <MyTimetableScreen onOpenRequests={() => setView('requests')} />;
};

export const AppNavigator = () => {
  const { me } = useSession();
  const { theme } = useTheme();
  const isFaculty = !!me?.faculty;
  const isAdmin = me?.role === 'admin';

  const tabs = TABS.filter((t) => {
    if (t.key === 'my') return isFaculty;
    if (t.key === 'approvals') return isAdmin;
    return true;
  });

  const [tab, setTab] = useState<TabKey | null>(null);
  // Reactive default: /me arrives after mount, so faculty land on My Classes
  // once their role resolves (an explicit selection always wins).
  const activeTab =
    tab && tabs.some((t) => t.key === tab) ? tab : isFaculty ? 'my' : 'timetables';

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {activeTab === 'timetables' && <BrowseScreen />}
        {activeTab === 'my' && <FacultyTab />}
        {activeTab === 'approvals' && <AdminRequestsScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
      </View>

      <SafeAreaView style={[styles.tabBar, { backgroundColor: theme.tabBar, borderTopColor: theme.tabBarBorder }]}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tabItem}>
              <Ionicons name={t.icon} size={19} color={active ? theme.accent600 : theme.ink500} />
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? theme.accent600 : theme.ink500, fontWeight: active ? '700' : '500' },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2, paddingBottom: 4 },
  tabLabel: { fontSize: 11 },
});
