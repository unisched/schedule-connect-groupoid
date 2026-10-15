/*
 * Copyright © 2023-2026, Yurii Kadirov. All rights reserved.
 * See [LICENSE.md] in the project root for more details.
 */

import {
  ScheduleEntityType,
  ScheduleEntitiesListItem,
  ScheduleDayOfWeek,
  ScheduleLesson,
  ScheduleDay,
  ScheduleDaysList
} from './types.js';

const DAY_NAME_MAP: Record<string, ScheduleDayOfWeek> = {
  'понеділок': ScheduleDayOfWeek.Monday,
  'вівторок': ScheduleDayOfWeek.Tuesday,
  'середа': ScheduleDayOfWeek.Wednesday,
  'четвер': ScheduleDayOfWeek.Thursday,
  "п'ятниця": ScheduleDayOfWeek.Friday,
  'пятниця': ScheduleDayOfWeek.Friday,
  'субота': ScheduleDayOfWeek.Saturday,
  'неділя': ScheduleDayOfWeek.Sunday
};

const DAY_NAME_ORDER: ScheduleDayOfWeek[] = [
  ScheduleDayOfWeek.Monday,
  ScheduleDayOfWeek.Tuesday,
  ScheduleDayOfWeek.Wednesday,
  ScheduleDayOfWeek.Thursday,
  ScheduleDayOfWeek.Friday,
  ScheduleDayOfWeek.Saturday,
  ScheduleDayOfWeek.Sunday
];

const LESSON_DURATION_MINUTES = 90;
const FIRST_LESSON_TIME = '08:30';

const STANDARD_TIME_SLOTS = [
  '08:30',
  '10:20',
  '12:10',
  '14:00',
  '15:50',
  '17:40'
];

type ScheduleFormat = 'knit' | 'standard';

interface ParsedLesson {
  subject: string;
  type: string;
  teachers: string[];
  classroom: string | null;
}

export interface ExtractedLesson {
  dayOfWeek: ScheduleDayOfWeek;
  weekNumber: 1 | 2;
  order: number;
  time: string;
  subject: string;
  type: string;
  teachers: string[];
  classroom: string | null;
  groupName: string;
  subgroup: string | null;
  institute: string;
}

interface GroupSchedule {
  groupName: string;
  institute: string;
  subgroups: string[];
  lessons: ExtractedLesson[];
}

interface TeacherSchedule {
  teacherName: string;
  institute: string;
  lessons: ExtractedLesson[];
}

interface ClassroomSchedule {
  classroomId: string;
  institute: string;
  lessons: ExtractedLesson[];
}

/*
 * Phase 1: Extract group schedules from a single grid (HTML file).
 * Returns group schedules, per-file entities, and a flat list of all lessons.
 */
