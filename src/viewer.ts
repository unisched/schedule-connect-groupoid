/*
 * Copyright © 2023-2026, Yurii Kadirov. All rights reserved.
 * See [LICENSE.md] in the project root for more details.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ScheduleDay, ScheduleLesson, ScheduleDayOfWeek } from './types.js';

// ─── ANSI colors ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES_UA: Record<ScheduleDayOfWeek, string> = {
  [ScheduleDayOfWeek.Monday]: 'ПОНЕДІЛОК',
  [ScheduleDayOfWeek.Tuesday]: 'ВІВТОРОК',
  [ScheduleDayOfWeek.Wednesday]: 'СЕРЕДА',
  [ScheduleDayOfWeek.Thursday]: 'ЧЕТВЕР',
  [ScheduleDayOfWeek.Friday]: "П'ЯТНИЦЯ",
  [ScheduleDayOfWeek.Saturday]: 'СУБОТА',
  [ScheduleDayOfWeek.Sunday]: 'НЕДІЛЯ',
};

const DAY_ORDER: ScheduleDayOfWeek[] = [
  ScheduleDayOfWeek.Monday,
  ScheduleDayOfWeek.Tuesday,
  ScheduleDayOfWeek.Wednesday,
  ScheduleDayOfWeek.Thursday,
  ScheduleDayOfWeek.Friday,
  ScheduleDayOfWeek.Saturday,
  ScheduleDayOfWeek.Sunday,
];

const TYPE_COLORS: Record<string, string> = {
  'лекція': c.brightGreen,
  'лабораторна': c.brightBlue,
  'практичне': c.brightYellow,
};

const TYPE_SHORT: Record<string, string> = {
  'лекція': 'лек',
  'лабораторна': 'лаб',
  'практичне': 'пр',
};

// ─── Schedule loading ─────────────────────────────────────────────────────────

export function listEntities(outputDir: string, type: 'groups' | 'teachers' | 'classrooms'): string[] {
  const dir = join(outputDir, type);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

export function loadSchedule(outputDir: string, type: 'groups' | 'teachers' | 'classrooms', name: string): ScheduleDay[] | null {
  const dir = join(outputDir, type);
  const fileName = name + '.json';
  const filePath = join(dir, fileName);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ─── Display ──────────────────────────────────────────────────────────────────

export function displayEntityList(type: 'groups' | 'teachers' | 'classrooms', names: string[]): void {
  const typeLabel = type === 'groups' ? 'ГРУПИ' : type === 'teachers' ? 'ВИКЛАДАЧІ' : 'АУДИТОРІЇ';

  console.log();
  console.log(`${c.bold}${c.cyan}  ${typeLabel} ${c.gray}(${names.length})${c.reset}`);
  console.log(`${c.dim}  ${'─'.repeat(50)}${c.reset}`);

  const cols = type === 'classrooms' ? 4 : 3;
  const colWidth = Math.floor(50 / cols);

  for (let i = 0; i < names.length; i += cols) {
    const row = names.slice(i, i + cols);
    const formatted = row.map(n => {
      const display = n.replace(/_/g, ' ');
      return `  ${c.white}${display}${c.reset}`;
    });
    console.log(formatted.join(''));
  }

  console.log();
  console.log(`${c.dim}  Всього: ${names.length}${c.reset}`);
  console.log();
}

export function displaySchedule(
  entityName: string,
  type: 'group' | 'teacher' | 'classroom',
  schedule: ScheduleDay[],
  filterWeek?: 1 | 2,
  filterDay?: ScheduleDayOfWeek
): void {
  const width = 72;
  const typeLabel = type === 'group' ? 'Група' : type === 'teacher' ? 'Викладач' : 'Аудиторія';

  // Header
  console.log();
  console.log(`${c.bold}${c.white}  ┌${'─'.repeat(width - 2)}┐${c.reset}`);
  const title = `  ${typeLabel}: ${entityName.replace(/_/g, ' ')}`;
  const paddedTitle = title + ' '.repeat(Math.max(0, width - 2 - title.length + 2));
  console.log(`${c.bold}${c.white}  │${c.cyan}${paddedTitle}${c.reset}${c.bold}${c.white}│${c.reset}`);
  console.log(`${c.bold}${c.white}  └${'─'.repeat(width - 2)}┘${c.reset}`);
  console.log();

  if (schedule.length === 0) {
    console.log(`${c.dim}  Розклад порожній${c.reset}`);
    console.log();
    return;
  }

  // Count stats
  let totalLessons = 0;
  for (const day of schedule) totalLessons += day.lessons.length;

  const weekLabel = filterWeek === 1 ? ' (чисельник)' : filterWeek === 2 ? ' (знаменник)' : '';
  console.log(`${c.dim}  ${totalLessons} занять${weekLabel}${c.reset}`);
  console.log();

  // Display each day
  for (const weekNum of (filterWeek ? [filterWeek] : [1, 2] as const)) {
    const weekLabel = weekNum === 1 ? 'Чисельник' : 'Знаменник';
    const weekColor = weekNum === 1 ? c.brightYellow : c.brightBlue;

    let hasWeekData = false;
    for (const day of schedule) {
      if (day.weekNumber === weekNum) {
        if (filterDay && day.dayOfWeek !== filterDay) continue;
        if (day.lessons.length > 0) hasWeekData = true;
      }
    }
    if (!hasWeekData) continue;

    console.log(`${c.bold}  ${weekColor}━━━ ${weekLabel} ━━━${c.reset}`);

    for (const dayOfWeek of DAY_ORDER) {
      if (filterDay && dayOfWeek !== filterDay) continue;

      const dayData = schedule.find(d => d.dayOfWeek === dayOfWeek && d.weekNumber === weekNum);
      if (!dayData || dayData.lessons.length === 0) continue;

      const dayName = DAY_NAMES_UA[dayOfWeek];
      console.log();
      console.log(`  ${c.bold}${c.white}${dayName}${c.reset}`);

      for (const lesson of dayData.lessons) {
        displayLesson(lesson, type, width);
      }
    }

    console.log();
  }
}

function displayLesson(lesson: ScheduleLesson, entityType: 'group' | 'teacher' | 'classroom', _width: number): void {
  const timeStr = `${lesson.starting_at}–${lesson.ending_at}`;
  const typeColor = TYPE_COLORS[lesson.type] || c.white;
  const typeShort = TYPE_SHORT[lesson.type] || lesson.type;

  // Line 1: time + title + type
  const titleStr = lesson.title.length > 40 ? lesson.title.slice(0, 37) + '...' : lesson.title;
  console.log(`    ${c.dim}${timeStr}${c.reset}  ${c.bold}${titleStr}${c.reset}  ${typeColor}[${typeShort}]${c.reset}`);

  // Line 2: details (teacher, classroom, group)
  const details: string[] = [];

  if (entityType !== 'teacher' && lesson.teachers && lesson.teachers.length > 0) {
    details.push(`${c.white}${lesson.teachers.join(', ')}${c.reset}`);
  }

  if (entityType !== 'classroom' && lesson.classroom) {
    details.push(`${c.gray}${lesson.classroom}${c.reset}`);
  }

  if (entityType !== 'group' && lesson.group) {
    details.push(`${c.magenta}${lesson.group}${c.reset}`);
  } else if (entityType === 'group' && lesson.group) {
    details.push(`${c.magenta}[${lesson.group}]${c.reset}`);
  }

  if (details.length > 0) {
    console.log(`              ${details.join(` ${c.dim}·${c.reset} `)}`);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function findEntity(outputDir: string, type: 'groups' | 'teachers' | 'classrooms', query: string): string | null {
  const names = listEntities(outputDir, type);
  const q = query.toLowerCase().replace(/\s+/g, '_');
  const qNoDots = q.replace(/\./g, '');

  // Exact match (with and without dots)
  const exact = names.find(n => {
    const nl = n.toLowerCase();
    return nl === q || nl === qNoDots || nl.replace(/_/g, ' ') === query.toLowerCase();
  });
  if (exact) return exact;

  // Partial match
  const partial = names.filter(n => {
    const nl = n.toLowerCase();
    return nl.includes(q) || nl.includes(qNoDots) || nl.replace(/_/g, ' ').includes(query.toLowerCase());
  });
  if (partial.length === 1) return partial[0];

  if (partial.length > 1) {
    console.log(`\n${c.yellow}  Знайдено кілька збігів:${c.reset}`);
    for (const p of partial.slice(0, 10)) {
      console.log(`    ${c.white}${p.replace(/_/g, ' ')}${c.reset}`);
    }
    if (partial.length > 10) {
      console.log(`    ${c.dim}... та ще ${partial.length - 10}${c.reset}`);
    }
    console.log();
    return null;
  }

  // Fuzzy: Levenshtein distance <= 2
  const fuzzy = names.filter(n => {
    const a = n.toLowerCase().replace(/_/g, '');
    const b = q.replace(/_/g, '');
    return levenshtein(a, b) <= 2 || a.includes(b.slice(0, 3));
  });

  if (fuzzy.length > 0) {
    console.log(`\n${c.yellow}  Не знайдено "${query}". Можливо ви мали на увазі:${c.reset}`);
    for (const f of fuzzy.slice(0, 5)) {
      console.log(`    ${c.white}${f.replace(/_/g, ' ')}${c.reset}`);
    }
    console.log();
    return null;
  }

  console.log(`\n${c.red}  Не знайдено: ${query}${c.reset}\n`);
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}
