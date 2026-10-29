# ValiFilmes

Uma página simples para pesquisar filmes, salvar favoritos e escrever avaliações usando a API do TMDB.

## Como executar

É necessário ter PHP instalado no computador. Node.js e npm não são necessários.

1. Baixe ou clone este projeto.
2. Abra um terminal na pasta do projeto.
3. Inicie o servidor PHP:

   ```bash
   php -S localhost:8000
   ```

4. Acesse `http://localhost:8000` no navegador.

Ao abrir o site, crie uma conta ou faça login informando **usuário, senha e API Key v3 do TMDB**. A senha é armazenada no servidor usando `password_hash`, e a API Key fica vinculada ao usuário autenticado.

Você pode criar ou consultar sua chave em [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). Use a **API Key (v3 auth)**, não o Read Access Token.

As contas e os dados do perfil são salvos automaticamente no arquivo SQLite `valifilmes.sqlite`, dentro da pasta do projeto. O banco é criado na primeira requisição e contém a tabela `usuarios`, com senha protegida por `password_hash`, API Key e dados do usuário. Em produção, mantenha o arquivo fora da pasta pública e com permissões restritas. É necessário ter internet para carregar os filmes e os pôsteres.

## Arquivos principais

- `index.html`: estrutura da página.
- `style.css`: estilos simples.
- `script.js`: filmes e funcionalidades.
- `api.php`: endpoint PHP que salva e carrega os dados da sessão.
- `valifilmes.sqlite`: criado automaticamente na pasta do projeto para armazenar as contas e os dados do projeto.
