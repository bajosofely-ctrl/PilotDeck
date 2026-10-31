// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('ui/education/ai-lessons/js/main.js', 'utf8');
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
});
function openFixture(edition, lesson = true) {
  window.history.replaceState(null, '', `/${edition}/${lesson ? 'lessons/lesson1.html' : 'index.html'}`);
  document.body.innerHTML = lesson
    ? `<div class="quiz" data-quiz-id="${edition === 'lab-10' ? 'lab1' : 'lesson1'}"><div class="quiz-question" data-correct="B"><button class="quiz-option" data-value="B">Correct</button><div class="quiz-explanation hidden"></div></div><div class="quiz-result hidden"></div></div>`
    : '<div class="lesson-card" data-lesson="lesson1"><span class="lesson-status hidden"><span class="zh"></span></span></div>';
  window.eval(source);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}
afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });

it('shows lab quiz completion on its matching directory card', () => {
  openFixture('lab-10');
  document.querySelector('.quiz-option').click();
  openFixture('lab-10', false);
  expect(document.querySelector('.lesson-status').classList.contains('hidden')).toBe(false);
});

it('keeps progress independent between course editions', () => {
  openFixture('standard-5');
  document.querySelector('.quiz-option').click();
  expect(localStorage.getItem('ai-class-progress:standard-5')).toContain('"completed":true');
  openFixture('standard-15', false);
  expect(document.querySelector('.lesson-status').classList.contains('hidden')).toBe(true);
});

it('renders saved completion when an edition omits the status placeholder', () => {
  localStorage.setItem('ai-class-progress:standard-15', JSON.stringify({
    lesson1: { completed: true, quizScore: 3, quizTotal: 3 },
  }));
  window.history.replaceState(null, '', '/standard-15/index.html');
  document.body.innerHTML = '<div class="lesson-card" data-lesson="lesson1"><a class="lesson-btn">Start</a></div>';
  window.eval(source);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(document.querySelector('.lesson-status .zh').textContent).toContain('已完成 (3/3)');
});

it('matches App Studio cards to their lesson filename', () => {
  localStorage.setItem('ai-class-progress:app-inventor-10', JSON.stringify({
    lesson1: { completed: true, quizScore: 2, quizTotal: 2 },
  }));
  window.history.replaceState(null, '', '/app-inventor-10/index.html');
  document.body.innerHTML = '<div class="lesson-card" data-lesson="app1"><a class="lesson-btn" href="lessons/lesson1.html">Start</a></div>';
  window.eval(source);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(document.querySelector('.lesson-status .zh').textContent).toContain('已完成 (2/2)');
});
