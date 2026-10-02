const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const PLACEHOLDER_IMAGE =
  "https://placehold.co/500x750/171719/ff4d4d?text=Sem+poster";
const STORAGE_KEYS = {
  theme: "valifilmes.theme",
};

const app = document.getElementById("app");
const movieCache = new Map();
let currentUser = null;
let demoMode = false;
let authInitialized = false;
let userData = {
  profile: { name: "Nome de usuário", bio: "Apaixonado por cinema", avatar: "" },
  favorites: [],
  reviews: [],
  hasTmdbKey: false,
};
let homeMovies = { trending: [], nowPlaying: [] };
let selectedReviewMovie = null;
let selectedRating = 0;
let toastTimeout;

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const readStore = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Não foi possível ler os dados locais (${key}).`, error);
    return fallback;
  }
};

const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Não foi possível salvar os dados locais (${key}).`, error);
    showToast("Não foi possível salvar. Verifique o espaço disponível no navegador.");
    return false;
  }
};

const apiRequest = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentUser) {
      currentUser = null;
      userData = { profile: { name: "Nome de usuário", bio: "", avatar: "" }, favorites: [], reviews: [] };
      location.hash = "#login";
    }
    const error = new Error(payload.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    throw error;
  }
  return payload;
};

const getFavorites = () => userData.favorites.slice(0, 4);

const getReviews = () => userData.reviews;

const getProfile = () => userData.profile;

const normalizeMovie = (movie) => ({
  id: movie.id,
  title: movie.title || movie.name || "Filme sem título",
  overview: movie.overview || "",
  poster_path: movie.poster_path || "",
  vote_average: Number(movie.vote_average) || 0,
  release_date: movie.release_date || "",
});

const rememberMovies = (movies) => {
  movies.forEach((movie) => {
    const normalized = normalizeMovie(movie);
    if (normalized.id != null) movieCache.set(String(normalized.id), normalized);
  });
};

