(function () {
  'use strict';
  var key = 'ximeng-appearance';
  var root = document.documentElement;
  var theme = 'night';
  try { if (localStorage.getItem(key) === 'day') theme = 'day'; } catch (_) {}
  root.dataset.theme = theme;
  function updateButton() {
    var button = document.getElementById('themeToggle');
    if (!button) return;
    var day = root.dataset.theme === 'day';
    button.textContent = day ? '☾ 夜晚' : '☀ 白天';
    button.setAttribute('aria-label', day ? '切换为夜晚背景' : '切换为白天背景');
    button.title = day ? '当前为白天模式' : '当前为夜晚模式';
  }
  document.addEventListener('DOMContentLoaded', function () {
    updateButton();
    document.getElementById('themeToggle').addEventListener('click', function () {
      root.dataset.theme = root.dataset.theme === 'day' ? 'night' : 'day';
      try { localStorage.setItem(key, root.dataset.theme); } catch (_) {}
      updateButton();
    });
  });
  window.addEventListener('storage', function (event) {
    if (event.key === key) { root.dataset.theme = event.newValue === 'day' ? 'day' : 'night'; updateButton(); }
  });
  document.addEventListener('visibilitychange', function () { root.classList.toggle('background-paused', document.hidden); });
})();
