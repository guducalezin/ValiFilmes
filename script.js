const API_URL = "https://api.themoviedb.org/3";
const IMAGE_URL = "https://image.tmdb.org/t/p/w500";
const STORAGE_API = "api.php";

const app = document.querySelector("#app");
let filmes = [];
let filmeParaAvaliar = null;
let notaSelecionada = 0;
let modoCadastro = false;
let dados = dadosPadrao();

function dadosPadrao() {
  return {
    favoritos: [],
    avaliacoes: [],
    catalogo: [],
    perfil: { nome: "Visitante", bio: "Gosto de assistir filmes." },
    tema: "escuro",
    visualAtualizado: true,
    apiKey: ""
  };
}

async function carregarDados() {
  const resposta = await fetch(STORAGE_API);
  if (!resposta.ok) throw new Error("Não foi possível carregar os dados da sessão.");
  const salvo = await resposta.json();
  if (!salvo.authenticated) {
    dados = dadosPadrao();
    return;
  }
  const padrao = dadosPadrao();
  dados = {
    ...padrao,
    ...salvo,
    perfil: { ...padrao.perfil, ...(salvo && salvo.perfil) },
    catalogo: Array.isArray(salvo && salvo.catalogo) ? salvo.catalogo : [],
    favoritos: Array.isArray(salvo && salvo.favoritos) ? salvo.favoritos : [],
    avaliacoes: Array.isArray(salvo && salvo.avaliacoes) ? salvo.avaliacoes : [],
    tema: salvo && salvo.visualAtualizado ? salvo.tema : "escuro",
    apiKey: typeof (salvo && salvo.apiKey) === "string" ? salvo.apiKey : "",
    visualAtualizado: true
  };
}

async function salvarDados() {
  const resposta = await fetch(STORAGE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save", data: dados })
  });
  if (!resposta.ok) throw new Error("Não foi possível salvar os dados da sessão.");
}

async function limparChaveApi() {
  const resposta = await fetch(STORAGE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "logout" })
  });
  if (!resposta.ok) throw new Error("Não foi possível remover a chave da API.");
}

function chaveApi() {
  return dados.apiKey || "";
}

function escapar(texto) {
  return String(texto || "").replace(/[&<>"']/g, (letra) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[letra]);
}

function converterFilme(item) {
  return {
    id: item.id,
    title: item.title || "Filme sem título",
    year: item.release_date ? item.release_date.slice(0, 4) : "----",
    rating: Number(item.vote_average || 0).toFixed(1),
    poster: item.poster_path ? IMAGE_URL + item.poster_path : "",
    description: item.overview || "Sinopse não disponível."
  };
}

async function guardarFilmes(lista) {
  const existentes = new Map(dados.catalogo.map((filme) => [filme.id, filme]));
  lista.forEach((filme) => existentes.set(filme.id, filme));
  dados.catalogo = [...existentes.values()];
  await salvarDados();
}

async function consultarApi(endereco, parametros = {}) {
  const url = new URL(API_URL + endereco);
  url.searchParams.set("api_key", chaveApi());
  url.searchParams.set("language", "pt-BR");

  Object.entries(parametros).forEach(([nome, valor]) => {
    url.searchParams.set(nome, valor);
  });

  const resposta = await fetch(url);
  const resultado = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(resultado.status_message || "A API recusou a solicitação.");
  }
  return resultado;
}

async function validarChave(chave) {
  const url = new URL(API_URL + "/configuration");
  url.searchParams.set("api_key", chave);
  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error("Chave inválida. Use a API Key v3 do TMDB.");
  }
}

function favoritos() {
  return dados.favoritos.map((id) => dados.catalogo.find((filme) => filme.id === id)).filter(Boolean);
}

function cabecalho(titulo, texto) {
  return `
    <div class="cabecalho-pagina">
      <p>VALIFILMES</p>
      <h1>${escapar(titulo)}</h1>
      <span>${escapar(texto)}</span>
    </div>
  `;
}