export function extractGroupSchedules(grid: string[][], institute: string): {
  groups: Map<string, GroupSchedule>;
  entities: ScheduleEntitiesListItem[];
  allLessons: ExtractedLesson[];
} {
  if (grid.length < 2) {
    throw new Error('Table has insufficient rows');
  }

  const format = detectFormat(grid);
  const headerRow = grid[0];

  // Parse header: collect subgroups and their ACTUAL column indices
  const subgroups: string[] = [];
  const subgroupColumns: number[] = [];
  let groupStartCol = -1;

  for (let col = 0; col < headerRow.length; col++) {
    const cell = headerRow[col];
    if (cell && cell !== 'А' && cell !== 'Дні тижня' && cell !== 'Час проведення занять') {
      if (groupStartCol === -1) groupStartCol = col;
      const subgroupName = cell.replace(/\s+/g, ' ').trim();
      if (subgroupName && !subgroups.includes(subgroupName)) {
        subgroups.push(subgroupName);
        subgroupColumns.push(col);
      }
    }
  }

  if (groupStartCol === -1) {
    throw new Error('Could not find group columns in header');
  }

  const groups = new Map<string, GroupSchedule>();
  const allLessons: ExtractedLesson[] = [];

  // Build group-to-subgroups mapping
  const groupToSubgroups = new Map<string, string[]>();
  for (const subgroup of subgroups) {
    const groupName = extractGroupName(subgroup);
    if (!groupToSubgroups.has(groupName)) {
      groupToSubgroups.set(groupName, []);
    }
    groupToSubgroups.get(groupName)!.push(subgroup);
  }

  for (const [groupName, subgroupList] of groupToSubgroups) {
    const standardName = standardizeName(groupName);
    groups.set(standardName, {
      groupName: standardName,
      institute,
      subgroups: subgroupList,
      lessons: []
    });
  }

  // Iterate through rows and extract lessons
  let currentDay: ScheduleDayOfWeek | null = null;
  let currentOrder = 0;
  let currentTime = '';
  let currentWeekNumber: 1 | 2 = 1;

  for (let rowIdx = 1; rowIdx < grid.length; rowIdx++) {
    const row = grid[rowIdx];
    if (!row || row.length === 0) continue;

    const dayMatch = findDayName(row);
    if (dayMatch) {
      currentDay = dayMatch;
    }

    const timeMatch = extractTimeAndOrder(row, groupStartCol, format);
    if (timeMatch) {
      currentOrder = timeMatch.order;
      currentTime = timeMatch.time;
      currentWeekNumber = timeMatch.weekNumber;
    }

    if (!currentDay || !currentTime) continue;

    // Collect parsed lessons per subgroup for this row
    const rowLessons = new Map<string, { subgroup: string; parsed: ParsedLesson }>();

    for (let g = 0; g < subgroups.length; g++) {
      const groupCol = subgroupColumns[g]; // Use actual column index
      if (groupCol >= row.length) continue;

      const cellContent = row[groupCol]?.trim();
      if (!cellContent || cellContent === '---' || cellContent === '') continue;

      const parsed = parseLessonCell(cellContent, format);
      if (parsed) {
        rowLessons.set(subgroups[g], { subgroup: subgroups[g], parsed });
      }
    }

    // Group lessons by group name for deduplication
    const groupLessons = new Map<string, { lessons: ParsedLesson[]; subgroups: string[] }>();
    for (const [subgroup, { parsed }] of rowLessons) {
      const groupName = extractGroupName(subgroup);
      if (!groupLessons.has(groupName)) {
        groupLessons.set(groupName, { lessons: [], subgroups: [] });
      }
      const groupData = groupLessons.get(groupName)!;
      groupData.lessons.push(parsed);
      groupData.subgroups.push(subgroup);
    }

    // Process each group's lessons
    for (const [groupName, { lessons: groupLessonList, subgroups: subgroupList }] of groupLessons) {
      const standardGroupName = standardizeName(groupName);
      const groupSchedule = groups.get(standardGroupName);
      if (!groupSchedule) continue;

      const totalSubgroups = groupSchedule.subgroups.length;
      const subgroupsWithLessons = new Set(subgroupList).size;
      const allSubgroupsHaveLessons = subgroupsWithLessons === totalSubgroups;

      // Check if all subgroups have the same lesson (shared lecture)
      const allSame = allSubgroupsHaveLessons && groupLessonList.length > 1 &&
        groupLessonList.every(l =>
          l.subject === groupLessonList[0].subject &&
          l.type === groupLessonList[0].type &&
          arraysEqual(l.teachers, groupLessonList[0].teachers) &&
          l.classroom === groupLessonList[0].classroom
        );

      // Deduplicate lessons
      const uniqueLessons = new Map<string, { parsed: ParsedLesson; subgroup: string }>();
      for (let i = 0; i < groupLessonList.length; i++) {
        const lesson = groupLessonList[i];
        const key = `${lesson.subject}|${lesson.type}|${lesson.teachers.join(',')}|${lesson.classroom}`;
        if (!uniqueLessons.has(key)) {
          uniqueLessons.set(key, { parsed: lesson, subgroup: subgroupList[i] });
        }
      }

      for (const [, { parsed, subgroup }] of uniqueLessons) {
        const isShared = allSame;

        const lesson: ExtractedLesson = {
          dayOfWeek: currentDay,
          weekNumber: currentWeekNumber,
          order: currentOrder,
          time: currentTime,
          subject: parsed.subject,
          type: parsed.type,
          teachers: parsed.teachers,
          classroom: parsed.classroom,
          groupName: standardGroupName,
          subgroup: isShared ? null : subgroup,
          institute
        };

        groupSchedule.lessons.push(lesson);
        allLessons.push(lesson);
      }
    }
  }

  // Build per-file entities
  const entities: ScheduleEntitiesListItem[] = [];

  for (const [groupName, groupSchedule] of groups) {
    entities.push({
      id: groupName,
      type: ScheduleEntityType.Group,
      title: groupSchedule.groupName,
      subtitle: null,
      department: institute
    });
  }

  const teacherSet = new Set<string>();
  const classroomSet = new Set<string>();
  for (const lesson of allLessons) {
    for (const t of lesson.teachers) teacherSet.add(t);
    if (lesson.classroom) classroomSet.add(lesson.classroom);
  }

  for (const teacher of teacherSet) {
    entities.push({
      id: standardizeName(teacher),
      type: ScheduleEntityType.Teacher,
      title: teacher,
      subtitle: null,
      department: institute
    });
  }

  for (const classroom of classroomSet) {
    entities.push({
      id: standardizeName(classroom),
      type: ScheduleEntityType.Location,
      title: classroom,
      subtitle: null,
      department: institute
    });
  }

  return { groups, entities, allLessons };
}

