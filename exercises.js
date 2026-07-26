/* Built-in exercise library. `id` values are stable — history references them. */
const EXERCISE_LIBRARY = [
  // Chest
  { id: 'bench-press',        name: 'Barbell Bench Press',   muscle: 'Chest' },
  { id: 'incline-bench',      name: 'Incline Bench Press',   muscle: 'Chest' },
  { id: 'chest-press',        name: 'Chest Press (Machine)', muscle: 'Chest' },
  { id: 'db-bench',           name: 'Dumbbell Bench Press',  muscle: 'Chest' },
  { id: 'cable-fly',          name: 'Cable Fly',             muscle: 'Chest' },
  { id: 'push-up',            name: 'Push-Up',               muscle: 'Chest' },
  { id: 'dip',                name: 'Chest Dip',             muscle: 'Chest' },

  // Back
  { id: 'deadlift',           name: 'Deadlift',              muscle: 'Back' },
  { id: 'barbell-row',        name: 'Barbell Row',           muscle: 'Back' },
  { id: 'db-row',             name: 'Dumbbell Row',          muscle: 'Back' },
  { id: 'lat-pulldown',       name: 'Lat Pulldown',          muscle: 'Back' },
  { id: 'pull-up',            name: 'Pull-Up',               muscle: 'Back' },
  { id: 'seated-row',         name: 'Seated Cable Row',      muscle: 'Back' },
  { id: 'face-pull',          name: 'Face Pull',             muscle: 'Back' },

  // Legs
  { id: 'squat',              name: 'Back Squat',            muscle: 'Legs' },
  { id: 'front-squat',        name: 'Front Squat',           muscle: 'Legs' },
  { id: 'leg-press',          name: 'Leg Press',             muscle: 'Legs' },
  { id: 'romanian-deadlift',  name: 'Romanian Deadlift',     muscle: 'Legs' },
  { id: 'leg-extension',      name: 'Leg Extension',         muscle: 'Legs' },
  { id: 'leg-curl',           name: 'Leg Curl',              muscle: 'Legs' },
  { id: 'lunge',              name: 'Walking Lunge',         muscle: 'Legs' },
  { id: 'bulgarian-split',    name: 'Bulgarian Split Squat', muscle: 'Legs' },
  { id: 'hip-thrust',         name: 'Hip Thrust',            muscle: 'Legs' },
  { id: 'calf-raise',         name: 'Standing Calf Raise',   muscle: 'Legs' },

  // Shoulders
  { id: 'overhead-press',     name: 'Overhead Press',        muscle: 'Shoulders' },
  { id: 'db-shoulder-press',  name: 'Dumbbell Shoulder Press', muscle: 'Shoulders' },
  { id: 'lateral-raise',      name: 'Lateral Raise',         muscle: 'Shoulders' },
  { id: 'rear-delt-fly',      name: 'Rear Delt Fly',         muscle: 'Shoulders' },
  { id: 'upright-row',        name: 'Upright Row',           muscle: 'Shoulders' },
  { id: 'shrug',              name: 'Shrug',                 muscle: 'Shoulders' },

  // Arms
  { id: 'barbell-curl',       name: 'Barbell Curl',          muscle: 'Arms' },
  { id: 'db-curl',            name: 'Dumbbell Curl',         muscle: 'Arms' },
  { id: 'hammer-curl',        name: 'Hammer Curl',           muscle: 'Arms' },
  { id: 'preacher-curl',      name: 'Preacher Curl',         muscle: 'Arms' },
  { id: 'tricep-pushdown',    name: 'Tricep Pushdown',       muscle: 'Arms' },
  { id: 'skullcrusher',       name: 'Skullcrusher',          muscle: 'Arms' },
  { id: 'overhead-tricep',    name: 'Overhead Tricep Ext.',  muscle: 'Arms' },

  // Core
  { id: 'plank',              name: 'Plank',                 muscle: 'Core' },
  { id: 'hanging-leg-raise',  name: 'Hanging Leg Raise',     muscle: 'Core' },
  { id: 'cable-crunch',       name: 'Cable Crunch',          muscle: 'Core' },
  { id: 'ab-wheel',           name: 'Ab Wheel Rollout',      muscle: 'Core' },
  { id: 'russian-twist',      name: 'Russian Twist',         muscle: 'Core' },
];

const MUSCLE_ORDER = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Other'];
