/* ============================================================
   AI 探索之旅 / AI Explorer — Global JavaScript
   Spec: SPEC.md v1.2
   ============================================================ */

(function () {
  'use strict';

  /* ---- 0. Constants -------------------------------------- */
  const STORAGE_KEYS = {
    theme: 'ai-class-theme',
    lang: 'ai-class-lang',
    progress: 'ai-class-progress:' + (location.pathname.split('/')[1] || 'portal'),
  };

  /* ---- 1. Theme (Dark / Light) --------------------------- */
  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);

    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem(STORAGE_KEYS.theme, next);
      });
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      var sunIcon = btn.querySelector('.icon-sun');
      var moonIcon = btn.querySelector('.icon-moon');
      if (sunIcon && moonIcon) {
        sunIcon.style.display = theme === 'dark' ? 'none' : 'block';
        moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
      }
    });
  }

  /* ---- 2. Language (zh / en) ----------------------------- */
  function initLang() {
    var saved = localStorage.getItem(STORAGE_KEYS.lang) || 'zh';
    applyLang(saved);

    document.querySelectorAll('.lang-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-lang');
        var next = current === 'zh' ? 'en' : 'zh';
        applyLang(next);
        localStorage.setItem(STORAGE_KEYS.lang, next);
      });
    });
  }

  function applyLang(lang) {
    document.documentElement.setAttribute('data-lang', lang);
  }

  /* ---- 3. Progress (localStorage) ------------------------ */
  function getProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.progress)) || {};
    } catch (_) {
      return {};
    }
  }

  function saveProgress(data) {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(data));
  }

  function markLessonQuiz(lessonId, score, total) {
    // Use filenames because upstream quiz and card IDs differ by edition.
    var lesson = location.pathname.match(/\/lessons\/(lesson\d+)\.html$/);
    if (lesson) lessonId = lesson[1];
    var p = getProgress();
    if (!p[lessonId]) p[lessonId] = {};
    p[lessonId].quizScore = score;
    p[lessonId].quizTotal = total;
    p[lessonId].completed = true;
    saveProgress(p);
    updateProgressUI();
  }

  function updateProgressUI() {
    var p = getProgress();
    document.querySelectorAll('.lesson-card').forEach(function (card) {
      var id = card.getAttribute('data-lesson');
      var link = card.querySelector('a[href*="lessons/lesson"]');
      var lesson = link && link.getAttribute('href').match(/(?:^|\/)(lesson\d+)\.html$/);
      if (lesson) id = lesson[1];
      if (p[id] && p[id].completed) {
        var status = card.querySelector('.lesson-status');
        if (!status) {
          status = document.createElement('span');
          status.className = 'lesson-status';
          ['zh', 'en'].forEach(function (lang) {
            var label = document.createElement('span');
            label.className = lang;
            status.appendChild(label);
          });
          card.insertBefore(status, card.querySelector('.lesson-btn'));
        }
        if (status) {
          var zhText = status.querySelector('.zh');
          var enText = status.querySelector('.en');
          if (zhText) zhText.textContent = '✓ 已完成 (' + p[id].quizScore + '/' + p[id].quizTotal + ')';
          if (enText) enText.textContent = '✓ Done (' + p[id].quizScore + '/' + p[id].quizTotal + ')';
          status.classList.remove('hidden');
        }
      }
    });
  }

  /* ---- 4. Quiz Component --------------------------------- */
  function initQuizzes() {
    document.querySelectorAll('.quiz').forEach(function (quiz) {
      var quizId = quiz.getAttribute('data-quiz-id');
      var questions = quiz.querySelectorAll('.quiz-question');
      var totalQ = questions.length;
      var answered = 0;
      var correctCount = 0;
      var submitted = false;

      /* Create submit button */
      var submitBtn = document.createElement('button');
      submitBtn.className = 'quiz-submit-btn hidden';
      submitBtn.innerHTML =
        '<span class="zh">提交测验</span>' +
        '<span class="en">Submit Quiz</span>';
      var resultEl = quiz.querySelector('.quiz-result');
      if (resultEl) {
        quiz.insertBefore(submitBtn, resultEl);
      } else {
        quiz.appendChild(submitBtn);
      }

      submitBtn.addEventListener('click', function () {
        if (submitted) return;
        submitted = true;
        var unanswered = totalQ - answered;

        /* Mark unanswered questions as skipped */
        questions.forEach(function (q) {
          var opts = q.querySelectorAll('.quiz-option');
          var alreadyAnswered = false;
          opts.forEach(function (o) {
            if (o.classList.contains('disabled')) alreadyAnswered = true;
          });
          if (!alreadyAnswered) {
            var correctVal = q.getAttribute('data-correct');
            opts.forEach(function (o) {
              o.classList.add('disabled');
              if (o.getAttribute('data-value') === correctVal) {
                o.classList.add('show-correct');
              }
            });
            var explanation = q.querySelector('.quiz-explanation');
            if (explanation) explanation.classList.remove('hidden');
          }
        });

        submitBtn.classList.add('hidden');
        showQuizResult(quiz, correctCount, totalQ, unanswered);
        if (quizId) markLessonQuiz(quizId, correctCount, totalQ);
      });

      questions.forEach(function (q) {
        var correctVal = q.getAttribute('data-correct');
        var options = q.querySelectorAll('.quiz-option');
        var explanation = q.querySelector('.quiz-explanation');

        options.forEach(function (opt) {
          opt.addEventListener('click', function () {
            if (opt.classList.contains('disabled') || submitted) return;

            var chosen = opt.getAttribute('data-value');
            var isCorrect = chosen === correctVal;
            answered++;

            if (isCorrect) {
              correctCount++;
              opt.classList.add('correct');
            } else {
              opt.classList.add('wrong');
              options.forEach(function (o) {
                if (o.getAttribute('data-value') === correctVal) {
                  o.classList.add('show-correct');
                }
              });
            }

            options.forEach(function (o) { o.classList.add('disabled'); });

            if (explanation) {
              explanation.classList.remove('hidden');
            }

            /* Show submit button once at least one question is answered */
            if (!submitted) {
              submitBtn.classList.remove('hidden');
            }

            if (answered === totalQ) {
              submitted = true;
              submitBtn.classList.add('hidden');
              showQuizResult(quiz, correctCount, totalQ, 0);
              if (quizId) markLessonQuiz(quizId, correctCount, totalQ);
            }
          });
        });
      });
    });
  }

  function showQuizResult(quiz, score, total, unanswered) {
    var result = quiz.querySelector('.quiz-result');
    if (!result) return;

    var pct = total > 0 ? Math.round((score / total) * 100) : 0;
    var perfect = score === total;
    var low = pct < 60;
    unanswered = unanswered || 0;

    /* Build result content dynamically */
    var html = '';

    /* Unanswered warning */
    if (unanswered > 0) {
      html +=
        '<p class="quiz-unanswered-warning">' +
          '<span class="zh">你有 ' + unanswered + ' 道题未作答，未作答的题目按错误计分。</span>' +
          '<span class="en">You have ' + unanswered + ' unanswered question' + (unanswered > 1 ? 's' : '') + '. Unanswered questions are counted as incorrect.</span>' +
        '</p>';
    }

    html +=
      '<p class="score">' +
        '<span class="zh">你答对了 <span class="quiz-score">' + score + '</span> / <span class="quiz-total">' + total + '</span> 题！</span>' +
        '<span class="en">You got <span class="quiz-score">' + score + '</span> / <span class="quiz-total">' + total + '</span> correct!</span>' +
      '</p>' +
      '<p class="quiz-accuracy">' +
        '<span class="zh">正确率：' + pct + '%</span>' +
        '<span class="en">Accuracy: ' + pct + '%</span>' +
      '</p>' +
      '<p class="quiz-feedback' + (perfect ? ' feedback-perfect' : low ? ' feedback-low' : '') + '">' +
        (perfect
          ? '<span class="zh">太棒了！全部答对，你已经完全掌握了这节课的内容！</span>' +
            '<span class="en">Excellent! Perfect score — you\'ve fully mastered this lesson!</span>'
          : low
            ? '<span class="zh">正确率较低，建议重新学习本课内容后再试一次哦！</span>' +
              '<span class="en">Your score is a bit low. We suggest reviewing this lesson and trying again!</span>'
            : '<span class="zh">完成测验！继续学习下一课吧。</span>' +
              '<span class="en">Quiz complete! Continue to the next lesson.</span>') +
      '</p>';

    result.innerHTML = html;
    result.classList.remove('hidden');
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---- 5. Decision Tree ---------------------------------- */
  function initDecisionTrees() {
    document.querySelectorAll('.decision-tree').forEach(function (tree) {
      var pathList = [];

      tree.querySelectorAll('.tree-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var currentNode = btn.closest('.tree-node');
          var nextId = btn.getAttribute('data-next');
          var nextNode = tree.querySelector('[data-node-id="' + nextId + '"]');

          var question = currentNode.querySelector('.tree-question');
          if (question) {
            var qText = question.textContent.trim();
            var aText = btn.textContent.trim();
            pathList.push(qText + ' → ' + aText);
          }

          currentNode.classList.remove('active');
          if (nextNode) {
            nextNode.classList.add('active');
            if (nextNode.classList.contains('tree-leaf')) {
              showTreePath(tree, pathList);
            }
          }
        });
      });

      tree.querySelectorAll('.tree-restart').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pathList = [];
          tree.querySelectorAll('.tree-node').forEach(function (n) { n.classList.remove('active'); });
          tree.querySelector('[data-node-id="root"]').classList.add('active');
          var pathEl = tree.querySelector('.tree-path');
          if (pathEl) pathEl.classList.add('hidden');
        });
      });
    });
  }

  function showTreePath(tree, path) {
    var pathEl = tree.querySelector('.tree-path');
    if (!pathEl) return;
    pathEl.textContent = path.join(' → ');
    pathEl.classList.remove('hidden');
  }

  /* ---- 6. AI or Human ------------------------------------ */
  function initAIorHuman() {
    document.querySelectorAll('.ai-or-human').forEach(function (game) {
      var items = game.querySelectorAll('.aoh-item');
      var totalItems = items.length;
      var answered = 0;
      var correct = 0;

      items.forEach(function (item) {
        var answer = item.getAttribute('data-answer');
        var buttons = item.querySelectorAll('.aoh-btn');
        var reveal = item.querySelector('.aoh-reveal');

        buttons.forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (btn.classList.contains('disabled')) return;

            var choice = btn.getAttribute('data-choice');
            var isCorrect = choice === answer;
            answered++;

            if (isCorrect) {
              correct++;
              btn.classList.add('selected-correct');
            } else {
              btn.classList.add('selected-wrong');
              buttons.forEach(function (b) {
                if (b.getAttribute('data-choice') === answer) {
                  b.classList.add('selected-correct');
                }
              });
            }

            buttons.forEach(function (b) { b.classList.add('disabled'); });
            if (reveal) reveal.classList.remove('hidden');

            if (answered === totalItems) {
              var scoreEl = game.querySelector('.aoh-score');
              if (scoreEl) {
                var zhScore = scoreEl.querySelector('.zh');
                var enScore = scoreEl.querySelector('.en');
                if (zhScore) zhScore.textContent = '你答对了 ' + correct + ' / ' + totalItems + ' 题！';
                if (enScore) enScore.textContent = 'You got ' + correct + ' / ' + totalItems + ' correct!';
                scoreEl.classList.remove('hidden');
              }
            }
          });
        });
      });
    });
  }

  /* ---- 7. Prompt Challenge ------------------------------- */
  function initPromptChallenge() {
    document.querySelectorAll('.pc-reveal-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var challenge = btn.closest('.prompt-challenge');
        var ref = challenge.querySelector('.pc-reference');
        if (ref) {
          ref.classList.toggle('hidden');
          var lang = document.documentElement.getAttribute('data-lang') || 'zh';
          if (ref.classList.contains('hidden')) {
            btn.querySelector('.zh').textContent = '查看参考答案';
            btn.querySelector('.en').textContent = 'Show Reference';
          } else {
            btn.querySelector('.zh').textContent = '收起参考答案';
            btn.querySelector('.en').textContent = 'Hide Reference';
          }
        }
      });
    });
  }

  /* ---- 8. Expandable Cards ------------------------------- */
  function initExpandableCards() {
    document.querySelectorAll('.expandable-card').forEach(function (card) {
      var header = card.querySelector('.ec-header');
      if (!header) return;
      function toggle() {
        var isOpen = card.classList.toggle('open');
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  /* ---- 9. Code Copy -------------------------------------- */
  function initCodeCopy() {
    document.querySelectorAll('.code-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var block = btn.closest('.code-block');
        var code = block.querySelector('code');
        if (!code) return;
        var text = code.textContent;
        var copy = navigator.clipboard
          ? navigator.clipboard.writeText(text)
          : Promise.reject(new Error('Clipboard unavailable'));
        copy.then(function () {
          var zhEl = btn.querySelector('.zh');
          var enEl = btn.querySelector('.en');
          if (zhEl) zhEl.textContent = '已复制';
          if (enEl) enEl.textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(function () {
            if (zhEl) zhEl.textContent = '复制';
            if (enEl) enEl.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(function () {
          var selection = window.getSelection();
          var range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          var zhEl = btn.querySelector('.zh');
          var enEl = btn.querySelector('.en');
          if (zhEl) zhEl.textContent = '已选中代码';
          if (enEl) enEl.textContent = 'Code selected';
        });
      });
    });
  }

  /* ---- 10. Scroll Reveal (IntersectionObserver) ---------- */
  function initScrollReveal() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal, .timeline-item').forEach(function (el) {
        el.classList.add('visible');
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal, .reveal-stagger, .timeline-item').forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ---- 11. Mobile Nav ------------------------------------ */
  function initMobileNav() {
    document.querySelectorAll('.nav-hamburger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nav = btn.closest('.nav');
        var lessons = nav.querySelector('.nav-lessons');
        if (lessons) lessons.classList.toggle('open');
      });
    });
  }

  /* ---- 12. Timeline Detail Toggle ------------------------ */
  function initTimeline() {
    document.querySelectorAll('.timeline-card').forEach(function (card) {
      function toggle() {
        var detail = card.querySelector('.timeline-detail');
        if (detail) detail.classList.toggle('hidden');
      }
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  /* ---- Boot ---------------------------------------------- */
  function init() {
    initTheme();
    initLang();
    initQuizzes();
    initDecisionTrees();
    initAIorHuman();
    initPromptChallenge();
    initExpandableCards();
    initCodeCopy();
    initScrollReveal();
    initMobileNav();
    initTimeline();
    updateProgressUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