/*
 * Phase 2: Derive teacher and classroom schedules from the accumulated group lessons.
 * This is the single source of truth approach — teacher/classroom schedules are
 * guaranteed to be fully consistent with group schedules.
 *
 * Deduplication: when the same lesson is shared across subgroups of the same group
 * (e.g., КН-11-1 and КН-11-2 attend the same lecture), it appears once with
 * group = group name. Lessons from DIFFERENT groups are kept separate.
 */
export function deriveTeacherClassroomSchedules(allLessons: ExtractedLesson[]): {
  teachers: Map<string, TeacherSchedule>;
  classrooms: Map<string, ClassroomSchedule>;
} {
  // Use Maps of Maps for deduplication: teacher → dedupKey → lesson
  const teacherLessonMaps = new Map<string, Map<string, ExtractedLesson>>();
  const classroomLessonMaps = new Map<string, Map<string, ExtractedLesson>>();

  for (const lesson of allLessons) {
    // Dedup key includes groupName — only deduplicate within the same group
    const teacherDedupKey = `${lesson.dayOfWeek}|${lesson.weekNumber}|${lesson.order}|${lesson.time}|${lesson.subject}|${lesson.type}|${lesson.classroom}|${lesson.groupName}`;

    for (const teacherName of lesson.teachers) {
      if (!teacherLessonMaps.has(teacherName)) {
        teacherLessonMaps.set(teacherName, new Map());
      }
      const lessonMap = teacherLessonMaps.get(teacherName)!;

      if (!lessonMap.has(teacherDedupKey)) {
        lessonMap.set(teacherDedupKey, lesson);
      } else {
        // Same lesson from another subgroup of the same group — mark as shared
        const existing = lessonMap.get(teacherDedupKey)!;
        if (existing.subgroup !== null) {
          lessonMap.set(teacherDedupKey, { ...existing, subgroup: null });
        }
      }
    }

    // Dedup key for classroom: includes groupName
    if (lesson.classroom) {
      const classroomDedupKey = `${lesson.dayOfWeek}|${lesson.weekNumber}|${lesson.order}|${lesson.time}|${lesson.subject}|${lesson.type}|${lesson.teachers.join(',')}|${lesson.groupName}`;

      if (!classroomLessonMaps.has(lesson.classroom)) {
        classroomLessonMaps.set(lesson.classroom, new Map());
      }
      const lessonMap = classroomLessonMaps.get(lesson.classroom)!;

      if (!lessonMap.has(classroomDedupKey)) {
        lessonMap.set(classroomDedupKey, lesson);
      } else {
        const existing = lessonMap.get(classroomDedupKey)!;
        if (existing.subgroup !== null) {
          lessonMap.set(classroomDedupKey, { ...existing, subgroup: null });
        }
      }
    }
  }

  // Build final schedules from the deduplication maps
  const teachers = new Map<string, TeacherSchedule>();
  for (const [teacherName, lessonMap] of teacherLessonMaps) {
    const lessons = [...lessonMap.values()];
    teachers.set(teacherName, {
      teacherName,
      institute: resolvePrimaryInstitute(lessons),
      lessons
    });
  }

  const classrooms = new Map<string, ClassroomSchedule>();
  for (const [classroomName, lessonMap] of classroomLessonMaps) {
    const lessons = [...lessonMap.values()];
    classrooms.set(classroomName, {
      classroomId: classroomName,
      institute: resolvePrimaryInstitute(lessons),
      lessons
    });
  }

  return { teachers, classrooms };
}

