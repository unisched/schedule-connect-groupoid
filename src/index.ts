#!/usr/bin/env node

/*
 * Copyright © 2023-2026, Yurii Kadirov. All rights reserved.
 * See [LICENSE.md] in the project root for more details.
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename, extname, isAbsolute } from 'path';
import { parseHtmlTable, expandTable } from './parser.js';
import {
  extractGroupSchedules,
  deriveTeacherClassroomSchedules,
  verifySchedules,
  buildScheduleDays,
  ExtractedLesson
} from './extractor.js';
import { ScheduleEntitiesListItem, ScheduleDayOfWeek } from './types.js';
import {
  listEntities,
  loadSchedule,
  displayEntityList,
  displaySchedule,
  findEntity
} from './viewer.js';

const program = new Command();

program
  .name('schedule-connect')
  .description('Convert UNFU schedule HTML files to structured JSON')
  .version('1.0.0');

program
  .command('convert')
  .description('Convert a single HTML file or directory of HTML files to JSON')
  .argument('<input>', 'Input HTML file or directory')
  .option('-o, --output <dir>', 'Output directory for JSON files', './output')
  .option('-i, --institute <name>', 'Institute name', 'ННІ')
  .option('-r, --recursive', 'Process subdirectories recursively', true)
  .action(async (input: string, options: {
    output: string;
    institute: string;
    recursive: boolean;
  }) => {
    try {
      const inputPath = resolvePath(input);
      const outputDir = resolvePath(options.output);

      mkdirSync(outputDir, { recursive: true });

      const stat = statSync(inputPath);

      // Phase 1: Collect all HTML files
      const htmlFiles = collectHtmlFiles(inputPath, stat, options.recursive);
      console.log(`Found ${htmlFiles.length} HTML file(s) to process.`);

      // Phase 2: Process all files, accumulate group schedules in memory
      const allGroups = new Map<string, { groupName: string; institute: string; subgroups: string[]; lessons: ExtractedLesson[] }>();
      const allLessons: ExtractedLesson[] = [];

      for (const filePath of htmlFiles) {
        const fileName = basename(filePath, extname(filePath));
        const dirName = basename(join(filePath, '..'));
        const currentInstitute = dirName.startsWith('ННІ') ? dirName : options.institute;

        console.log(`  Processing: ${fileName} (${currentInstitute})`);

        const html = readFileSync(filePath, 'utf-8');
        const table = parseHtmlTable(html);
        const grid = expandTable(table);

        const { groups, allLessons: fileLessons } = extractGroupSchedules(grid, currentInstitute);

        // Merge groups into global map
        for (const [name, schedule] of groups) {
          if (allGroups.has(name)) {
            const existing = allGroups.get(name)!;
            existing.lessons.push(...schedule.lessons);
          } else {
            allGroups.set(name, schedule);
          }
        }

        allLessons.push(...fileLessons);
      }

      console.log(`\nCollected ${allGroups.size} groups, ${allLessons.length} total lessons.`);

      // Phase 3: Derive teacher and classroom schedules from group schedules
      const { teachers, classrooms } = deriveTeacherClassroomSchedules(allLessons);

      console.log(`Derived ${teachers.size} teachers, ${classrooms.size} classrooms.`);

      // Phase 4: Verify consistency
      const verification = verifySchedules(allLessons, teachers, classrooms);

      if (!verification.pass) {
        console.error('\nVerification FAILED:');
        for (const error of verification.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }

      console.log('Verification PASSED.');

      // Phase 5: Write all output files in a single pass
      const groupsDir = join(outputDir, 'groups');
      const teachersDir = join(outputDir, 'teachers');
      const classroomsDir = join(outputDir, 'classrooms');

      mkdirSync(groupsDir, { recursive: true });
      mkdirSync(teachersDir, { recursive: true });
      mkdirSync(classroomsDir, { recursive: true });

      // Write group schedules
      for (const [groupName, groupSchedule] of allGroups) {
        const scheduleDays = buildScheduleDays(groupSchedule.lessons, 'group');
        const outputFile = join(groupsDir, `${groupName}.json`);
        writeFileSync(outputFile, JSON.stringify(scheduleDays, null, 2), 'utf-8');
        console.log(`    -> ${outputFile}`);
      }

      // Write teacher schedules
      for (const [teacherName, teacherSchedule] of teachers) {
        const scheduleDays = buildScheduleDays(teacherSchedule.lessons, 'teacher');
        const teacherId = teacherName.replace(/\s+/g, '_');
        const outputFile = join(teachersDir, `${teacherId}.json`);
        writeFileSync(outputFile, JSON.stringify(scheduleDays, null, 2), 'utf-8');
        console.log(`    -> ${outputFile}`);
      }

      // Write classroom schedules
      for (const [classroomName, classroomSchedule] of classrooms) {
        const scheduleDays = buildScheduleDays(classroomSchedule.lessons, 'classroom');
        const outputFile = join(classroomsDir, `${classroomId(classroomName)}.json`);
        writeFileSync(outputFile, JSON.stringify(scheduleDays, null, 2), 'utf-8');
        console.log(`    -> ${outputFile}`);
      }

      // Build and write single global entities file
      const allEntities: ScheduleEntitiesListItem[] = [];
      const seenIds = new Set<string>();

      for (const [groupName, groupSchedule] of allGroups) {
        if (!seenIds.has(groupName)) {
          seenIds.add(groupName);
          allEntities.push({
            id: groupName,
            type: 'group' as any,
            title: groupName,
            subtitle: null,
            department: groupSchedule.institute
          });
        }
      }

      for (const [teacherName, teacherSchedule] of teachers) {
        const id = teacherName.replace(/\s+/g, '_');
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allEntities.push({
            id,
            type: 'teacher' as any,
            title: teacherName,
            subtitle: null,
            department: teacherSchedule.institute || null
          });
        }
      }

      for (const [classroomName, classroomSchedule] of classrooms) {
        const id = classroomId(classroomName);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allEntities.push({
            id,
            type: 'location' as any,
            title: classroomName,
            subtitle: null,
            department: classroomSchedule.institute || null
          });
        }
      }

      const entitiesFile = join(outputDir, 'entities.json');
      writeFileSync(entitiesFile, JSON.stringify(allEntities, null, 2), 'utf-8');
      console.log(`    -> ${entitiesFile}`);

      console.log('\nConversion completed successfully!');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function collectHtmlFiles(
  inputPath: string,
  stat: ReturnType<typeof statSync> | undefined,
  recursive: boolean
): string[] {
  const files: string[] = [];

  if (stat?.isFile() && extname(inputPath).toLowerCase() === '.html') {
    files.push(inputPath);
  } else if (stat?.isDirectory()) {
    const entries = readdirSync(inputPath);

    for (const entry of entries) {
      if (entry === '.DS_Store' || entry === 'resources') continue;

      const fullPath = join(inputPath, entry);
      const entryStat = statSync(fullPath);

      if (entryStat.isFile() && extname(entry).toLowerCase() === '.html') {
        files.push(fullPath);
      } else if (entryStat.isDirectory() && recursive) {
        files.push(...collectHtmlFiles(fullPath, entryStat, recursive));
      }
    }
  }

  return files;
}

function classroomId(classroomName: string): string {
  return classroomName.replace(/\s+/g, '_').replace(/\./g, '');
}

/*
 * Resolve a user-supplied path against the current working directory.
 * Absolute paths are used as-is (`join()` would incorrectly prefix them).
 */
