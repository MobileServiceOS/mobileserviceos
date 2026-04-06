// src/utils/index.js

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function cur(n) {
  const num = parseFloat(n) || 0;
  return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function getWeekStart(dateStr, weekStartDay = 5) {
  const d   = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function getWeekEnd(weekStartStr) {
  const d = new Date(weekStartStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function getCurrentWeekKey(weekStartDay = 5) {
  return getWeekStart(today(), weekStartDay);
}

export function getPrevWeekKey(weekStartDay = 5) {
  const ws = getCurrentWeekKey(weekStartDay);
  return getWeekStart(addDays(ws, -1), weekStartDay);
}

export function isCurrentWeek(weekKey, weekStartDay = 5) {
  return weekKey === getCurrentWeekKey(weekStartDay);
}

export function formatWeekLabel(weekKey) {
  const start = formatDate(weekKey);
  const end   = formatDate(addDays(weekKey, 6));
  return `${start} – ${end}`;
}