/*
 * Determine the primary institute of a derived schedule: the institute the
 * entity has the most lessons in. Ties are broken alphabetically, so the
 * result never depends on the order in which HTML files were processed.
 * Returns an empty string when no lesson carries an institute.
 */
function resolvePrimaryInstitute(lessons: ExtractedLesson[]): string {
  const counts = new Map<string, number>();

  for (const lesson of lessons) {
    if (!lesson.institute) continue;
    counts.set(lesson.institute, (counts.get(lesson.institute) || 0) + 1);
  }

  let primary = '';
  let primaryCount = 0;

  for (const institute of [...counts.keys()].sort()) {
    const count = counts.get(institute)!;
    if (count > primaryCount) {
      primary = institute;
      primaryCount = count;
    }
  }

  return primary;
}

/*
 * Phase 3: Verify consistency between group lessons and derived teacher/classroom schedules.
 */
export function verifySchedules(
  allLessons: ExtractedLesson[],
  teachers: Map<string, TeacherSchedule>,
  classrooms: Map<string, ClassroomSchedule>
): { pass: boolean; errors: string[] } {
  const errors: string[] = [];

  // Build signature sets for cross-checking (excluding groupName/subgroup for dedup-aware matching)
  const groupTeacherSlots = new Map<string, Set<string>>(); // teacher → set of lesson signatures
  const groupClassroomSlots = new Map<string, Set<string>>(); // classroom → set of lesson signatures

  for (const lesson of allLessons) {
    const sig = `${lesson.dayOfWeek}|${lesson.weekNumber}|${lesson.order}|${lesson.time}|${lesson.subject}|${lesson.type}|${lesson.classroom}`;

    for (const teacher of lesson.teachers) {
      if (!groupTeacherSlots.has(teacher)) groupTeacherSlots.set(teacher, new Set());
      groupTeacherSlots.get(teacher)!.add(sig);
    }

    if (lesson.classroom) {
      if (!groupClassroomSlots.has(lesson.classroom)) groupClassroomSlots.set(lesson.classroom, new Set());
      groupClassroomSlots.get(lesson.classroom)!.add(sig);
    }
  }

  // Verify teacher schedules: every unique group lesson for a teacher should appear in their schedule
  for (const [teacherName, expectedSigs] of groupTeacherSlots) {
    const teacherSchedule = teachers.get(teacherName);
    if (!teacherSchedule) {
      errors.push(`Teacher "${teacherName}" not found in derived schedules`);
      continue;
    }

    const actualSigs = new Set(
      teacherSchedule.lessons.map(l =>
        `${l.dayOfWeek}|${l.weekNumber}|${l.order}|${l.time}|${l.subject}|${l.type}|${l.classroom}`
      )
    );

    for (const sig of expectedSigs) {
      if (!actualSigs.has(sig)) {
        errors.push(`Teacher "${teacherName}" missing lesson: ${sig}`);
      }
    }
  }

  // Verify classroom schedules: every unique group lesson for a classroom should appear in its schedule
  for (const [classroomName, expectedSigs] of groupClassroomSlots) {
    const classroomSchedule = classrooms.get(classroomName);
    if (!classroomSchedule) {
      errors.push(`Classroom "${classroomName}" not found in derived schedules`);
      continue;
    }

    const actualSigs = new Set(
      classroomSchedule.lessons.map(l =>
        `${l.dayOfWeek}|${l.weekNumber}|${l.order}|${l.time}|${l.subject}|${l.type}|${l.classroom}`
      )
    );

    for (const sig of expectedSigs) {
      if (!actualSigs.has(sig)) {
        errors.push(`Classroom "${classroomName}" missing lesson: ${sig}`);
      }
    }
  }

  // Check for duplicate lessons in teacher schedules
  for (const [teacherName, teacher] of teachers) {
    const seen = new Set<string>();
    for (const lesson of teacher.lessons) {
      const key = `${lesson.dayOfWeek}-${lesson.weekNumber}-${lesson.order}-${lesson.subject}-${lesson.type}-${lesson.classroom}-${lesson.groupName}`;
      if (seen.has(key)) {
        errors.push(`Teacher "${teacherName}" has duplicate lesson: ${key}`);
      }
      seen.add(key);
    }
  }

  // Check for duplicate lessons in classroom schedules
  for (const [classroomName, classroom] of classrooms) {
    const seen = new Set<string>();
    for (const lesson of classroom.lessons) {
      const key = `${lesson.dayOfWeek}-${lesson.weekNumber}-${lesson.order}-${lesson.subject}-${lesson.type}-${lesson.teachers.join(',')}-${lesson.groupName}`;
      if (seen.has(key)) {
        errors.push(`Classroom "${classroomName}" has duplicate lesson: ${key}`);
      }
      seen.add(key);
    }
  }

  return { pass: errors.length === 0, errors };
}