const fetchTmdb = async (endpoint, params = {}) => {
  const url = new URL(`/api/tmdb${endpoint}`, location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return apiRequest(`${url.pathname}${url.search}`);
};

const posterUrl = (movie) =>
  movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : PLACEHOLDER_IMAGE;

const getInitials = (name) =>
  String(name || "VF")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();

const isFavorite = (movieId) =>
  getFavorites().some((movie) => String(movie.id) === String(movieId));

const movieCard = (rawMovie, { compact = false, showOverview = false } = {}) => {
  const movie = normalizeMovie(rawMovie);
  rememberMovies([movie]);
  const favorite = isFavorite(movie.id);
  const overview = movie.overview || "Sinopse indisponível.";
  return `
    <article class="movie-card${compact ? " movie-card-compact" : ""}">
      <div class="movie-poster">
        <img src="${escapeHTML(posterUrl(movie))}" alt="Pôster de ${escapeHTML(movie.title)}" loading="lazy" />
        <button class="favorite-toggle${favorite ? " is-favorite" : ""}" type="button"
          data-action="favorite" data-movie-id="${escapeHTML(movie.id)}"
          aria-label="${favorite ? "Remover dos" : "Adicionar aos"} favoritos" aria-pressed="${favorite}">
          ♥
        </button>
        <button class="poster-rate" type="button" data-action="rate" data-movie-id="${escapeHTML(movie.id)}">
          Avaliar
        </button>
      </div>
      <div class="movie-card-footer">
        <h3>${escapeHTML(movie.title)}</h3>
        <p class="movie-meta">
          <span class="rating-mark">★</span> ${movie.vote_average ? movie.vote_average.toFixed(1) : "—"}
          ${movie.release_date ? `<span>${escapeHTML(movie.release_date.slice(0, 4))}</span>` : ""}
        </p>
        ${showOverview ? `<p class="movie-overview">${escapeHTML(overview)}</p>` : ""}
      </div>
    </article>
  `;
};

const reviewMovieOption = (rawMovie) => {
  const movie = normalizeMovie(rawMovie);
  rememberMovies([movie]);
  return `
    <button class="review-movie-option" type="button" data-action="choose-movie" data-movie-id="${escapeHTML(movie.id)}">
      <img src="${escapeHTML(posterUrl(movie))}" alt="" />
      <span>${escapeHTML(movie.title)}</span>
    </button>
  `;
};

const emptyState = (title, copy, action = "") => `
  <div class="empty-state">
    <span class="empty-state-icon" aria-hidden="true">✦</span>
    <h2>${escapeHTML(title)}</h2>
    <p>${escapeHTML(copy)}</p>
    ${action}
  </div>
`;

const pageHeading = (eyebrow, title, description = "") => `
  <div class="page-heading">
    <p class="eyebrow">${escapeHTML(eyebrow)}</p>
    <h1>${escapeHTML(title)}</h1>
    ${description ? `<p class="page-description">${escapeHTML(description)}</p>` : ""}
  </div>
`;

const bottomReviewButton = () => currentUser ? `
  <a class="bottom-review-button" href="#review" aria-label="Avaliar um filme" title="Avaliar um filme">+</a>
` : "";

const setPage = (content, route) => {
  const demoNotice = demoMode
    ? '<aside class="demo-notice"><span>Modo de demonstração</span> Dados deste navegador são compartilhados nesta instância local. <a href="#settings">Configurar chave TMDB</a></aside>'
    : "";
  app.innerHTML = `${demoNotice}${content}${bottomReviewButton()}`;
  app.focus({ preventScroll: true });
  document.querySelectorAll(".nav-links [data-route-link], .logout-link, #navSearchForm").forEach((item) => {
    item.hidden = !currentUser || (demoMode && item.classList.contains("logout-link"));
  });
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    const active = link.dataset.routeLink === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const navbar = document.getElementById("mainNavigation");
  if (navbar?.classList.contains("show") && window.bootstrap) {
    window.bootstrap.Collapse.getOrCreateInstance(navbar).hide();
  }
}

const renderHome = () => {
  const recentReviews = getReviews().slice(0, 5);
  const reviewsMarkup = recentReviews.length
    ? recentReviews
        .map((review) => {
          const movie = review.movie || {};
          const profile = getProfile();
          return `
            <article class="review-preview">
              <div class="avatar avatar-small">${escapeHTML(getInitials(profile.name))}</div>
              <div class="review-preview-content">
                <div class="review-preview-heading">
                  <strong>${escapeHTML(movie.title || "Filme")}</strong>
                  <span class="rating-mark">${"★".repeat(Number(review.rating) || 0)}</span>
                </div>
                <p>${escapeHTML(review.text || "Sem comentário.")}</p>
              </div>
            </article>
          `;
        })
        .join("")
    : emptyState(
        "Suas avaliações começam aqui",
        "Escolha um filme e conte para a comunidade o que achou.",
        '<a class="text-action" href="#review">Escrever avaliação <span aria-hidden="true">→</span></a>',
      );

  setPage(
    `
      <section class="home-hero">
        <div class="hero-copy">
          <p class="eyebrow">SEU PRÓXIMO FILME FAVORITO</p>
          <h1>Histórias que merecem<br /><span>ser compartilhadas.</span></h1>
          <p>Descubra, avalie e guarde os filmes que fazem parte da sua história.</p>
          <a class="primary-button" href="#review">Avaliar um filme <span aria-hidden="true">＋</span></a>
        </div>
        <div class="hero-decoration" aria-hidden="true"><span>VF</span></div>
      </section>
      <section class="content-section">
        <div class="section-heading"><div><p class="eyebrow">O QUE ESTÁ EM ALTA</p><h2>Em alta</h2></div>
          <a class="text-action" href="#search">Ver mais <span aria-hidden="true">→</span></a></div>
        <div class="carousel-shell">
          <button class="carousel-arrow carousel-arrow-left" type="button" data-action="scroll-row" data-target="trendingMovies" data-direction="-1" aria-label="Filmes anteriores">‹</button>
          <div id="trendingMovies" class="movie-row"><p class="loading-state">Carregando filmes...</p></div>
          <button class="carousel-arrow carousel-arrow-right" type="button" data-action="scroll-row" data-target="trendingMovies" data-direction="1" aria-label="Próximos filmes">›</button>
        </div>
      </section>
      <section class="content-section">
        <div class="section-heading"><div><p class="eyebrow">ESTREIAS RECENTES</p><h2>Novos</h2></div>
          <a class="text-action" href="#search">Ver mais <span aria-hidden="true">→</span></a></div>
        <div class="carousel-shell">
          <button class="carousel-arrow carousel-arrow-left" type="button" data-action="scroll-row" data-target="newMovies" data-direction="-1" aria-label="Filmes anteriores">‹</button>
          <div id="newMovies" class="movie-row"><p class="loading-state">Carregando filmes...</p></div>
          <button class="carousel-arrow carousel-arrow-right" type="button" data-action="scroll-row" data-target="newMovies" data-direction="1" aria-label="Próximos filmes">›</button>
        </div>
      </section>
      <section class="content-section community-section">
        <div class="section-heading"><div><p class="eyebrow">DA COMUNIDADE</p><h2>Reviews em alta</h2></div>
          <a class="text-action" href="#activity">Ver atividade <span aria-hidden="true">→</span></a></div>
        <div class="review-preview-list">${reviewsMarkup}</div>
      </section>
    `,
    "home",
  );

  loadHomeMovies();
};

const loadHomeMovies = async () => {
  try {
    const [trending, nowPlaying] = await Promise.all([
      fetchTmdb("/trending/movie/week", { language: "pt-BR" }),
      fetchTmdb("/movie/now_playing", { language: "pt-BR", page: 1 }),
    ]);
    homeMovies = {
      trending: Array.isArray(trending.results) ? trending.results : [],
      nowPlaying: Array.isArray(nowPlaying.results) ? nowPlaying.results : [],
    };
    rememberMovies([...homeMovies.trending, ...homeMovies.nowPlaying]);
    const trendingContainer = document.getElementById("trendingMovies");
    const newContainer = document.getElementById("newMovies");
    if (trendingContainer) {
      trendingContainer.innerHTML = homeMovies.trending.length
        ? homeMovies.trending.map((movie) => movieCard(movie, { compact: true })).join("")
        : emptyState("Nenhum filme encontrado", "Tente novamente mais tarde.");
    }
    if (newContainer) {
      newContainer.innerHTML = homeMovies.nowPlaying.length
        ? homeMovies.nowPlaying.map((movie) => movieCard(movie, { compact: true })).join("")
        : emptyState("Nenhum lançamento encontrado", "Tente novamente mais tarde.");
    }
  } catch (error) {
    console.error(error);
    ["trendingMovies", "newMovies"].forEach((id) => {
      const container = document.getElementById(id);
      if (container) {
        container.innerHTML =
          '<p class="error-state">Não foi possível carregar os filmes agora. Tente novamente mais tarde.</p>';
      }
    });
  }
};

const renderFavorites = () => {
  const favorites = getFavorites();
  const cards = favorites.map((movie) => movieCard(movie)).join("");
  const addCard = `
    <a class="add-movie-card" href="#search">
      <span class="add-movie-icon" aria-hidden="true">+</span>
      <strong>Adicionar filme</strong>
    </a>
  `;
  setPage(
    `
      ${pageHeading("SUA COLEÇÃO", `Favoritos (${favorites.length} de 4)`, "Os filmes que você quer guardar sempre por perto.")}
      <section class="favorite-grid" aria-label="Seus filmes favoritos">
        ${cards}${favorites.length < 4 ? addCard : ""}
      </section>
      <section class="favorite-note"><span aria-hidden="true">♥</span><p>Você pode escolher até 4 filmes para sua lista de favoritos.</p></section>
    `,
    "favorites",
  );
};

const renderActivity = () => {
  const reviews = getReviews();
  const content = reviews.length
    ? `<div class="activity-grid">${reviews
        .map((review) => {
          const movie = review.movie || {};
          return `
            <article class="activity-card">
              <img src="${escapeHTML(posterUrl(movie))}" alt="Pôster de ${escapeHTML(movie.title || "filme")}" loading="lazy" />
              <div class="activity-card-footer">
                <div class="activity-card-title"><span class="eyebrow">VOCÊ AVALIOU</span><span class="rating-mark">${"★".repeat(Number(review.rating) || 0)}</span></div>
                <h2>${escapeHTML(movie.title || "Filme")}</h2>
                <p>${escapeHTML(review.text || "Sem comentário.")}</p>
                <time datetime="${escapeHTML(review.createdAt || "")}">${escapeHTML(
                  review.createdAt ? new Date(review.createdAt).toLocaleDateString("pt-BR") : "",
                )}</time>
              </div>
            </article>
          `;
        })
        .join("")}</div>`
    : emptyState(
        "Sua atividade está vazia",
        "As avaliações que você escrever aparecerão aqui.",
        '<a class="primary-button" href="#review">Avaliar um filme <span aria-hidden="true">＋</span></a>',
      );
  setPage(
    `${pageHeading("SEU HISTÓRICO", "Atividade", "Um registro dos filmes que você assistiu e avaliou.")}<section class="content-section activity-section"><div class="section-heading"><div><p class="eyebrow">SEUS FILMES</p><h2>Histórico</h2></div><span class="count-label">${reviews.length} ${reviews.length === 1 ? "avaliação" : "avaliações"}</span></div>${content}</section>`,
    "activity",
  );
};

const renderSearch = (query = "") => {
  setPage(
    `
      ${pageHeading("EXPLORE O CATÁLOGO", query ? `Pesquisa: “${query}”` : "Pesquisar filmes", "Encontre seu próximo filme para assistir ou avaliar.")}
      <form class="page-search-form" id="pageSearchForm" role="search">
        <label class="visually-hidden" for="pageSearchInput">Nome do filme</label>
        <input id="pageSearchInput" name="query" type="search" placeholder="Digite o nome de um filme..." value="${escapeHTML(query)}" required />
        <button class="primary-button" type="submit">Pesquisar <span aria-hidden="true">⌕</span></button>
      </form>
      <section id="searchResults" class="search-results" aria-live="polite">
        ${query ? '<p class="loading-state">Buscando filmes...</p>' : emptyState("O que vamos assistir?", "Digite o nome de um filme para ver os resultados.")}
      </section>
    `,
    "search",
  );
  const navInput = document.getElementById("navSearchInput");
  if (navInput) navInput.value = query;
  if (query) searchMovies(query);
};

const searchMovies = async (query, targetId = "searchResults") => {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = '<p class="loading-state">Buscando filmes...</p>';
  try {
    const response = await fetchTmdb("/search/movie", {
      language: "pt-BR",
      include_adult: "false",
      query,
    });
    const movies = Array.isArray(response.results) ? response.results : [];
    rememberMovies(movies);
    target.innerHTML = movies.length
      ? targetId === "reviewMovieResults"
        ? movies.map(reviewMovieOption).join("")
        : `<div class="search-grid">${movies.map((movie) => movieCard(movie, { showOverview: true })).join("")}</div>`
      : emptyState("Nenhum resultado encontrado", "Tente buscar por outro nome.");
  } catch (error) {
    console.error(error);
    target.innerHTML =
      '<p class="error-state">Não foi possível fazer a busca. Verifique sua conexão e tente novamente.</p>';
  }
};

const renderRatingStars = () =>
  `<div class="rating-picker" role="radiogroup" aria-label="Sua nota">` +
  [1, 2, 3, 4, 5]
    .map(
      (rating) => `
        <button class="rating-star${rating <= selectedRating ? " selected" : ""}" type="button"
          data-action="select-rating" data-rating="${rating}" role="radio"
          aria-checked="${rating === selectedRating}" aria-label="${rating} ${rating === 1 ? "estrela" : "estrelas"}">★</button>
      `,
    )
    .join("") +
  `</div>`;

const renderReview = () => {
  const selectedMarkup = selectedReviewMovie
    ? `
      <div class="selected-movie">
        <img src="${escapeHTML(posterUrl(selectedReviewMovie))}" alt="Pôster de ${escapeHTML(selectedReviewMovie.title)}" />
        <div><p class="eyebrow">FILME ESCOLHIDO</p><h2>${escapeHTML(selectedReviewMovie.title)}</h2><p>${escapeHTML(selectedReviewMovie.overview || "Sinopse indisponível.")}</p></div>
        <button type="button" class="subtle-button" data-action="clear-review-movie">Trocar filme</button>
      </div>
    `
    : `
      <div class="review-movie-search">
        <label for="reviewMovieSearch">Escolha um filme para avaliar</label>
        <form id="reviewMovieSearchForm">
          <input id="reviewMovieSearch" name="query" type="search" placeholder="Digite o nome do filme..." required />
          <button class="primary-button" type="submit">Buscar</button>
        </form>
        <div id="reviewMovieResults" class="review-movie-results">
          ${
            homeMovies.trending.length
              ? homeMovies.trending
                  .slice(0, 6)
                  .map(reviewMovieOption)
                  .join("")
              : '<p class="loading-state">Carregando sugestões...</p>'
          }
        </div>
      </div>
    `;

  setPage(
    `
      ${pageHeading("COMPARTILHE SUA OPINIÃO", "Avaliar filme", "Escolha um título, dê sua nota e conte o que achou.")}
      <section class="review-layout">
        <div class="review-selection">${selectedMarkup}</div>
        <form id="reviewForm" class="review-form">
          <div class="review-form-heading"><div><p class="eyebrow">SUA NOTA</p><h2>${selectedReviewMovie ? escapeHTML(selectedReviewMovie.title) : "Sua avaliação"}</h2></div><span class="rating-hint">${selectedRating ? `${selectedRating}/5` : "Toque para avaliar"}</span></div>
          ${renderRatingStars()}
          <label for="reviewText">Sua opinião</label>
          <textarea id="reviewText" name="text" rows="6" maxlength="1000" placeholder="O que esse filme fez você sentir?">${escapeHTML(
            selectedReviewMovie
              ? getReviews().find((review) => String(review.movie?.id) === String(selectedReviewMovie.id))?.text || ""
              : "",
          )}</textarea>
          <button class="primary-button save-review-button" type="submit">Salvar avaliação</button>
        </form>
      </section>
    `,
    "review",
  );
  if (!selectedReviewMovie && !homeMovies.trending.length) loadReviewSuggestions();
};

const loadReviewSuggestions = async () => {
  try {
    const response = await fetchTmdb("/trending/movie/week", { language: "pt-BR" });
    const movies = Array.isArray(response.results) ? response.results.slice(0, 6) : [];
    rememberMovies(movies);
    const results = document.getElementById("reviewMovieResults");
    if (results) {
      results.innerHTML = movies.length
        ? movies.map(reviewMovieOption).join("")
        : '<p class="error-state">Nenhum filme disponível no momento.</p>';
    }
  } catch (error) {
    console.error(error);
    const results = document.getElementById("reviewMovieResults");
    if (results) results.innerHTML = '<p class="error-state">Não foi possível carregar sugestões.</p>';
  }
};

const renderProfile = () => {
  const profile = getProfile();
  const favorites = getFavorites();
  const reviews = getReviews();
  const avatarMarkup = profile.avatar
    ? `<img src="${escapeHTML(profile.avatar)}" alt="Foto de perfil de ${escapeHTML(profile.name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span hidden>${escapeHTML(getInitials(profile.name))}</span>`
    : `<span>${escapeHTML(getInitials(profile.name))}</span>`;
  const favoriteMarkup = favorites.length
    ? `<div class="profile-movie-grid">${favorites.map((movie) => movieCard(movie, { compact: true })).join("")}</div>`
    : emptyState("Nenhum favorito por enquanto", "Adicione até quatro filmes à sua coleção.", '<a class="text-action" href="#search">Explorar filmes <span aria-hidden="true">→</span></a>');
  const recentMarkup = reviews.length
    ? `<div class="profile-movie-grid">${reviews.slice(0, 4).map((review) => movieCard(review.movie || {}, { compact: true })).join("")}</div>`
    : emptyState("Ainda sem avaliações", "Seus filmes avaliados aparecerão aqui.", '<a class="text-action" href="#review">Avaliar um filme <span aria-hidden="true">→</span></a>');

  setPage(
    `
      <section class="profile-header">
        <div class="profile-avatar">${avatarMarkup}</div>
        <div class="profile-identity"><p class="eyebrow">SEU ESPAÇO NO VALIFILMES</p><h1>${escapeHTML(profile.name)}</h1><p>${escapeHTML(profile.bio)}</p><span>${reviews.length} avaliações <i aria-hidden="true">·</i> ${favorites.length} favoritos</span></div>
        <a class="outline-button" href="#settings">Editar perfil</a>
      </section>
      <section class="content-section profile-section"><div class="section-heading"><div><p class="eyebrow">SUA COLEÇÃO</p><h2>Favoritos</h2></div><a class="text-action" href="#favorites">Ver todos <span aria-hidden="true">→</span></a></div>${favoriteMarkup}</section>
      <section class="content-section profile-section"><div class="section-heading"><div><p class="eyebrow">SEU HISTÓRICO</p><h2>Recentes</h2></div><a class="text-action" href="#activity">Ver atividade <span aria-hidden="true">→</span></a></div>${recentMarkup}</section>
    `,
    "profile",
  );
};

const renderSettings = () => {
  const profile = getProfile();
  const currentTheme = readStore(STORAGE_KEYS.theme, "dark");
  setPage(
    `
      ${pageHeading("PREFERÊNCIAS", "Configurações", "Personalize seu perfil e sua experiência no ValiFilmes.")}
      <div class="settings-grid">
        <section class="settings-card">
          <p class="eyebrow">SUA CONTA</p><h2>Editar perfil</h2>
          <form id="profileForm" class="settings-form">
            <label for="profileName">Nome de usuário</label><input id="profileName" name="name" maxlength="40" value="${escapeHTML(profile.name)}" required />
            <label for="profileBio">Bio</label><textarea id="profileBio" name="bio" maxlength="180" rows="3">${escapeHTML(profile.bio)}</textarea>
            <label for="profileAvatar">Foto de perfil (URL)</label><input id="profileAvatar" name="avatar" type="url" value="${escapeHTML(profile.avatar)}" placeholder="https://..." />
            <button class="primary-button" type="submit">Salvar perfil</button>
          </form>
        </section>
        <section class="settings-card">
          <p class="eyebrow">APARÊNCIA</p><h2>Tema</h2>
          <div class="theme-options" role="group" aria-label="Escolha o tema">
            <button class="theme-option${currentTheme === "dark" ? " selected" : ""}" type="button" data-action="set-theme" data-theme="dark" aria-pressed="${currentTheme === "dark"}"><span class="theme-swatch dark-swatch" aria-hidden="true"></span><span>Escuro</span></button>
            <button class="theme-option${currentTheme === "light" ? " selected" : ""}" type="button" data-action="set-theme" data-theme="light" aria-pressed="${currentTheme === "light"}"><span class="theme-swatch light-swatch" aria-hidden="true"></span><span>Claro</span></button>
          </div>
        </section>
        <section class="settings-card">
          <p class="eyebrow">INTEGRAÇÃO COM TMDB</p><h2>Chave API</h2>
          <p class="settings-copy">${userData.hasTmdbKey ? "Sua chave está salva com segurança e nunca é enviada ao navegador." : "Adicione sua API Key v3 para carregar filmes. Ela será salva criptografada no SQLite."}</p>
          <form id="apiKeyForm" class="settings-form">
            <label for="tmdbApiKey">Nova API Key v3</label>
            <input id="tmdbApiKey" name="apiKey" type="password" inputmode="text" minlength="32" maxlength="32" autocomplete="new-password" placeholder="32 caracteres" required />
            <button class="primary-button" type="submit">${userData.hasTmdbKey ? "Trocar chave" : "Salvar chave"}</button>
          </form>
          <a class="text-action tutorial-link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Como conseguir uma chave TMDB <span aria-hidden="true">↗</span></a>
        </section>
        <section class="settings-card">
          <p class="eyebrow">CONTRIBUA</p><h2>Filme faltando?</h2>
          <p class="settings-copy">Avise a gente sobre um filme que ainda não encontrou no catálogo.</p>
          <form id="suggestionForm" class="suggestion-form"><label class="visually-hidden" for="suggestionTitle">Nome do filme</label><input id="suggestionTitle" name="title" placeholder="Nome do filme" required /><button class="primary-button" type="submit">Adicionar</button></form>
        </section>
      </div>
    `,
    "settings",
  );
};

const renderAuthPage = (route, message = "") => {
  const isRegister = route === "register";
  setPage(
    `
      <section class="auth-layout">
        <div class="auth-panel">
          <a class="auth-brand" href="#home"><img src="assets/logo.png" alt="" /><span>VALI<span>FILMES</span></span></a>
          <p class="eyebrow">${isRegister ? "CRIE SUA CONTA" : "BEM-VINDO DE VOLTA"}</p>
          <h1>${isRegister ? "Seu lugar no cinema." : "Entre no ValiFilmes."}</h1>
          <p class="auth-copy">${isRegister ? "Crie seu perfil, avalie filmes e compartilhe o que você assiste." : "Faça login para acessar suas avaliações, favoritos e seu perfil."}</p>
          <form id="${isRegister ? "registerForm" : "loginForm"}" class="auth-form">
            <label for="authEmail">Email</label>
            <input id="authEmail" name="email" type="email" autocomplete="email" maxlength="254" placeholder="voce@email.com" required />
            <label for="authPassword">Senha</label>
            <input id="authPassword" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" maxlength="200" placeholder="Pelo menos 8 caracteres" required />
            ${
              isRegister
                ? `<label for="authApiKey">Sua API Key v3 do TMDB</label>
                   <input id="authApiKey" name="apiKey" type="password" inputmode="text" autocomplete="off" minlength="32" maxlength="32" placeholder="32 caracteres" required />
                   <p class="auth-key-note">Sua chave é validada, criptografada e guardada no servidor. Ela nunca aparece no navegador.</p>
                   <details class="tmdb-tutorial">
                     <summary>Como conseguir sua chave grátis</summary>
                     <ol>
                       <li><a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer">Crie uma conta no TMDB</a>.</li>
                       <li>Abra <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Configurações → API</a>.</li>
                       <li>Solicite uma chave API e preencha os dados do aplicativo.</li>
                       <li>Copie a <strong>API Key (v3 auth)</strong> — não o Read Access Token — e cole acima.</li>
                     </ol>
                   </details>`
                : ""
            }
            <p id="authError" class="auth-error" role="alert">${escapeHTML(message)}</p>
            <button class="primary-button auth-submit" type="submit">${isRegister ? "Criar conta" : "Entrar"}</button>
          </form>
          <p class="auth-switch">${isRegister ? "Já tem uma conta?" : "Ainda não tem conta?"} <a href="#${isRegister ? "login" : "register"}">${isRegister ? "Fazer login" : "Criar conta"}</a></p>
        </div>
        <aside class="auth-art" aria-hidden="true"><span class="auth-art-mark">VF</span><p>Descubra.<br />Avalie.<br /><strong>Compartilhe.</strong></p></aside>
      </section>
    `,
    route,
  );
};

const loadUserData = async () => {
  const data = await apiRequest("/api/user/data");
  userData = {
    profile: { name: "Nome de usuário", bio: "Apaixonado por cinema", avatar: "", ...data.profile },
    favorites: Array.isArray(data.favorites) ? data.favorites : [],
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    hasTmdbKey: Boolean(data.hasTmdbKey),
  };
  rememberMovies([
    ...userData.favorites,
    ...userData.reviews.map((review) => review.movie).filter(Boolean),
  ]);
};

const showAuthError = (message) => {
  const error = document.getElementById("authError");
  if (error) error.textContent = message;
};

const parseRoute = () => {
  const raw = location.hash.replace(/^#/, "");
  const [path, queryString = ""] = raw.split("?");
  const route = path || "home";
  const query = new URLSearchParams(queryString).get("q") || "";
  return { route, query };
};

const renderRoute = () => {
  if (!authInitialized) {
    app.innerHTML = '<section class="startup-state"><span class="startup-spinner" aria-hidden="true"></span><p>Preparando sua sessão de demonstração...</p></section>';
    return;
  }
  const { route, query } = parseRoute();
  if (route === "login" || route === "register") {
    if (currentUser) {
      location.hash = "#home";
      return;
    }
    renderAuthPage(route);
    return;
  }
  if (!currentUser) {
    if (route !== "login") {
      location.hash = "#login";
      return;
    }
    renderAuthPage("login");
    return;
  }
  switch (route) {
    case "favorites":
      renderFavorites();
      break;
    case "activity":
      renderActivity();
      break;
    case "search":
      renderSearch(query);
      break;
    case "review":
      renderReview();
      break;
    case "profile":
      renderProfile();
      break;
    case "settings":
      renderSettings();
      break;
    case "home":
    default:
      renderHome();
      break;
  }
};

const showToast = (message) => {
  const region = document.getElementById("toastRegion");
  if (!region) return;
  region.textContent = message;
  region.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => region.classList.remove("visible"), 2600);
};

const toggleFavorite = async (movie) => {
  const favorites = getFavorites();
  const existingIndex = favorites.findIndex((item) => String(item.id) === String(movie.id));
  if (existingIndex >= 0) {
    favorites.splice(existingIndex, 1);
  } else if (favorites.length >= 4) {
    showToast("Sua lista já tem 4 favoritos. Remova um para adicionar outro.");
    return;
  } else {
    favorites.push(normalizeMovie(movie));
  }
  const previousFavorites = userData.favorites;
  userData.favorites = favorites;
  renderRoute();
  try {
    const result = await apiRequest("/api/user/favorites", {
      method: "PUT",
      body: JSON.stringify({ favorites }),
    });
    userData.favorites = result.favorites;
    showToast(
      existingIndex >= 0
        ? `${movie.title} removido dos favoritos.`
        : `${movie.title} adicionado aos favoritos.`,
    );
    renderRoute();
  } catch (error) {
    userData.favorites = previousFavorites;
    showToast(error.message);
    renderRoute();
  }
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, movieId } = button.dataset;
  if (action === "logout") {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error(error);
    }
    currentUser = null;
    userData = {
      profile: { name: "Nome de usuário", bio: "", avatar: "" },
      favorites: [],
      reviews: [],
      hasTmdbKey: false,
    };
    selectedReviewMovie = null;
    selectedRating = 0;
    location.hash = "#login";
    renderRoute();
  } else if (action === "scroll-row") {
    const row = document.getElementById(button.dataset.target);
    if (row) {
      row.scrollBy({
        left: row.clientWidth * 0.82 * Number(button.dataset.direction),
        behavior: "smooth",
      });
    }
  } else if (action === "retry-startup") {
    app.innerHTML = '<section class="startup-state"><span class="startup-spinner" aria-hidden="true"></span><p>Preparando sua sessão de demonstração...</p></section>';
    initializeApp();
  } else if (action === "favorite") {
    const movie = movieCache.get(String(movieId));
    if (movie) toggleFavorite(movie);
  } else if (action === "rate") {
    selectedReviewMovie = movieCache.get(String(movieId)) || null;
    selectedRating = 0;
    location.hash = "#review";
  } else if (action === "choose-movie") {
    selectedReviewMovie = movieCache.get(String(movieId)) || null;
    selectedRating = 0;
    renderReview();
  } else if (action === "clear-review-movie") {
    selectedReviewMovie = null;
    selectedRating = 0;
    renderReview();
  } else if (action === "select-rating") {
    selectedRating = Number(button.dataset.rating);
    renderReview();
  } else if (action === "set-theme") {
    const theme = button.dataset.theme === "light" ? "light" : "dark";
    if (!writeStore(STORAGE_KEYS.theme, theme)) return;
    document.body.dataset.theme = theme;
    renderSettings();
    showToast(`Tema ${theme === "light" ? "claro" : "escuro"} ativado.`);
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  if (form.id === "navSearchForm" || form.id === "pageSearchForm") {
    const query = new FormData(form).get("query");
    const inputQuery = String(query || "").trim();
    if (inputQuery) location.hash = `#search?q=${encodeURIComponent(inputQuery)}`;
  } else if (form.id === "reviewMovieSearchForm") {
    const query = String(new FormData(form).get("query") || "").trim();
    if (query) searchMovies(query, "reviewMovieResults");
  } else if (form.id === "reviewForm") {
    const text = String(new FormData(form).get("text") || "").trim();
    if (!selectedReviewMovie) {
      showToast("Escolha um filme antes de salvar sua avaliação.");
      return;
    }
    if (!selectedRating) {
      showToast("Selecione uma nota de 1 a 5 estrelas.");
      return;
    }
    try {
      await apiRequest("/api/user/reviews", {
        method: "POST",
        body: JSON.stringify({
          movie: normalizeMovie(selectedReviewMovie),
          rating: selectedRating,
          text,
        }),
      });
      await loadUserData();
    } catch (error) {
      showToast(error.message);
      return;
    }
    showToast("Sua avaliação foi salva.");
    selectedReviewMovie = null;
    selectedRating = 0;
    location.hash = "#activity";
  } else if (form.id === "profileForm") {
    const data = new FormData(form);
    const profile = {
      name: String(data.get("name") || "").trim(),
      bio: String(data.get("bio") || "").trim(),
      avatar: String(data.get("avatar") || "").trim(),
    };
    try {
      const result = await apiRequest("/api/user/profile", {
        method: "PATCH",
        body: JSON.stringify(profile),
      });
      userData.profile = result.profile;
    } catch (error) {
      showToast(error.message);
      return;
    }
    showToast("Perfil atualizado.");
    location.hash = "#profile";
  } else if (form.id === "apiKeyForm") {
    const apiKey = String(new FormData(form).get("apiKey") || "").trim();
    try {
      await apiRequest("/api/user/api-key", {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      userData.hasTmdbKey = true;
      form.reset();
      showToast("Chave TMDB atualizada e criptografada.");
      renderSettings();
    } catch (error) {
      showToast(error.message);
    }
  } else if (form.id === "suggestionForm") {
    const title = String(new FormData(form).get("title") || "").trim();
    if (!title) return;
    try {
      await apiRequest("/api/user/suggestions", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      form.reset();
      showToast("Obrigado pela sugestão!");
    } catch (error) {
      showToast(error.message);
    }
  } else if (form.id === "registerForm" || form.id === "loginForm") {
    const data = new FormData(form);
    const isRegister = form.id === "registerForm";
    try {
      const result = await apiRequest(
        isRegister ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
            ...(isRegister ? { apiKey: data.get("apiKey") } : {}),
          }),
        },
      );
      currentUser = result.user;
      await loadUserData();
      location.hash = "#home";
      renderRoute();
    } catch (error) {
      showAuthError(error.message);
    }
  }
});

