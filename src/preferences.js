import { createReporter } from './notifications.js';
const key = 'refaceCS.preferences.v1';
const status = createReporter('app', 'preferences-status');
let preferences = {};

try {
  const saved = localStorage.getItem(key);
  if (saved !== null) {
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid preferences');
    }
    preferences = parsed;
  }
} catch (error) {
  status(`Could not restore browser preferences: ${error.message || error}. Defaults are in use.`, 'error');
}

export function getPreference(name, valid, fallback) {
  return valid(preferences[name]) ? preferences[name] : fallback;
}

export function setPreference(name, value, { requirePersistence = false } = {}) {
  if (requirePersistence) {
    localStorage.setItem(key, JSON.stringify({ ...preferences, [name]: value }));
    preferences[name] = value;
    return;
  }
  preferences[name] = value;
  savePreferences();
}

export function setPreferences(values) {
  Object.assign(preferences, values);
  savePreferences();
}

function savePreferences() {
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch (error) {
    status(`Could not save browser preferences: ${error.message || error}. Changes may be lost on reload.`, 'error');
  }
}
