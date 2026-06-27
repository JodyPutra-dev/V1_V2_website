/**
 * Application Color Palette
 * This file centralizes all color definitions for easy theming and consistency
 * 
 * THEME TOGGLE:
 * The application supports two themes: orange (default) and blue
 * To toggle between themes, modify the 'colorTheme' value in src/config.js
 * Theme changes are applied by the useEffect in App.js that sets CSS variables
 * based on the selected theme object (orangeTheme or blueTheme).
 * 
 * Developer-only feature: This toggle is only accessible via the config file
 * and is not exposed to end users.
 */

// Primary Orange Colors
export const orange = {
  50: '#FFF7ED',
  100: '#FFEDD5',
  200: '#FED7AA',
  300: '#FDBA74',
  400: '#FB923C',
  500: '#F97316', // Primary brand color
  600: '#EA580C',
  700: '#C2410C',
  800: '#9A3412',
  900: '#7C2D12',
  950: '#431407'
};

// Primary Blue Colors
export const blue = {
  50: '#EFF6FF',
  100: '#DBEAFE',
  200: '#BFDBFE',
  300: '#93C5FD',
  400: '#60A5FA',
  500: '#3B82F6', // Primary blue color
  600: '#2563EB',
  700: '#1D4ED8',
  800: '#1E40AF',
  900: '#1E3A8A',
  950: '#172554'
};

// UI Colors
export const ui = {
  background: '#FFFFFF',
  foreground: '#0F172A',
  mutedBackground: '#F1F5F9',
  mutedForeground: '#64748B',
  border: '#E2E8F0',
  input: '#E2E8F0',
  ring: '#F97316' 
};

// UI Blue Theme Colors
export const uiBlue = {
  background: '#FFFFFF',
  foreground: '#0F172A',
  mutedBackground: '#F1F5F9',
  mutedForeground: '#64748B',
  border: '#E2E8F0',
  input: '#E2E8F0',
  ring: '#3B82F6'
};

// Chart Colors
export const charts = {
  orange: '#F97316', // Orange 500
  teal: '#00B8C4',
  purple: '#7C3AED',
  green: '#16A34A',
  amber: '#F59E0B'
};

// Chart Colors - Blue Theme
export const chartsBlue = {
  blue: '#3B82F6', // Blue 500
  teal: '#00B8C4',
  purple: '#7C3AED',
  green: '#16A34A',
  amber: '#F59E0B'
};

// Status Colors
export const status = {
  success: '#22C55E', // Green 500
  warning: '#F59E0B', // Amber 500
  danger: '#F97316', // Orange 500
  info: '#3B82F6'  // Blue 500
};

// Status Colors - Blue Theme
export const statusBlue = {
  success: '#22C55E', // Green 500
  warning: '#F59E0B', // Amber 500
  danger: '#EF4444', // Red 500
  info: '#3B82F6'  // Blue 500
};

// Gray Scale
export const gray = {
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A'
};

// Export default themes
export const orangeTheme = {
  orange,
  ui, 
  charts,
  status,
  gray,
  primary: orange[500]
};

export const blueTheme = {
  blue,
  ui: uiBlue,
  charts: chartsBlue,
  status: statusBlue,
  gray,
  primary: blue[500]
};

// Export a default object with all colors
const colorPalette = {
  orange,
  blue,
  ui, 
  uiBlue,
  charts,
  chartsBlue,
  status,
  statusBlue,
  gray,
  primary: orange[500],
  orangeTheme,
  blueTheme
};

export default colorPalette; 