function cartaoFilme(filme) {
  const salvo = dados.favoritos.includes(filme.id);
  const imagem = filme.poster || "https://placehold.co/500x750/eeeeee/333333?text=Sem+poster";
  return `
    <article class="filme">
      <img src="${imagem}" alt="Pôster de ${escapar(filme.title)}">
      <div class="filme-info">
        <h3>${escapar(filme.title)}</h3>
        <p>★ ${filme.rating} | ${filme.year}</p>
        <div class="acoes-filme">
          <button data-action="favorito" data-id="${filme.id}">${salvo ? "Remover" : "Favoritar"}</button>
          <button data-action="avaliar" data-id="${filme.id}">Avaliar</button>
        </div>
      </div>
    </article>
  `;
}

function mensagemErro(texto) {
  return `<div class="vazio"><h2>Não foi possível carregar</h2><p>${escapar(texto)}</p><button class="botao" data-action="recarregar">Tentar novamente</button></div>`;
}

function mostrar(mensagem) {
  const toast = document.querySelector("#toastRegion");
  toast.textContent = mensagem;
  toast.classList.add("visivel");
  setTimeout(() => toast.classList.remove("visivel"), 2500);
}

function renderLogin(mensagem = "") {
  app.innerHTML = `
    <section class="login">
      <img src="assets/logo.png" alt="">
      <p>VALIFILMES</p>
      <h1>${modoCadastro ? "Criar sua conta" : "Entrar no catálogo"}</h1>
      <p>${modoCadastro ? "Cadastre usuário, senha e sua API Key v3 do TMDB." : "Informe usuário, senha e API Key v3 do TMDB."}</p>
      <form id="loginForm" class="formulario-box">
        <label for="username">Usuário</label>
        <input id="username" name="username" type="text" minlength="3" maxlength="32" autocomplete="username" required>
        <label for="password">Senha</label>
        <input id="password" name="password" type="password" minlength="6" autocomplete="${modoCadastro ? "new-password" : "current-password"}" required>
        <label for="apiKey">API Key do TMDB</label>
        <input id="apiKey" name="apiKey" type="password" placeholder="Cole sua API Key v3" required>
        <button class="botao" type="submit">${modoCadastro ? "Cadastrar" : "Entrar"}</button>
        <small>Você encontra a chave em themoviedb.org/settings/api.</small>
        <button class="link-login" type="button" data-action="alternar-login">${modoCadastro ? "Já tenho uma conta" : "Criar uma conta"}</button>
        <strong class="erro">${escapar(mensagem)}</strong>
      </form>
    </section>
  `;
}

async function renderHome() {
  app.innerHTML = `

    <section class="secao">
      <div class="titulo-secao"><h2>Filmes populares</h2><a href="#search">Ver todos</a></div>
      <div class="carrossel">
        <button class="seta seta-esquerda" data-action="rolar" data-alvo="popularMovies" data-direcao="-1" aria-label="Filmes populares anteriores">&lt;</button>
        <div id="popularMovies" class="linha-filmes"><p>Carregando filmes...</p></div>
        <button class="seta seta-direita" data-action="rolar" data-alvo="popularMovies" data-direcao="1" aria-label="Próximos filmes populares">&gt;</button>
      </div>
    </section>
    <section class="secao">
      <div class="titulo-secao"><h2>Filmes novos</h2><a href="#search">Ver todos</a></div>
      <div class="carrossel">
        <button class="seta seta-esquerda" data-action="rolar" data-alvo="newMovies" data-direcao="-1" aria-label="Filmes novos anteriores">&lt;</button>
        <div id="newMovies" class="linha-filmes"><p>Carregando filmes...</p></div>
        <button class="seta seta-direita" data-action="rolar" data-alvo="newMovies" data-direcao="1" aria-label="Próximos filmes novos">&gt;</button>
      </div>
    </section>
    <section class="secao">
      <div class="titulo-secao"><h2>Minhas avaliações</h2><a href="#activity">Ver atividade</a></div>
      ${renderAvaliacoesCurtas()}
    </section>
  `;

  try {
    const [populares, novos] = await Promise.all([
      consultarApi("/movie/popular", { page: 1 }),
      consultarApi("/movie/now_playing", { page: 1 })
    ]);
    const filmesPopulares = populares.results.map(converterFilme);
    const filmesNovos = novos.results.map(converterFilme);
    filmes = [...filmesPopulares, ...filmesNovos];
    await guardarFilmes(filmes);
    const areaPopulares = document.querySelector("#popularMovies");
    const areaNovos = document.querySelector("#newMovies");
    if (areaPopulares) areaPopulares.innerHTML = filmesPopulares.map(cartaoFilme).join("");
    if (areaNovos) areaNovos.innerHTML = filmesNovos.map(cartaoFilme).join("");
  } catch (erro) {
    ["popularMovies", "newMovies"].forEach((id) => {
      const area = document.querySelector(`#${id}`);
      if (area) area.innerHTML = mensagemErro(erro.message);
    });
  }
}