window.addEventListener("hashchange", renderRoute);
document.body.dataset.theme = readStore(STORAGE_KEYS.theme, "dark");
const initializeApp = async () => {
  try {
    const config = await apiRequest("/api/config");
    demoMode = Boolean(config.demoMode);
    if (demoMode) {
      currentUser = { email: "demo@local.invalid" };
    } else {
      const result = await apiRequest("/api/auth/me");
      currentUser = result.user;
    }
    await loadUserData();
    authInitialized = true;
    if (parseRoute().route === "login" || parseRoute().route === "register") {
      location.hash = "#home";
    }
    renderRoute();
  } catch (error) {
    if (error.status !== 401) console.error("Não foi possível inicializar o ValiFilmes.", error);
    currentUser = null;
    demoMode = false;
    const route = parseRoute().route;
    if (error.status === 401 && !demoMode) {
      authInitialized = true;
      if (route !== "login" && route !== "register") location.hash = "#login";
      renderRoute();
      return;
    }
    authInitialized = true;
    app.innerHTML = `
      <section class="startup-error">
        <p class="eyebrow">NÃO FOI POSSÍVEL CONECTAR</p>
        <h1>O modo de demonstração não iniciou.</h1>
        <p>Inicie o servidor com <code>npm start</code> e confira se <code>DEMO_MODE=true</code> está no arquivo <code>.env</code>.</p>
        <button class="primary-button" type="button" data-action="retry-startup">Tentar novamente</button>
      </section>`;
  }
};
initializeApp();
