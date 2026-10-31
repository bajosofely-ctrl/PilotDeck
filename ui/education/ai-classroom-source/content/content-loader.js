// Import all content modules
import { tutorialHowTo } from './tutorial-how-to.js';
import { intro } from './intro.js';
import { lesson1 } from './lesson-1.js';
import { exercises1, exerciseHints as hints1 } from './exercises-1.js';
import { lesson2 } from './lesson-2.js';
import { exercises2, exerciseHints2 as hints2 } from './exercises-2.js';
import { lesson3 } from './lesson-3.js';
import { exercises3, exerciseHints3 as hints3 } from './exercises-3.js';
import { lesson4 } from './lesson-4.js';
import { exercises4, exerciseHints4 as hints4 } from './exercises-4.js';
import { lesson5 } from './lesson-5.js';
import { exercises5, exerciseHints5 as hints5 } from './exercises-5.js';
import { lesson6 } from './lesson-6.js';
import { exercises6, exerciseHints6 as hints6 } from './exercises-6.js';
import { lesson7 } from './lesson-7.js';
import { exercises7, exerciseHints7 as hints7 } from './exercises-7.js';

// Combine all content sections
export const tutorialContent = {
    'tutorial-how-to': tutorialHowTo,
    'intro': intro,
    'lesson-1': lesson1,
    'exercises-1': exercises1,
    'lesson-2': lesson2,
    'exercises-2': exercises2,
    'lesson-3': lesson3,
    'exercises-3': exercises3,
    'lesson-4': lesson4,
    'exercises-4': exercises4,
    'lesson-5': lesson5,
    'exercises-5': exercises5,
    'lesson-6': lesson6,
    'exercises-6': exercises6,
    'lesson-7': lesson7,
    'exercises-7': exercises7
};

// Combine all exercise hints
export const exerciseHints = {
    ...hints1,
    ...hints2,
    ...hints3,
    ...hints4,
    ...hints5,
    ...hints6,
    ...hints7
};

// Content navigation order
export const contentOrder = [
    'tutorial-how-to',
    'intro', 
    'lesson-1',
    'exercises-1',
    'lesson-2',
    'exercises-2',
    'lesson-3',
    'exercises-3',
    'lesson-4',
    'exercises-4',
    'lesson-5',
    'exercises-5',
    'lesson-6',
    'exercises-6',
    'lesson-7',
    'exercises-7'
]; 
