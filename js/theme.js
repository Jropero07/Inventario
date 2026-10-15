/* Tema claro / oscuro: sigue al navegador por defecto y el botón permite elegir manualmente.
   Si la elección coincide con la del navegador, se vuelve al modo automático. */
(function () {
  var KEY = "invti_theme";
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function systemTheme() { return media && media.matches ? "dark" : "light"; }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { return saved() || systemTheme(); }
  function apply(theme) {
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    var label = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    var icon = theme === "dark" ? "fa-sun" : "fa-moon";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.title = label; b.setAttribute("aria-label", label);
      var i = b.querySelector("i"); if (i) i.className = "fa-solid " + icon;
      var s = b.querySelector(".theme-label"); if (s) s.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
    });
  }
  function toggle() {
    var next = current() === "dark" ? "light" : "dark";
    try { if (next === systemTheme()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  }
  apply(current());
  if (media) {
    var onChange = function () { if (!saved()) apply(systemTheme()); };
    if (media.addEventListener) media.addEventListener("change", onChange); else if (media.addListener) media.addListener(onChange);
  }
  document.addEventListener("DOMContentLoaded", function () {
    apply(current());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) { b.addEventListener("click", toggle); });
  });
})();
