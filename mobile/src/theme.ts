// Mobile theme — mirrors the web's "Mono Circuit v1.0" design system
// (frontend/src/index.css): warm paper neutrals, ink text, one Signal Volt
// accent. Same token semantics so both surfaces stay in lockstep.
export type Theme = {
  background: string;
  backgroundTo: string;
  backgroundMid: string;
  surface: string;
  surfaceStrong: string;
  stroke: string;
  ink900: string;
  ink800: string;
  ink700: string;
  ink600: string;
  ink500: string;
  accent700: string;
  accent600: string;
  accent500: string;
  accent100: string;
  warning600: string;
  danger600: string;
  ok600: string;
  tabBar: string;
  tabBarBorder: string;
  btnInk: string;
};

export const palette: Record<'light' | 'dark', Theme> = {
  light: {
    background: '#F4F3EE',
    backgroundTo: '#F4F3EE',
    backgroundMid: '#EAE9E2',
    surface: 'rgba(255,255,255,0.95)',
    surfaceStrong: '#FFFFFF',
    stroke: '#D8D6CC',
    ink900: '#101210',
    ink800: '#101210',
    ink700: '#5C6158',
    ink600: '#5C6158',
    ink500: '#8A8F85',
    accent700: '#101210',
    accent600: '#D7F524',
    accent500: '#D7F524',
    accent100: 'rgba(215,245,36,0.16)',
    warning600: '#8A5A00',
    danger600: '#C0362C',
    ok600: '#2F7D4F',
    tabBar: '#FFFFFF',
    tabBarBorder: '#D8D6CC',
    btnInk: '#101210',
  },
  dark: {
    background: '#101210',
    backgroundTo: '#101210',
    backgroundMid: '#1C1F1B',
    surface: 'rgba(28,31,27,0.95)',
    surfaceStrong: '#1C1F1B',
    stroke: '#2A2D27',
    ink900: '#F4F3EE',
    ink800: '#F4F3EE',
    ink700: '#A6AB9F',
    ink600: '#A6AB9F',
    ink500: '#8A8F85',
    accent700: '#101210',
    accent600: '#D7F524',
    accent500: '#D7F524',
    accent100: 'rgba(215,245,36,0.12)',
    warning600: '#E0A93E',
    danger600: '#E8837A',
    ok600: '#7BC496',
    tabBar: '#1C1F1B',
    tabBarBorder: '#2A2D27',
    btnInk: '#101210',
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const roleLabel: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  faculty: 'Faculty',
};