function resolvePath(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

// ─── View command ─────────────────────────────────────────────────────────────

const viewCmd = program
  .command('view')
  .description('View exported schedule data');

viewCmd
  .command('groups')
  .description('List all student groups')
  .option('-o, --output <dir>', 'Output directory', './output')
  .action((options: { output: string }) => {
    const outputDir = resolvePath(options.output);
    const names = listEntities(outputDir, 'groups');
    if (names.length === 0) { console.log('No groups found. Run "convert" first.'); return; }
    displayEntityList('groups', names);
  });

viewCmd
  .command('teachers')
  .description('List all teachers')
  .option('-o, --output <dir>', 'Output directory', './output')
  .action((options: { output: string }) => {
    const outputDir = resolvePath(options.output);
    const names = listEntities(outputDir, 'teachers');
    if (names.length === 0) { console.log('No teachers found. Run "convert" first.'); return; }
    displayEntityList('teachers', names);
  });

viewCmd
  .command('classrooms')
  .description('List all classrooms')
  .option('-o, --output <dir>', 'Output directory', './output')
  .action((options: { output: string }) => {
    const outputDir = resolvePath(options.output);
    const names = listEntities(outputDir, 'classrooms');
    if (names.length === 0) { console.log('No classrooms found. Run "convert" first.'); return; }
    displayEntityList('classrooms', names);
  });

viewCmd
  .command('group')
  .description('Show schedule for a student group')
  .argument('<name>', 'Group name (e.g. КН-11)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-w, --week <number>', 'Filter by week (1=чисельник, 2=знаменник)')
  .option('-d, --day <name>', 'Filter by day (monday, tuesday, ...)')
  .action((name: string, options: { output: string; week?: string; day?: string }) => {
    const outputDir = resolvePath(options.output);
    const resolved = findEntity(outputDir, 'groups', name);
    if (!resolved) return;
    const schedule = loadSchedule(outputDir, 'groups', resolved);
    if (!schedule) { console.log('Schedule not found.'); return; }
    const week = options.week ? parseInt(options.week) as 1 | 2 : undefined;
    const day = options.day ? options.day.toLowerCase() as ScheduleDayOfWeek : undefined;
    displaySchedule(resolved, 'group', schedule, week, day);
  });

viewCmd
  .command('teacher')
  .description('Show schedule for a teacher')
  .argument('<name>', 'Teacher name (e.g. "Самотій Т.С.")')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-w, --week <number>', 'Filter by week (1 or 2)')
  .option('-d, --day <name>', 'Filter by day')
  .action((name: string, options: { output: string; week?: string; day?: string }) => {
    const outputDir = resolvePath(options.output);
    const resolved = findEntity(outputDir, 'teachers', name);
    if (!resolved) return;
    const schedule = loadSchedule(outputDir, 'teachers', resolved);
    if (!schedule) { console.log('Schedule not found.'); return; }
    const week = options.week ? parseInt(options.week) as 1 | 2 : undefined;
    const day = options.day ? options.day.toLowerCase() as ScheduleDayOfWeek : undefined;
    displaySchedule(resolved, 'teacher', schedule, week, day);
  });

viewCmd
  .command('classroom')
  .description('Show schedule for a classroom')
  .argument('<name>', 'Classroom name (e.g. а.12б)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-w, --week <number>', 'Filter by week (1 or 2)')
  .option('-d, --day <name>', 'Filter by day')
  .action((name: string, options: { output: string; week?: string; day?: string }) => {
    const outputDir = resolvePath(options.output);
    const resolved = findEntity(outputDir, 'classrooms', name);
    if (!resolved) return;
    const schedule = loadSchedule(outputDir, 'classrooms', resolved);
    if (!schedule) { console.log('Schedule not found.'); return; }
    const week = options.week ? parseInt(options.week) as 1 | 2 : undefined;
    const day = options.day ? options.day.toLowerCase() as ScheduleDayOfWeek : undefined;
    displaySchedule(resolved, 'classroom', schedule, week, day);
  });

program.parse();
