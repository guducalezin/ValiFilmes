const token = "529da9acd613eb56ba170b16e863f9d2";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

const buildMovieCard = (movie) => {
  const title = movie.title || "Filme sem título";
  const overview = movie.overview || "Sinopse indisponível.";
  const rating = movie.vote_average
    ? `⭐ ${Number(movie.vote_average).toFixed(1)}`
    : "⭐ Sem avaliação";
  const poster = movie.poster_path
    ? `${IMAGE_BASE_URL}${movie.poster_path}`
    : "https://placehold.co/500x750/1b1b22/ffffff?text=Sem+poster";
  return `
      <article class="card movie-card">
        <img src="${poster}" alt="${title}"/>
        <div class="card-body">
          <h5 class="nome-filme">${title}</h5>
          <p class="desc-filme">${overview}</p>
          <p class="aval-filme">${rating}</p>
        </div>
      </article>
    `;
};
const renderMovies = (containerId, movies) => {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  const safeMovies = Array.isArray(movies) ? movies : [];

  container.innerHTML = safeMovies.map(buildMovieCard).join("");;
};
const fetchTmdb = async (endpoint, params = {}) => {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  url.searchParams.set("api_key", token);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao carregar dados: ${response.status}`);
  }

  return response.json();
};
const loadFeaturedMovies = async () => {
  try {
    const trending = await fetchTmdb("/trending/movie/week", {
      language: "pt-BR",
    });
    const newMovies = await fetchTmdb("/movie/now_playing", {
      language: "pt-BR",
      page: 1,
    });

    renderMovies("emAlta", trending.results || []);
    renderMovies("novos", newMovies.results || []);
  } catch (error) {
    const fallback = [
      {
        title: "Filme em destaque",
        overview: "Não foi possível carregar os filmes em alta no momento.",
        vote_average: 0.0,
        poster_path: "/8UlWHLMpgZm9bx6QYh0NFoq67TZ.jpg",
      },
    ];

    renderMovies("emAlta", fallback);
    renderMovies("novos", fallback);
    console.error(error);
  }

  
};

loadFeaturedMovies();

const addNavigation = (containerId, leftBtnClass, rightBtnClass) => {
  const container = document.getElementById(containerId);
  const leftBtn = document.querySelector(`.${leftBtnClass}`);
  const rightBtn = document.querySelector(`.${rightBtnClass}`);

  leftBtn.addEventListener("click", () => {
    container.scrollBy({ left: -1860, behavior: "smooth" });
  });

  rightBtn.addEventListener("click", () => {
    container.scrollBy({ left: 1860, behavior: "smooth" });
  });
};

// Adiciona a navegação para "Em Alta"
addNavigation("emAlta", "emAlta-left", "emAlta-right");

// Adiciona a navegação para "Novos"
addNavigation("novos", "novos-left", "novos-right");