function renderAvaliacoesCurtas() {
  if (!dados.avaliacoes.length) {
    return `<div class="vazio"><h2>Nenhuma avaliação ainda</h2><p>Escolha um filme e escreva o que achou.</p><a class="botao" href="#search">Buscar filme</a></div>`;
  }
  return `<div class="avaliacoes">${dados.avaliacoes.slice(0, 3).map((item) => `
    <div class="avaliacao"><strong>${escapar(item.filme.title)}</strong><span>${"★".repeat(item.nota)}</span><p>${escapar(item.texto || "Sem comentário.")}</p></div>
  `).join("")}</div>`;
}

function renderFavoritos() {
  const lista = favoritos();
  app.innerHTML = `
    ${cabecalho("Favoritos", "Até quatro filmes que você quer guardar.")}
    <section class="secao"><div class="lista-filmes">${lista.length ? lista.map(cartaoFilme).join("") : `<div class="vazio"><h2>Sua lista está vazia</h2><p>Adicione filmes pela busca.</p><a class="botao" href="#search">Buscar filmes</a></div>`}</div></section>
  `;
}

function renderAtividade() {
  app.innerHTML = `
    ${cabecalho("Atividade", "Suas avaliações salvas neste navegador.")}
    <section class="secao">${dados.avaliacoes.length ? `<div class="atividade">${dados.avaliacoes.map((item) => `
      <article class="atividade-item"><img src="${item.filme.poster || "https://placehold.co/500x750?text=Sem+poster"}" alt=""><div><h2>${escapar(item.filme.title)}</h2><p class="estrelas">${"★".repeat(item.nota)}</p><p>${escapar(item.texto || "Sem comentário.")}</p></div></article>
    `).join("")}</div>` : `<div class="vazio"><h2>Nenhuma avaliação</h2><p>As avaliações aparecerão aqui.</p><a class="botao" href="#search">Buscar filme</a></div>`}</section>
  `;
}

async function renderBusca(query = "") {
  app.innerHTML = `
    ${cabecalho("Pesquisar filmes", "Busque qualquer filme disponível no TMDB.")}
    <form id="pageSearchForm" class="busca-pagina"><input name="query" type="search" value="${escapar(query)}" placeholder="Digite o nome do filme" required><button class="botao" type="submit">Buscar</button></form>
    <section class="secao"><div id="searchResults" class="lista-filmes">${query ? "<p>Buscando filmes...</p>" : "<p>Digite um nome acima para pesquisar.</p>"}</div></section>
  `;
  if (!query) return;

  try {
    const resultado = await consultarApi("/search/movie", { query, page: 1, include_adult: "false" });
    filmes = resultado.results.map(converterFilme);
    await guardarFilmes(filmes);
    const area = document.querySelector("#searchResults");
    if (area) area.innerHTML = filmes.length ? filmes.map(cartaoFilme).join("") : "<p>Nenhum filme encontrado.</p>";
  } catch (erro) {
    const area = document.querySelector("#searchResults");
    if (area) area.innerHTML = mensagemErro(erro.message);
  }
}

