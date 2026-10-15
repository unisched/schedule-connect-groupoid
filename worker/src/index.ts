import { bearerAuth } from 'hono/bearer-auth';
import { cache } from 'hono/cache';
import { etag } from 'hono/etag';
import { Hono } from 'hono';

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isBetween from 'dayjs/plugin/isBetween';
import isoWeek from 'dayjs/plugin/isoWeek.js';

// Initialize dayjs with plugins
dayjs.extend(customParseFormat);
dayjs.extend(isBetween);
dayjs.extend(isoWeek);

// Create a new Hono application
const app = new Hono();

if (process.env.ENVIRONMENT === 'production') {
  // Add middleware for authentication
  app.use(bearerAuth({ token: process.env.SERVICE_API_KEY || '' }));
  // Set up response caching and ETag headers
  app.use(cache({
    cacheName: process.env.CACHE_NAME || '',
    cacheControl: process.env.CACHE_CTRL || '',
  }));
  app.use(etag());
}

/*
 * Reads an object (`entities.json` or `prefix/id.json`) from the R2 bucket
 * bound to the worker as "SCHEDULES". Returns null when the object (or the
 * bucket binding) is not available.
 */
async function getScheduleObject(c: any, path: string): Promise<R2ObjectBody | null> {
  const bucket = c.env?.SCHEDULES;
  if (!bucket) {
    return null;
  }
  return bucket.get(path);
}

/*
 * Function to get the schedule week number based on the target date.
 * @param target - The target date.
 * @returns The schedule week number.
 */
function getScheduleWeek(target: dayjs.Dayjs): number {
  const weekStart: number = parseInt(process.env.SCHEDULE_WEEK_START || '1', 10);
  const weekCount: number = parseInt(process.env.SCHEDULE_WEEK_COUNT || '1', 10);

  const dateFormat: string = 'DD.MM.YYYY';

  // Pass dateFormat as the second argument so Day.js parses the env string properly
  const start = dayjs(process.env.SCHEDULE_SEMESTER_START, dateFormat);
  const end = dayjs(process.env.SCHEDULE_SEMESTER_END, dateFormat);

  // Validate the target date format
  if (!target.isValid()) {
    throw new Error('INVALID_DAY_FORMAT');
  }

  // Normalize all dates to the beginning of their respective ISO week (Monday).
  // This prevents out-of-range errors if the semester starts mid-week (e.g., Wednesday)
  // but the target date is the Monday of that exact same week.
  const startMonday = start.startOf('isoWeek');
  const endMonday = end.startOf('isoWeek');
  const targetMonday = target.startOf('isoWeek');

  // Check if the target week falls outside the semester bounds
  if (targetMonday.isBefore(startMonday) || targetMonday.isAfter(endMonday)) {
    throw new Error('DAY_OUT_OF_RANGE');
  }

  // Calculate the absolute difference in weeks
  const weeksDiff = targetMonday.diff(startMonday, 'week');

  // JavaScript's % operator returns negative results for negative inputs (e.g., -1 % 2 = -1).
  // This formula ensures a true mathematical modulo operation to prevent negative index errors.
  const rawWeek = (weeksDiff + (weekStart - 1)) % weekCount;
  return (rawWeek < 0 ? rawWeek + weekCount : rawWeek) + 1;
}

/*
 * Route to get the list of entities
 * (groups, teachers, classrooms).
 */
app.get('/v1/entities', async (c) => {
  const obj = await getScheduleObject(c, 'entities.json');
  if (!obj) {
    return c.json({ error: 'FAILED_TO_FETCH' }, 500);
  }
  return c.json(await obj.json());
});

/*
 * Route to get the schedule for a specific
 * week based on type, id, and week.
 */
app.get('/v1/schedule/week/:type/:id/:day', async (c) => {
  const { type, id, day } = c.req.param();

  // Determine the correct file path based on the type parameter
  let typePrefix: string;
  switch (type) {
    case 'group':
      typePrefix = 'groups';
      break;
    case 'teacher':
      typePrefix = 'teachers';
      break;
    case 'location':
      typePrefix = 'classrooms';
      break;
    default:
      return c.json({ error: 'INVALID_TYPE' }, 400);
  }

  // Validate the day parameter format (DD.MM.YYYY)
  const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[012])\.\d{4}$/;
  if (!dateRegex.test(day)) {
    return c.json({ error: 'INVALID_DAY_FORMAT' }, 400);
  }

  // Validate the type and id parameters against the entities.json file
  const entitiesObj = await getScheduleObject(c, 'entities.json');
  if (!entitiesObj) {
    return c.json({ error: 'FAILED_TO_FETCH' }, 500);
  }
  const entitiesData: any[] = (await entitiesObj.json()) as any[];
  // Check if the entity exists in the entities.json file
  const entityExists = entitiesData.some(entity => entity.type === type && entity.id === id);
  if (!entityExists) {
    return c.json({ error: 'NO_ENTITY_FOUND' }, 404);
  }

  // Calculate the schedule week number based on the provided day
  let weekNumber: number;
  try {
    const targetDate = dayjs(day, 'DD.MM.YYYY');
    weekNumber = getScheduleWeek(targetDate);
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }

  // Fetch the schedule data from the R2 bucket
  const obj = await getScheduleObject(c, `${typePrefix}/${id}.json`);
  if (!obj) {
    return c.json({ error: 'FAILED_TO_FETCH' }, 500);
  }
  const data: any[] = (await obj.json()) as any[];

  // Find the schedule for the calculated week number
  const scheduleForWeek = data.filter((day: any) => day.weekNumber === weekNumber);
  // Respond with the schedule for the week or an error if not found
  if (scheduleForWeek.length === 0) {
    return c.json({ error: 'EMPTY_SCHEDULE' }, 404);
  }
  return c.json(scheduleForWeek);
});

// Export the app for deployment
export default app;
