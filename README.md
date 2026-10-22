# ValiFilmes

Uma página simples para pesquisar filmes, salvar favoritos e escrever avaliações usando a API do TMDB.

## Como executar

Não é necessário instalar Node.js, npm ou qualquer outra ferramenta.

1. Baixe ou clone este projeto.
2. Abra o arquivo `index.html` no navegador.

Ao abrir o site, informe sua **API Key v3** do TMDB. A chave é usada diretamente pelo navegador para consultar a API e fica salva somente no `localStorage` deste navegador.

Você pode criar ou consultar sua chave em [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). Use a **API Key (v3 auth)**, não o Read Access Token.

Os favoritos, avaliações, nome, bio, tema e chave são salvos no `localStorage` do navegador. É necessário ter internet para carregar os filmes e os pôsteres.

## Arquivos principais

- `index.html`: estrutura da página.
- `style.css`: estilos simples.
- `script.js`: filmes e funcionalidades.