function renderReview() {
  app.innerHTML = `
    ${cabecalho("Avaliar filme", "Escolha um título e escreva uma opinião.")}
    <section class="formulario-box">
      <label for="reviewMovie">Filme</label>
      <select id="reviewMovie"><option value="">Escolha um filme</option>${filmes.map((filme) => `<option value="${filme.id}" ${filmeParaAvaliar && filme.id === filmeParaAvaliar.id ? "selected" : ""}>${escapar(filme.title)}</option>`).join("")}</select>
      <label>Nota</label>
      <div class="estrelas escolha-estrelas">${[1, 2, 3, 4, 5].map((numero) => `<button type="button" data-action="nota" data-nota="${numero}" class="${numero <= notaSelecionada ? "selecionada" : ""}">★</button>`).join("")}</div>
      <label for="reviewText">Comentário</label>
      <textarea id="reviewText" rows="6" placeholder="O que você achou?"></textarea>
      <button class="botao" data-action="salvar-avaliacao">Salvar avaliação</button>
    </section>
  `;
}

function renderPerfil() {
  app.innerHTML = `
    ${cabecalho("Perfil", "Suas informações e seus filmes.")}
    <section class="perfil"><div class="avatar">${escapar(dados.perfil.nome.charAt(0).toUpperCase())}</div><div><h2>${escapar(dados.perfil.nome)}</h2><p>${escapar(dados.perfil.bio)}</p><p>${favoritos().length} favoritos | ${dados.avaliacoes.length} avaliações</p></div></section>
    <section class="secao"><div class="titulo-secao"><h2>Favoritos</h2><a href="#favorites">Ver todos</a></div><div class="lista-filmes">${favoritos().map(cartaoFilme).join("") || "<p>Você ainda não tem favoritos.</p>"}</div></section>
  `;
}

function renderConfiguracoes() {
  app.innerHTML = `
    ${cabecalho("Configurações", "Altere seu perfil, tema ou chave da API.")}
    <section class="formulario-box">
      <label for="profileName">Nome</label><input id="profileName" value="${escapar(dados.perfil.nome)}">
      <label for="profileBio">Bio</label><textarea id="profileBio" rows="4">${escapar(dados.perfil.bio)}</textarea>
      <button class="botao" data-action="salvar-perfil">Salvar perfil</button>
      <hr>
      <label for="theme">Tema</label><select id="theme"><option value="claro" ${dados.tema === "claro" ? "selected" : ""}>Claro</option><option value="escuro" ${dados.tema === "escuro" ? "selected" : ""}>Escuro</option></select>
      <button class="botao" data-action="salvar-tema">Salvar tema</button>
      <hr>
      <button class="botao" data-action="sair">Trocar chave da API</button>
    </section>
  `;
}

async function rota() {
  document.body.dataset.tema = dados.tema;
  if (!chaveApi()) {
    renderLogin();
    return;
  }

  const hash = location.hash.replace("#", "") || "home";
  const partes = hash.split("?");
  const parametros = new URLSearchParams(partes[1] || "");
  const nome = partes[0];
  if (nome === "favorites") renderFavoritos();
  else if (nome === "activity") renderAtividade();
  else if (nome === "search") renderBusca(parametros.get("q") || "");
  else if (nome === "review") {
    if (filmes.length) {
      renderReview();
    } else {
      app.innerHTML = "<p>Carregando filmes...</p>";
      try {
        const resultado = await consultarApi("/movie/popular", { page: 1 });
        filmes = resultado.results.map(converterFilme);
        await guardarFilmes(filmes);
        renderReview();
      } catch (erro) {
        app.innerHTML = mensagemErro(erro.message);
      }
    }
  }
  else if (nome === "profile") renderPerfil();
  else if (nome === "settings") renderConfiguracoes();
  else renderHome();
}

