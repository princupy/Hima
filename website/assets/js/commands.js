(function () {
  const root = document.querySelector("[data-command-app]");
  if (!root) return;

  const searchInput = root.querySelector("[data-search]");
  const categorySelect = root.querySelector("[data-category]");
  const premiumToggle = root.querySelector("[data-premium-toggle]");
  const chipWrap = root.querySelector("[data-category-chips]");
  const listWrap = root.querySelector("[data-command-list]");
  const countNode = root.querySelector("[data-count]");
  const pagerNode = root.querySelector("[data-page]");
  const prevBtn = root.querySelector("[data-prev]");
  const nextBtn = root.querySelector("[data-next]");

  const state = {
    all: [],
    categories: [],
    category: "all",
    query: "",
    premiumOnly: false,
    page: 1,
    pageSize: 10
  };

  function tierClass(value) {
    return String(value || "free").toLowerCase() === "premium" ? "premium" : "free";
  }

  function badgeLabel(value) {
    return tierClass(value) === "premium" ? "Premium" : "Free";
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function applyFilters() {
    const q = normalize(state.query);

    return state.all.filter(function (cmd) {
      const byCategory = state.category === "all" || cmd.category === state.category;
      const byPremium = !state.premiumOnly || tierClass(cmd.tier) === "premium";
      const haystack = [cmd.name, cmd.usage, cmd.description, (cmd.aliases || []).join(" ")]
        .map(normalize)
        .join(" | ");
      const byQuery = !q || haystack.includes(q);
      return byCategory && byPremium && byQuery;
    });
  }

  function commandHTML(cmd) {
    const aliases = cmd.aliases && cmd.aliases.length
      ? cmd.aliases.map(function (a) { return '<span>' + a + '</span>'; }).join("")
      : '<span>no aliases</span>';

    return [
      '<article class="command-card reveal is-visible">',
      '  <div class="command-head">',
      '    <h3 class="command-name">' + cmd.name + '</h3>',
      '    <span class="command-tier ' + tierClass(cmd.tier) + '">' + badgeLabel(cmd.tier) + '</span>',
      '  </div>',
      '  <p class="command-desc">' + cmd.description + '</p>',
      '  <div class="command-usage">' + cmd.usage + '</div>',
      '  <div class="command-tags">' + aliases + '</div>',
      '</article>'
    ].join("\n");
  }

  function renderChips() {
    if (!chipWrap) return;
    chipWrap.innerHTML = "";

    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.textContent = "All";
    allButton.className = state.category === "all" ? "active" : "";
    allButton.addEventListener("click", function () {
      state.category = "all";
      state.page = 1;
      categorySelect.value = "all";
      render();
    });
    chipWrap.appendChild(allButton);

    state.categories.forEach(function (cat) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = cat.label;
      if (state.category === cat.id) btn.classList.add("active");
      btn.addEventListener("click", function () {
        state.category = cat.id;
        state.page = 1;
        categorySelect.value = cat.id;
        render();
      });
      chipWrap.appendChild(btn);
    });
  }

  function render() {
    const filtered = applyFilters();
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;

    const start = (state.page - 1) * state.pageSize;
    const pageItems = filtered.slice(start, start + state.pageSize);

    listWrap.innerHTML = pageItems.length
      ? pageItems.map(commandHTML).join("\n")
      : '<div class="command-card"><p class="command-desc">No commands found for this filter.</p></div>';

    countNode.textContent = filtered.length + " command(s) matched";
    pagerNode.textContent = "Page " + state.page + " / " + totalPages;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;

    renderChips();
  }

  function fillCategorySelect() {
    categorySelect.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "All categories";
    categorySelect.appendChild(optAll);

    state.categories.forEach(function (cat) {
      const option = document.createElement("option");
      option.value = cat.id;
      option.textContent = cat.label;
      categorySelect.appendChild(option);
    });

    categorySelect.value = state.category;
  }

  function boot(data) {
    state.all = Array.isArray(data.commands) ? data.commands : [];
    state.categories = Array.isArray(data.categories) ? data.categories : [];

    fillCategorySelect();
    render();

    searchInput.addEventListener("input", function (e) {
      state.query = e.target.value || "";
      state.page = 1;
      render();
    });

    categorySelect.addEventListener("change", function (e) {
      state.category = e.target.value;
      state.page = 1;
      render();
    });

    premiumToggle.addEventListener("click", function () {
      state.premiumOnly = !state.premiumOnly;
      premiumToggle.classList.toggle("active", state.premiumOnly);
      premiumToggle.textContent = state.premiumOnly ? "Premium: ON" : "Premium Only";
      state.page = 1;
      render();
    });

    prevBtn.addEventListener("click", function () {
      if (state.page > 1) {
        state.page -= 1;
        render();
      }
    });

    nextBtn.addEventListener("click", function () {
      state.page += 1;
      render();
    });
  }

  fetch("assets/data/commands.json")
    .then(function (res) {
      return res.json();
    })
    .then(boot)
    .catch(function () {
      listWrap.innerHTML = '<div class="command-card"><p class="command-desc">Unable to load command catalog.</p></div>';
      countNode.textContent = "0 command(s) matched";
      pagerNode.textContent = "Page 1 / 1";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    });
})();
