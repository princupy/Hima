(function () {
  var THEME_KEY = "hima-theme";
  var root = document.documentElement;

  function getStoredTheme() {
    try {
      var value = localStorage.getItem(THEME_KEY);
      if (value === "dark" || value === "light") return value;
    } catch (err) {
      return null;
    }
    return null;
  }

  function getSystemTheme() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch (err) {
      return "light";
    }
    return "light";
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (err) {
      // Ignore storage errors.
    }
  }

  function paintThemeButton(theme) {
    var next = theme === "dark" ? "Light Mode" : "Dark Mode";
    document.querySelectorAll("[data-theme-label]").forEach(function (node) {
      node.textContent = next;
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-label", "Switch to " + next);
    });
  }

  function applyTheme(theme, persist) {
    var safe = theme === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", safe);
    paintThemeButton(safe);
    if (persist) setStoredTheme(safe);
  }

  var initialTheme = getStoredTheme() || getSystemTheme();
  applyTheme(initialTheme, false);

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
      var next = current === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  });

  var navToggle = document.querySelector("[data-nav-toggle]");
  var navLinks = document.querySelector("[data-nav-links]");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(navLinks.classList.contains("open")));
    });

    navLinks.querySelectorAll("a").forEach(function (anchor) {
      anchor.addEventListener("click", function () {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  var path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav-link]").forEach(function (link) {
    var href = link.getAttribute("href") || "";
    if (href === path || (path === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });

  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );

    reveals.forEach(function (node) {
      observer.observe(node);
    });
  } else {
    reveals.forEach(function (node) {
      node.classList.add("is-visible");
    });
  }

  var counters = document.querySelectorAll("[data-counter]");
  counters.forEach(function (counter) {
    var target = Number(counter.getAttribute("data-counter"));
    if (!Number.isFinite(target) || target <= 0) return;

    var current = 0;
    var step = Math.max(1, Math.round(target / 65));
    var tick = function () {
      current += step;
      if (current > target) current = target;
      counter.textContent = current.toLocaleString("en-US");
      if (current < target) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  });

  var yearNode = document.querySelector("[data-year]");
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());

  var rotator = document.querySelector("[data-rotate]");
  if (rotator) {
    var texts = (rotator.getAttribute("data-rotate") || "")
      .split("|")
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);

    if (texts.length > 1) {
      var i = 0;
      setInterval(function () {
        i = (i + 1) % texts.length;
        rotator.textContent = texts[i];
      }, 2200);
    }
  }
})();