document.addEventListener("click", async (event) => {
  const botao = event.target.closest("[data-action]");
  if (!botao) return;
  const acao = botao.dataset.action;

  if (acao === "favorito") {
    const id = Number(botao.dataset.id);
    if (dados.favoritos.includes(id)) {
      dados.favoritos = dados.favoritos.filter((item) => item !== id);
      mostrar("Filme removido dos favoritos.");
    } else if (dados.favoritos.length < 4) {
      dados.favoritos.push(id);
      mostrar("Filme adicionado aos favoritos.");
    } else {
      mostrar("Você pode ter no máximo 4 favoritos.");
      return;
    }
    await salvarDados();
    rota();
  }

  if (acao === "avaliar") {
    filmeParaAvaliar = filmes.find((filme) => filme.id === Number(botao.dataset.id));
    notaSelecionada = 0;
    location.hash = "#review";
  }

  if (acao === "nota") {
    notaSelecionada = Number(botao.dataset.nota);
    renderReview();
  }

  if (acao === "salvar-avaliacao") {
    const filme = filmes.find((item) => item.id === Number(document.querySelector("#reviewMovie").value));
    const texto = document.querySelector("#reviewText").value.trim();
    if (!filme || !notaSelecionada) {
      mostrar("Escolha um filme e uma nota.");
      return;
    }
    dados.avaliacoes = dados.avaliacoes.filter((item) => item.filme.id !== filme.id);
    dados.avaliacoes.unshift({ filme, nota: notaSelecionada, texto });
    await salvarDados();
    filmeParaAvaliar = null;
    notaSelecionada = 0;
    location.hash = "#activity";
    mostrar("Avaliação salva.");
  }

  if (acao === "salvar-perfil") {
    dados.perfil.nome = document.querySelector("#profileName").value.trim() || "Visitante";
    dados.perfil.bio = document.querySelector("#profileBio").value.trim();
    await salvarDados();
    rota();
    mostrar("Perfil salvo.");
  }

  if (acao === "salvar-tema") {
    dados.tema = document.querySelector("#theme").value;
    await salvarDados();
    rota();
    mostrar("Tema alterado.");
  }

  if (acao === "sair") {
    await limparChaveApi();
    dados.apiKey = "";
    filmes = [];
    location.hash = "";
    rota();
  }

  if (acao === "alternar-login") {
    modoCadastro = !modoCadastro;
    renderLogin();
  }

  if (acao === "recarregar") rota();

  if (acao === "rolar") {
    const linha = document.querySelector(`#${botao.dataset.alvo}`);
    if (linha) {
      linha.scrollBy({
        left: linha.clientWidth * 0.8 * Number(botao.dataset.direcao),
        behavior: "smooth"
      });
    }
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === "loginForm") {
    const formulario = new FormData(form);
    const username = formulario.get("username").trim();
    const password = formulario.get("password");
    const chave = formulario.get("apiKey").trim();
    const botao = form.querySelector("button");
    botao.disabled = true;
    botao.textContent = modoCadastro ? "Cadastrando..." : "Entrando...";
    try {
      await validarChave(chave);
      const resposta = await fetch(STORAGE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: modoCadastro ? "register" : "login",
          username,
          password,
          apiKey: chave
        })
      });
      const resultado = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(resultado.error || "Não foi possível autenticar.");
      await carregarDados();
      location.hash = "#home";
      rota();
    } catch (erro) {
      renderLogin(erro.message);
    }
    return;
  }

  const query = new FormData(form).get("query").trim();
  if (query) location.hash = `#search?q=${encodeURIComponent(query)}`;
});

window.addEventListener("hashchange", rota);

(async function iniciar() {
  try {
    await carregarDados();
    await rota();
  } catch (erro) {
    app.innerHTML = mensagemErro(erro.message);
  }
})();