/*
 * Build the output ScheduleDaysList from a flat list of ExtractedLesson.
 * For group schedules: group = subgroup or null (shared by all subgroups).
 * For teacher/classroom schedules: group = subgroup or groupName (never null).
 */
export function buildScheduleDays(
  lessons: ExtractedLesson[],
  scheduleType: 'group' | 'teacher' | 'classroom' = 'group'
): ScheduleDaysList {
  const dayMap = new Map<string, ExtractedLesson[]>();

  for (const lesson of lessons) {
    const key = `${lesson.dayOfWeek}-${lesson.weekNumber}`;
    if (!dayMap.has(key)) {
      dayMap.set(key, []);
    }
    dayMap.get(key)!.push(lesson);
  }

  const result: ScheduleDay[] = [];

  for (const dayOfWeek of DAY_NAME_ORDER) {
    for (const weekNumber of [1, 2] as const) {
      const key = `${dayOfWeek}-${weekNumber}`;
      const dayLessons = dayMap.get(key) || [];

      if (dayLessons.length > 0) {
        const sortedLessons = dayLessons.sort((a, b) => a.order - b.order);

        result.push({
          dayOfWeek,
          weekNumber,
          lessons: sortedLessons.map(lesson => ({
            order: lesson.order,
            starting_at: normalizeTime(lesson.time.split('-')[0] || '08:00'),
            ending_at: normalizeTime(lesson.time.split('-')[1] || '09:30'),
            half_pair: null,
            title: lesson.subject,
            type: lesson.type,
            teachers: lesson.teachers.length > 0 ? lesson.teachers : null,
            group: resolveGroupField(lesson, scheduleType),
            classroom: lesson.classroom,
            link: null,
            link_comment: null,
            replacement: null,
            description: null
          }))
        });
      }
    }
  }

  return result;
}

