# schedule-connect-groupoid

CLI utility to convert Groupoid Infinity schedule HTML files to structured JSON format, with a built-in schedule viewer.

## Features

- Parses HTML schedule files from all Groupoid Infinity institutes (ННІ, НДІ, НВО)
- Supports two schedule formats:
  - **KNIT format**: Time with suffix (`08:30_ч/з`), combined lesson cells
  - **Standard format**: Time range (`8.30 - 10.05`), week markers (`н/п`)
- Generates separate JSON files for groups, teachers, and classrooms
- **Single source of truth**: teacher and classroom schedules are derived from group schedules, guaranteeing consistency
- Handles subgroups, shared lectures, and multiple teachers per lesson
- Built-in schedule viewer with search and filtering
- Comprehensive verification before writing output

## Installation

```bash
npm install
npm run build
```

## Usage

### Convert schedule

```bash
# Convert all institutes
npm run dev -- convert source_schedule -o output

# Convert a single file
npm run dev -- convert "source_schedule/ННІ КНІТ/КН.html" -o output -i "ННІ КНІТ"
```

#### Options

- `-o, --output <dir>` — Output directory (default: `./output`)
- `-i, --institute <name>` — Institute name (default: `ННІ`)
- `-r, --recursive` — Process subdirectories recursively (default: `true`)

### View schedule

```bash
# List all entities
npm run dev -- view groups
npm run dev -- view teachers
npm run dev -- view classrooms

# Show specific schedule
npm run dev -- view group КН-11
npm run dev -- view teacher "Самотій Т.С."
npm run dev -- view classroom а.12б

# Filter by week and day
npm run dev -- view group КН-11 -w 1              # чисельник only
npm run dev -- view teacher Сторожук -w 2 -d friday # знаменник, п'ятниця
```

Search supports partial names and fuzzy matching (Levenshtein distance ≤ 2).

## Architecture

The conversion uses a **two-phase architecture** to ensure data consistency:

1. **Phase 1 — Collect**: Parse all HTML files, build group schedules in memory (the source of truth)
2. **Phase 2 — Derive**: Build teacher and classroom schedules from the accumulated group lessons
3. **Phase 3 — Verify**: Cross-check every teacher/classroom lesson against group schedules
4. **Phase 4 — Write**: Write all output files in a single pass

This guarantees that teacher and classroom schedules are **fully consistent** with group schedules — no lost lessons, no phantom lessons.

## Output Structure

```
output/
├── groups/          # Розклад груп (source of truth)
│   ├── КН-11.json
│   ├── КН-12.json
│   └── ...
├── teachers/        # Розклад викладачів (derived from groups)
│   ├── Самотій_Т.С..json
│   ├── Капран_І.Д..json
│   └── ...
├── classrooms/      # Розклад аудиторій (derived from groups)
│   ├── а12б.json
│   ├── а4.json
│   └── ...
└── entities.json    # Реєстр усіх сутностей (groups, teachers, classrooms)
```

### entities.json

A flat registry of every group, teacher and classroom:

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable identifier — **always** matches the schedule filename it points to (`classrooms/а12б.json` → id `а12б`, `teachers/Самотій_Т.С..json` → id `Самотій_Т.С.`). Classrooms: dots stripped, spaces → `_`. Teachers: spaces → `_`. Groups: unchanged. |
| `type` | string | `group`, `teacher`, or `location` (used for classrooms) |
| `title` | string | Human-readable name exactly as written in the source schedule (e.g. `а.12б`, `а.1 к.3`, `Самотій Т.С.`) |
| `subtitle` | string \| null | Reserved, currently always `null` |
| `department` | string \| null | Institute (`ННІ …`). For teachers and classrooms that teach / take place in several institutes, the institute with the most lessons is used (ties broken alphabetically). `null` only when no lesson carries an institute. |

## Schedule Format

Each schedule file contains an array of days:

```json
[
  {
    "dayOfWeek": "monday",
    "weekNumber": 1,
    "lessons": [
      {
        "order": 2,
        "starting_at": "10:20",
        "ending_at": "11:50",
        "half_pair": null,
        "title": "Алгоритмізація та програмування",
        "type": "лабораторна",
        "teachers": ["Самотій Т.С."],
        "group": "КН-11-1",
        "classroom": "а.12б",
        "link": null,
        "link_comment": null,
        "replacement": null,
        "description": null
      },
      {
        "order": 3,
        "starting_at": "12:10",
        "ending_at": "13:40",
        "half_pair": null,
        "title": "Дискретна математика",
        "type": "лекція",
        "teachers": ["Капран І.Д."],
        "group": null,
        "classroom": "а.6",
        "link": null,
        "link_comment": null,
        "replacement": null,
        "description": null
      }
    ]
  }
]
```

### Fields

| Field | Type | Description |
|---|---|---|
| `dayOfWeek` | string | `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday` |
| `weekNumber` | 1 \| 2 | 1 = чисельник (numerator), 2 = знаменник (denominator) |
| `order` | number | Lesson order: 1=08:30, 2=10:20, 3=12:10, 4=14:00, 5=15:50, 6=17:40 |
| `starting_at` | string | Start time, `HH:MM` |
| `ending_at` | string | End time, `HH:MM` (duration = 90 min) |
| `title` | string | Subject name |
| `type` | string | `лекція`, `лабораторна`, or `практичне` |
| `teachers` | string[] \| null | Teacher name(s), null if unknown |
| `group` | string \| null | See [Group field semantics](#group-field-semantics) |
| `classroom` | string \| null | Classroom identifier (e.g. `а.12б`, `а.Б к.1`) |
| `link` | string \| null | Online lesson URL |
| `link_comment` | string \| null | Link description |
| `replacement` | string \| null | Replacement info |
| `description` | string \| null | Additional notes |

### Group field semantics

The `group` field has different semantics depending on the schedule type:

**Group schedules** (`output/groups/`):
- `group` = subgroup name (e.g. `"КН-11-1"`) when the lesson is for a specific subgroup
- `group` = `null` when the lesson is shared by all subgroups of the group

**Teacher and classroom schedules** (`output/teachers/`, `output/classrooms/`):
- `group` = subgroup name (e.g. `"КН-11-1"`) when the lesson is for a specific subgroup
- `group` = group name (e.g. `"КН-11"`) when the lesson is shared by all subgroups
- `group` is **never null** — it always identifies which group of students the lesson is for

### Multiple teachers

When a lesson has multiple teachers (e.g. in standard format: `(Дуда Н.М., Захарчин Н.Г.)`), the `teachers` array contains all of them:

```json
"teachers": ["Дуда Н.М.", "Захарчин Н.Г."]
```

### Deduplication

When the same lecture is shared across subgroups of a group (e.g. КН-11-1 and КН-11-2 attend the same lecture), it appears **once** in the group schedule with `group: null`. In teacher/classroom schedules, it also appears once with `group` set to the group name.

Lessons from **different groups** (e.g. КН-11 and КН-12) are kept as separate entries, each with its own group name.

## Supported Institutes

- НДІ ГІФПМ
- НВО САЙНЕРСІ
- ННІ ГІФПМ

## License

MIT
