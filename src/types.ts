/*
 * Copyright © 2023-2026, Yurii Kadirov. All rights reserved.
 * See [LICENSE.md] in the project root for more details.
 */

export enum ScheduleEntityType {
  Group = 'group',
  Teacher = 'teacher',
  Location = 'location'
}

export interface ScheduleEntitiesListItem {
  id: string;
  type: ScheduleEntityType;
  title: string;
  subtitle: string | null;
  department: string | null;
}

export type ScheduleEntitiesList = ScheduleEntitiesListItem[];

export enum ScheduleDayOfWeek {
  Monday = 'monday',
  Tuesday = 'tuesday',
  Wednesday = 'wednesday',
  Thursday = 'thursday',
  Friday = 'friday',
  Saturday = 'saturday',
  Sunday = 'sunday'
}

export interface ScheduleLesson {
  order: number;
  starting_at: string;
  ending_at: string;
  half_pair: string | null;
  title: string;
  type: string;
  teachers: string[] | null;
  group: string | null;
  classroom: string | null;
  link: string | null;
  link_comment: string | null;
  replacement: string | null;
  description: string | null;
}

export interface ScheduleDay {
  dayOfWeek: ScheduleDayOfWeek;
  weekNumber: 1 | 2;
  lessons: ScheduleLesson[];
}

export type ScheduleDaysList = ScheduleDay[];

export interface ParsedCell {
  text: string;
  rowspan: number;
  colspan: number;
}