function resolveGroupField(lesson: ExtractedLesson, scheduleType: 'group' | 'teacher' | 'classroom'): string | null {
  if (scheduleType === 'group') {
    // Group schedule: subgroup or null (shared by all subgroups)
    return lesson.subgroup ? standardizeName(lesson.subgroup) : null;
  }
  // Teacher/classroom schedule: subgroup or groupName (never null)
  if (lesson.subgroup) {
    return standardizeName(lesson.subgroup);
  }
  return standardizeName(lesson.groupName);
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractGroupName(subgroupName: string): string {
  const cleaned = subgroupName.replace(/\s+/g, '');
  const match = cleaned.match(/^([А-ЯІЇЄҐA-Z]+-?\d+)/i);
  if (match) {
    return match[1];
  }
  return cleaned;
}

function standardizeName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[/\\]/g, '-')
    .trim();
}

function detectFormat(grid: string[][]): ScheduleFormat {
  for (let row = 1; row < Math.min(10, grid.length); row++) {
    const cells = grid[row];
    for (let col = 0; col < Math.min(5, cells.length); col++) {
      const cell = cells[col];
      if (cell.match(/^\d{1,2}:\d{2}_(ч|з)$/)) {
        return 'knit';
      }
    }
  }
  return 'standard';
}

function findDayName(row: string[]): ScheduleDayOfWeek | null {
  for (const cell of row) {
    const normalized = cell.toLowerCase().trim();
    for (const [key, value] of Object.entries(DAY_NAME_MAP)) {
      if (normalized.includes(key)) {
        return value;
      }
    }
  }
  return null;
}

function calculateOrder(startTime: string): number {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  for (let i = 0; i < STANDARD_TIME_SLOTS.length; i++) {
    const [slotHours, slotMinutes] = STANDARD_TIME_SLOTS[i].split(':').map(Number);
    const slotTotal = slotHours * 60 + slotMinutes;
    if (Math.abs(totalMinutes - slotTotal) < 10) {
      return i + 1;
    }
  }

  const [firstHours, firstMinutes] = FIRST_LESSON_TIME.split(':').map(Number);
  const firstTotal = firstHours * 60 + firstMinutes;
  return Math.floor((totalMinutes - firstTotal) / LESSON_DURATION_MINUTES) + 1;
}

