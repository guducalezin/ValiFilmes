# ValiFilmes

## Executar localmente

Requer Node.js 22.13 ou superior. O servidor usa o SQLite integrado ao Node.js; não precisa instalar dependências.

**Segurança:** a versão anterior do protótipo tinha uma chave TMDB em arquivos do repositório. Se ela era real, revogue-a no TMDB e gere outra. Remover a chave dos arquivos atuais não a apaga do histórico de commits.

1. Copie `.env.example` para `.env`.
2. Gere uma chave de criptografia e cole o resultado em `ENCRYPTION_KEY`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

3. Execute `npm start` e abra `http://localhost:3000`.

Por padrão, o servidor local abre em **modo de demonstração**, sem pedir login. Todos os visitantes dessa instância local usam o mesmo perfil de demonstração e os dados são salvos em SQLite. Configure `TMDB_API_KEY` no `.env` ou salve uma chave pela tela **Configurações** para carregar filmes. Desative o modo de demonstração com `DEMO_MODE=false` para testar cadastro e login.

O banco será criado em `data/valifilmes.sqlite`. O diretório de dados e o arquivo `.env` são ignorados pelo Git. Guarde cópias de segurança do banco e mantenha a chave de criptografia em local seguro: sem ela, as chaves TMDB criptografadas não podem ser recuperadas.

## Criar conta e obter a chave TMDB

O primeiro acesso leva ao cadastro. Para criar uma conta, informe email, senha e a chave API v3 do TMDB:

1. Crie uma conta em [themoviedb.org](https://www.themoviedb.org/signup).
2. Acesse [Configurações → API](https://www.themoviedb.org/settings/api).
3. Solicite uma chave API e preencha os dados de uso do aplicativo solicitados pelo TMDB.
4. Copie a **API Key (v3 auth)** e cole no cadastro do ValiFilmes. Não use o Read Access Token.

A chave é validada no cadastro e nas trocas e armazenada criptografada com AES-256-GCM no SQLite. Consultas ao catálogo passam pelo servidor; a chave nunca é enviada ao navegador. Depois do cadastro, ela pode ser trocada em **Configurações → Chave TMDB**. O login normal pede apenas email e senha.

Senhas são armazenadas com `scrypt` e salt individual. A sessão usa cookie `HttpOnly` e `SameSite=Lax`. Em produção, execute o servidor atrás de HTTPS e configure `NODE_ENV=production` para habilitar cookies `Secure`. Defina `HOST=0.0.0.0` apenas quando precisar aceitar conexões externas.

O modo de demonstração é exclusivamente local e o servidor recusa iniciá-lo com `NODE_ENV=production`. Para publicar o site, configure `NODE_ENV=production` e `DEMO_MODE=false`.

## Dados armazenados

As contas, sessões, perfis, até quatro favoritos por pessoa, avaliações e sugestões ficam no SQLite e são separados por usuário. O tema visual é uma preferência local do navegador.