function extractTimeAndOrder(
  row: string[],
  groupStartCol: number,
  format: ScheduleFormat
): { order: number; time: string; weekNumber: 1 | 2 } | null {
  let time = '';
  let weekNumber: 1 | 2 = 1;

  for (let col = 0; col < groupStartCol && col < row.length; col++) {
    const cell = row[col]?.trim();
    if (!cell) continue;

    const timeRangeMatch = cell.match(/(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/);
    if (timeRangeMatch) {
      const startTime = timeRangeMatch[1].replace('.', ':');
      const endTime = timeRangeMatch[2].replace('.', ':');
      time = `${startTime}-${endTime}`;
    }

    if (format === 'knit') {
      const simpleTimeMatch = cell.match(/^(\d{1,2}[.:]\d{2})_(ч|з)$/);
      if (simpleTimeMatch) {
        const startTime = simpleTimeMatch[1].replace('.', ':');
        const endTime = calculateEndTime(startTime, LESSON_DURATION_MINUTES);
        time = `${startTime}-${endTime}`;
        weekNumber = simpleTimeMatch[2] === 'ч' ? 1 : 2;
      }
    }

    if (format === 'standard') {
      const normalized = cell.toLowerCase();
      if (normalized === 'н') {
        weekNumber = 1;
      } else if (normalized === 'п') {
        weekNumber = 2;
      }
    }
  }

  if (!time) return null;

  const startTime = time.split('-')[0];
  const order = calculateOrder(startTime);

  return { order, time, weekNumber };
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

function parseLessonCell(content: string, format: ScheduleFormat): ParsedLesson | null {
  if (!content || content === '---' || content === '.' || content.length < 3) return null;

  if (format === 'knit') {
    return parseKnitFormat(content);
  }
  return parseStandardFormat(content);
}

function stripGroupPrefix(content: string): string {
  let remaining = content;

  const groupPrefixPattern = /^([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Z0-9\s,()-]+?)(?=[А-ЯІЇЄҐ][а-яіїєґ])/;
  const match = remaining.match(groupPrefixPattern);
  if (match && match[1].length > 2) {
    const prefix = match[1].trim();
    const hasLetters = /[А-ЯІЇЄҐA-Z]{2,}/.test(prefix);
    const hasDigits = /\d/.test(prefix);
    const hasParentheses = /[()]/.test(prefix);
    if ((hasLetters && hasDigits) || (hasLetters && hasParentheses)) {
      remaining = remaining.slice(match[0].length);
    }
  }

  const abbrPattern = /^([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Z0-9\s,()-]+\d)([А-ЯІЇЄҐA-Z]{2,})/;
  const abbrMatch = remaining.match(abbrPattern);
  if (abbrMatch) {
    remaining = abbrMatch[2] + remaining.slice(abbrMatch[0].length);
  }

  return remaining;
}

function cleanType(type: string): string {
  const cleaned = type
    .replace(/[_]+$/g, '')
    .replace(/^[_]+/g, '')
    .trim()
    .toLowerCase();

  if (cleaned.startsWith('лек')) return 'лекція';
  if (cleaned.startsWith('лаб')) return 'лабораторна';
  if (cleaned.startsWith('пр') || cleaned.startsWith('пз')) return 'практичне';
  if (cleaned === 'практичні') return 'практичне';

  return cleaned || 'практичне';
}

function normalizeTeacher(teacher: string): string {
  return teacher
    .replace(/\s+/g, ' ')
    .replace(/\.\s+/g, '.')
    .trim();
}

function parseKnitFormat(content: string): ParsedLesson {
  let remaining = stripGroupPrefix(content);

  remaining = remaining.replace(/^"+/, '').replace(/"+$/, '');
  remaining = remaining.replace(/""+/g, '"');

  // Split at the type position: subject is BEFORE the type, teacher+classroom is AFTER
  const typeMatch = remaining.match(/"([^"]+)"/);
  let type = '';
  let subjectPart = '';
  let afterType = remaining;

  if (typeMatch) {
    type = cleanType(typeMatch[1]);
    subjectPart = remaining.slice(0, typeMatch.index).trim();
    afterType = remaining.slice(typeMatch.index! + typeMatch[0].length).trim();
  }

  // Extract classroom from afterType
  const classroomPatterns = [
    /а\.\s*(\d+[а-яА-Я]?(?:\s*к\.\s*\d+)?)/i,
    /а\.\s*([А-ЯІЇЄҐA-Z]\s*к\.\s*\d+)/i,
    /а\.\s*([А-ЯІЇЄҐA-Z])\s/i
  ];

  let classroom: string | null = null;
  for (const pattern of classroomPatterns) {
    const match = afterType.match(pattern);
    if (match) {
      classroom = `а.${match[1].replace(/\s+/g, ' ').trim()}`;
      afterType = afterType.slice(0, match.index).trim();
      break;
    }
  }

  // Extract teacher from afterType (flexible: handles double-initial, single-initial, and surname-only)
  const teacherMatch = afterType.match(/([А-ЯІЇЄҐ][а-яіїєґ]+(?:\s+[А-ЯІЇЄҐ]\.(?:\s*[А-ЯІЇЄҐ]\.)?)?)\s*$/);
  let teachers: string[] = [];
  if (teacherMatch && teacherMatch[1]) {
    const candidate = teacherMatch[1].trim();
    // Must be a reasonable teacher name (not a subject word)
    // A teacher name: starts with uppercase, rest lowercase, 2+ chars, no digits
    if (/^[А-ЯІЇЄҐ][а-яіїєґ]{1,}$/.test(candidate.replace(/\s+[А-ЯІЇЄҐ]\.(?:\s*[А-ЯІЇЄҐ]\.)?$/, '').trim())) {
      teachers = [normalizeTeacher(candidate)];
      afterType = afterType.slice(0, -teacherMatch[0].length).trim();
    }
  }

  // Subject: if type was found, use subjectPart (before type); otherwise use remaining after teacher/classroom
  const subject = (typeMatch ? subjectPart : afterType).replace(/\s+/g, ' ').trim();

  return {
    subject: subject || content,
    type: type || 'практичне',
    teachers,
    classroom
  };
}

function parseSingleStandardLesson(content: string): ParsedLesson {
  let remaining = content;

  const groupParenMatch = remaining.match(/\(група[^)]*\)\s*$/i);
  if (groupParenMatch) {
    remaining = remaining.slice(0, -groupParenMatch[0].length).trim();
  }

  const prefixMatch = remaining.match(/^(л\.|лек\.|пр\.|пз\.|лаб\.?)\s*/i);
  let type = 'практичне';
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase();
    if (prefix.startsWith('л') && !prefix.startsWith('лаб')) type = 'лекція';
    else if (prefix.startsWith('пр') || prefix.startsWith('пз')) type = 'практичне';
    else if (prefix.startsWith('лаб')) type = 'лабораторна';
    remaining = remaining.slice(prefixMatch[0].length);
  }

  // Extract teachers from the last parenthesized group
  const teacherMatch = remaining.match(/\(([^)]+)\)\s*$/);
  let teachers: string[] = [];
  if (teacherMatch) {
    const potentialTeachers = teacherMatch[1].trim();
    const isGroupOrClassroom = potentialTeachers.match(/^\d+\/\d+$/) ||
                                potentialTeachers.toLowerCase().startsWith('група') ||
                                potentialTeachers.toLowerCase().startsWith('гр.');
    if (!isGroupOrClassroom) {
      // Split by comma to handle multiple teachers
      teachers = potentialTeachers.split(',')
        .map(t => normalizeTeacher(t.trim()))
        .filter(t => t.length > 0 && /[А-ЯІЇЄҐA-Z]/.test(t));
      remaining = remaining.slice(0, -teacherMatch[0].length).trim();
    }
  }

  const classroomPatterns = [
    /а\.\s*(\d+[а-яА-Я]?(?:\s*к\.\s*\d+)?)/i,
    /а\.\s*([А-ЯІЇЄҐA-Z]\s*к\.\s*\d+)/i,
    /а\.\s*([А-ЯІЇЄҐA-Z])\s/i
  ];

  let classroom: string | null = null;
  for (const pattern of classroomPatterns) {
    const match = remaining.match(pattern);
    if (match) {
      classroom = `а.${match[1].replace(/\s+/g, ' ').trim()}`;
      remaining = remaining.slice(0, match.index).trim();
      break;
    }
  }

  const altClassroomMatch = remaining.match(/к\.\s*(\d+)/i);
  if (!classroom && altClassroomMatch) {
    classroom = `к.${altClassroomMatch[1]}`;
    remaining = remaining.slice(0, altClassroomMatch.index).trim();
  }

  const subject = remaining.replace(/\s+/g, ' ').trim();

  return {
    subject: subject || content,
    type: cleanType(type),
    teachers,
    classroom
  };
}

function parseStandardFormat(content: string): ParsedLesson {
  let remaining = content;

  const vdMatch = remaining.match(/^ВД\.?\s*(л\.?\s*)?/i);
  if (vdMatch) {
    remaining = remaining.slice(vdMatch[0].length);
  }

  return parseSingleStandardLesson(remaining);
}

function normalizeTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours.padStart(2, '0')}:${minutes}`;
}
