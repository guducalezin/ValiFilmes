import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DEMO_MODE =
  process.env.DEMO_MODE === "true" ||
  (process.env.DEMO_MODE !== "false" && process.env.NODE_ENV !== "production");
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const COOKIE_NAME = "valifilmes_session";
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || "data");
const DATABASE_PATH = join(DATA_DIR, "valifilmes.sqlite");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
const TMDB_ENDPOINTS = new Set([
  "/trending/movie/week",
  "/movie/now_playing",
  "/search/movie",
]);
const TMDB_QUERY_PARAMS = new Set(["language", "page", "include_adult", "query"]);

const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
if (encryptionKey.length !== 32) {
  throw new Error(
    "ENCRYPTION_KEY obrigatória: gere uma chave base64 com 32 bytes aleatórios e configure o arquivo .env.",
  );
}
if (DEMO_MODE && process.env.NODE_ENV === "production") {
  throw new Error("DEMO_MODE não pode ser ativado em produção.");
}

mkdirSync(DATA_DIR, { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    api_key_ciphertext TEXT NOT NULL,
    api_key_iv TEXT NOT NULL,
    api_key_tag TEXT NOT NULL,
    profile_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id TEXT NOT NULL,
    movie_json TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (user_id, movie_id)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id TEXT NOT NULL,
    movie_json TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, movie_id)
  );
  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const DEMO_EMAIL = "demo@local.invalid";
const ensureDemoUser = () => {
  let demoUser = database.prepare("SELECT * FROM users WHERE email = ?").get(DEMO_EMAIL);
  const configuredApiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (configuredApiKey && !/^[a-f\d]{32}$/i.test(configuredApiKey)) {
    throw new Error("TMDB_API_KEY deve ser uma API Key v3 de 32 caracteres.");
  }
  if (!demoUser) {
    const salt = randomBytes(16);
    const password = randomBytes(32);
    const encryptedKey = encryptApiKey(configuredApiKey);
    const result = database
      .prepare(
        `INSERT INTO users
         (email, password_salt, password_hash, api_key_ciphertext, api_key_iv, api_key_tag, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        DEMO_EMAIL,
        salt.toString("hex"),
        scryptSync(password, salt, 64).toString("hex"),
        encryptedKey.ciphertext,
        encryptedKey.iv,
        encryptedKey.tag,
        new Date().toISOString(),
      );
    demoUser = database.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  } else if (configuredApiKey) {
    const encryptedKey = encryptApiKey(configuredApiKey);
    database
      .prepare(
        "UPDATE users SET api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ? WHERE id = ?",
      )
      .run(encryptedKey.ciphertext, encryptedKey.iv, encryptedKey.tag, demoUser.id);
    demoUser = database.prepare("SELECT * FROM users WHERE id = ?").get(demoUser.id);
  }
  return demoUser;
};
let demoUser = null;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (response, status, data, headers = {}) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
};

const readBody = async (request) => {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Corpo da requisição muito grande.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Objeto JSON esperado.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Corpo JSON inválido.");
  }
};

const encryptApiKey = (apiKey) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
};

demoUser = DEMO_MODE ? ensureDemoUser() : null;

const decryptApiKey = (user) => {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(user.api_key_iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(user.api_key_tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(user.api_key_ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    console.error("Falha ao descriptografar a chave TMDB do usuário", user.id, error);
    throw new HttpError(500, "Não foi possível acessar a chave TMDB desta conta.");
  }
};

const hashPassword = async (password, salt = randomBytes(16)) => ({
  salt: salt.toString("hex"),
  hash: Buffer.from(await scrypt(password, salt, 64)).toString("hex"),
});

const verifyPassword = async (password, user) => {
  const expected = Buffer.from(user.password_hash, "hex");
  const actual = Buffer.from(
    await scrypt(password, Buffer.from(user.password_salt, "hex"), expected.length),
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const hashSessionToken = (token) =>
  createHash("sha256").update(token).digest("hex");

const cookieHeader = (token, maxAge) => {
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
};

const clearSessionCookie = () => cookieHeader("", 0);

const getCookie = (request, name) => {
  const cookieHeaderValue = request.headers.cookie || "";
  for (const cookie of cookieHeaderValue.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
};

const createSession = (userId) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  database
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashSessionToken(token), userId, expiresAt);
  return { token, expiresAt };
};

const getAuthenticatedUser = (request) => {
  if (DEMO_MODE) {
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(demoUser.id);
    if (!user) throw new HttpError(500, "Perfil local de demonstração não foi encontrado.");
    return user;
  }
  const token = getCookie(request, COOKIE_NAME);
  if (!token) throw new HttpError(401, "Faça login para continuar.");
  const session = database
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashSessionToken(token), Date.now());
  if (!session) throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
  return session;
};

const publicUser = (user) => ({
  email: user.email,
  profile: JSON.parse(user.profile_json || "{}"),
});

const validateEmail = (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new HttpError(400, "Informe um email válido.");
  }
  return normalized;
};

const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new HttpError(400, "A senha deve ter entre 8 e 200 caracteres.");
  }
  return password;
};

const validateApiKey = (apiKey) => {
  const value = String(apiKey || "").trim();
  if (!/^[a-f\d]{32}$/i.test(value)) {
    throw new HttpError(400, "Informe uma API Key v3 válida do TMDB (32 caracteres).");
  }
  return value;
};

const validateTmdbKeyWithProvider = async (apiKey) => {
  let response;
  try {
    response = await fetch(
      `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
  } catch {
    throw new HttpError(502, "Não foi possível validar a chave no TMDB. Tente novamente.");
  }
  if (!response.ok) {
    throw new HttpError(400, "A chave TMDB foi recusada. Confira a API Key v3 e tente novamente.");
  }
};

const normalizeMovie = (rawMovie) => {
  if (!rawMovie || typeof rawMovie !== "object") {
    throw new HttpError(400, "Dados do filme inválidos.");
  }
  const id = String(rawMovie.id ?? "");
  const title = String(rawMovie.title || rawMovie.name || "").trim();
  if (!/^\d{1,12}$/.test(id) || !title || title.length > 250) {
    throw new HttpError(400, "Identificador ou título do filme inválido.");
  }
  const posterPath = String(rawMovie.poster_path || "");
  return {
    id,
    title,
    overview: String(rawMovie.overview || "").slice(0, 4000),
    poster_path: /^\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp)$/i.test(posterPath)
      ? posterPath
      : "",
    vote_average: Math.max(0, Math.min(10, Number(rawMovie.vote_average) || 0)),
    release_date: /^\d{4}-\d{2}-\d{2}$/.test(String(rawMovie.release_date || ""))
      ? String(rawMovie.release_date)
      : "",
  };
};

const authAttempts = new Map();
const enforceAuthRateLimit = (request) => {
  const ip = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = authAttempts.get(ip);
  if (!current || current.resetAt < now) {
    authAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
  if (current.count > 12) {
    throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }
};

const resetAuthRateLimit = (request) => {
  authAttempts.delete(request.socket.remoteAddress || "unknown");
};

const handleAuthRegister = async (request, response) => {
  enforceAuthRateLimit(request);
  const body = await readBody(request);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const apiKey = validateApiKey(body.apiKey);
  await validateTmdbKeyWithProvider(apiKey);
  const { salt, hash } = await hashPassword(password);
  const encryptedKey = encryptApiKey(apiKey);
  try {
    const result = database
      .prepare(
        `INSERT INTO users
         (email, password_salt, password_hash, api_key_ciphertext, api_key_iv, api_key_tag, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        email,
        salt,
        hash,
        encryptedKey.ciphertext,
        encryptedKey.iv,
        encryptedKey.tag,
        new Date().toISOString(),
      );
    const session = createSession(Number(result.lastInsertRowid));
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    resetAuthRateLimit(request);
    json(response, 201, { user: publicUser(user) }, {
      "Set-Cookie": cookieHeader(session.token, SESSION_DURATION_MS / 1000),
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new HttpError(409, "Já existe uma conta com esse email.");
    }
    throw error;
  }
};

const handleAuthLogin = async (request, response) => {
  enforceAuthRateLimit(request);
  const body = await readBody(request);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const user = database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
  const passwordMatches = user
    ? await verifyPassword(password, user)
    : (await scrypt(password, Buffer.alloc(16), 64), false);
  if (!passwordMatches) {
    throw new HttpError(401, "Email ou senha incorretos.");
  }
  const oldToken = getCookie(request, COOKIE_NAME);
  if (oldToken) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(oldToken));
  }
  const session = createSession(user.id);
  resetAuthRateLimit(request);
  json(response, 200, { user: publicUser(user) }, {
    "Set-Cookie": cookieHeader(session.token, SESSION_DURATION_MS / 1000),
  });
};

const handleAuthLogout = (request, response) => {
  const token = getCookie(request, COOKIE_NAME);
  if (token) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }
  json(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
};

const handleUserData = (user, response) => {
  const favorites = database
    .prepare("SELECT movie_json FROM favorites WHERE user_id = ? ORDER BY position")
    .all(user.id)
    .map((row) => JSON.parse(row.movie_json));
  const reviews = database
    .prepare(
      "SELECT movie_json, rating, review_text, created_at FROM reviews WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(user.id)
    .map((row) => ({
      movie: JSON.parse(row.movie_json),
      rating: row.rating,
      text: row.review_text,
      createdAt: row.created_at,
    }));
  json(response, 200, {
    profile: JSON.parse(user.profile_json || "{}"),
    favorites,
    reviews,
    hasTmdbKey: Boolean(user.api_key_ciphertext),
  });
};

const handleUpdateProfile = (user, body, response) => {
  const name = String(body.name || "").trim();
  const bio = String(body.bio || "").trim();
  const avatar = String(body.avatar || "").trim();
  if (!name || name.length > 40 || bio.length > 180) {
    throw new HttpError(400, "Nome obrigatório (até 40 caracteres) e bio de até 180 caracteres.");
  }
  if (avatar && (!/^https:\/\//i.test(avatar) || avatar.length > 2000)) {
    throw new HttpError(400, "A foto de perfil deve usar uma URL HTTPS.");
  }
  const profile = { name, bio, avatar };
  database.prepare("UPDATE users SET profile_json = ? WHERE id = ?").run(
    JSON.stringify(profile),
    user.id,
  );
  json(response, 200, { profile });
};

const handleUpdateFavorites = (user, body, response) => {
  if (!Array.isArray(body.favorites) || body.favorites.length > 4) {
    throw new HttpError(400, "A lista de favoritos deve conter no máximo 4 filmes.");
  }
  const movies = body.favorites.map(normalizeMovie);
  if (new Set(movies.map((movie) => movie.id)).size !== movies.length) {
    throw new HttpError(400, "A lista contém filmes repetidos.");
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM favorites WHERE user_id = ?").run(user.id);
    const insert = database.prepare(
      "INSERT INTO favorites (user_id, movie_id, movie_json, position) VALUES (?, ?, ?, ?)",
    );
    movies.forEach((movie, position) =>
      insert.run(user.id, movie.id, JSON.stringify(movie), position),
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  json(response, 200, { favorites: movies });
};

const handleSaveReview = (user, body, response) => {
  const movie = normalizeMovie(body.movie);
  const rating = Number(body.rating);
  const text = String(body.text || "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length > 1000) {
    throw new HttpError(400, "Informe uma nota de 1 a 5 e um texto de até 1000 caracteres.");
  }
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO reviews (user_id, movie_id, movie_json, rating, review_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, movie_id) DO UPDATE SET
         movie_json = excluded.movie_json,
         rating = excluded.rating,
         review_text = excluded.review_text,
         created_at = excluded.created_at`,
    )
    .run(user.id, movie.id, JSON.stringify(movie), rating, text, createdAt);
  json(response, 201, { review: { movie, rating, text, createdAt } });
};

const handleUpdateApiKey = async (user, body, response) => {
  const apiKey = validateApiKey(body.apiKey);
  await validateTmdbKeyWithProvider(apiKey);
  const encryptedKey = encryptApiKey(apiKey);
  database
    .prepare(
      `UPDATE users SET api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ? WHERE id = ?`,
    )
    .run(encryptedKey.ciphertext, encryptedKey.iv, encryptedKey.tag, user.id);
  json(response, 200, { ok: true });
};

const handleSuggestion = (user, body, response) => {
  const title = String(body.title || "").trim();
  if (!title || title.length > 150) {
    throw new HttpError(400, "Informe o nome do filme (até 150 caracteres).");
  }
  database
    .prepare("INSERT INTO suggestions (user_id, title, created_at) VALUES (?, ?, ?)")
    .run(user.id, title, new Date().toISOString());
  json(response, 201, { ok: true });
};

const handleTmdbRequest = async (user, url, response) => {
  const endpoint = url.pathname.slice("/api/tmdb".length) || "/";
  if (!TMDB_ENDPOINTS.has(endpoint)) throw new HttpError(404, "Consulta TMDB não disponível.");
  if ([...url.searchParams.keys()].some((key) => !TMDB_QUERY_PARAMS.has(key))) {
    throw new HttpError(400, "Parâmetro de busca inválido.");
  }
  const tmdbUrl = new URL(`https://api.themoviedb.org/3${endpoint}`);
  for (const [key, value] of url.searchParams) tmdbUrl.searchParams.set(key, value);
  if (!user.api_key_ciphertext) {
    throw new HttpError(
      503,
      "Configure sua TMDB_API_KEY no .env ou adicione uma chave em Configurações para carregar filmes.",
    );
  }
  tmdbUrl.searchParams.set("api_key", decryptApiKey(user));
  let tmdbResponse;
  try {
    tmdbResponse = await fetch(tmdbUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new HttpError(502, "O TMDB está indisponível no momento.");
  }
  const payload = await tmdbResponse.json().catch(() => null);
  if (!tmdbResponse.ok) {
    throw new HttpError(
      tmdbResponse.status === 401 ? 502 : tmdbResponse.status,
      tmdbResponse.status === 401
        ? "A chave TMDB desta conta foi recusada. Troque a chave nas configurações."
        : "Não foi possível consultar o TMDB.",
    );
  }
  json(response, 200, payload);
};

const serveStaticFile = (url, request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Caminho inválido.");
  }
  if (pathname === "/") pathname = "/index.html";
  const relativePath = normalize(pathname.replace(/^[/\\]+/, ""));
  const target = resolve(ROOT, relativePath);
  const isPublicFile =
    ["index.html", "style.css", "script.js"].includes(relativePath) ||
    relativePath.startsWith(`assets${sep}`);
  if (
    !isPublicFile ||
    !target.startsWith(`${ROOT}${sep}`) ||
    !existsSync(target)
  ) {
    throw new HttpError(404, "Arquivo não encontrado.");
  }
  const contentType = MIME_TYPES[extname(target).toLowerCase()];
  if (!contentType) throw new HttpError(404, "Arquivo não encontrado.");
  const content = readFileSync(target);
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": content.length,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : content);
};

const handleRequest = async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/config") {
    json(response, 200, { demoMode: DEMO_MODE });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (DEMO_MODE) throw new HttpError(404, "Cadastro desativado no modo de demonstração.");
    await handleAuthRegister(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (DEMO_MODE) throw new HttpError(404, "Login desativado no modo de demonstração.");
    await handleAuthLogin(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    handleAuthLogout(request, response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getAuthenticatedUser(request);
    json(response, 200, { user: publicUser(user), demoMode: DEMO_MODE });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    const user = getAuthenticatedUser(request);
    if (request.method === "GET" && url.pathname === "/api/user/data") {
      handleUserData(user, response);
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/user/profile") {
      handleUpdateProfile(user, await readBody(request), response);
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/user/favorites") {
      handleUpdateFavorites(user, await readBody(request), response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/user/reviews") {
      handleSaveReview(user, await readBody(request), response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/user/api-key") {
      await handleUpdateApiKey(user, await readBody(request), response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/user/suggestions") {
      handleSuggestion(user, await readBody(request), response);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/tmdb/")) {
      await handleTmdbRequest(user, url, response);
      return;
    }
    throw new HttpError(404, "Rota da API não encontrada.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "Método não permitido.");
  }
  serveStaticFile(url, request, response);
};

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (!(error instanceof HttpError)) {
      console.error("Erro ao processar requisição:", error);
    }
    json(response, error.status || 500, {
      error: error instanceof HttpError ? error.message : "Erro interno do servidor.",
    });
  });
});

const cleanupTimer = setInterval(() => {
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  for (const [ip, attempt] of authAttempts) {
    if (attempt.resetAt <= Date.now()) authAttempts.delete(ip);
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

server.listen(PORT, HOST, () => {
  console.log(`ValiFilmes disponível em http://${HOST}:${PORT}`);
  console.log(`SQLite: ${DATABASE_PATH}`);
  if (DEMO_MODE) console.log("Modo de demonstração ativo; autenticação desativada.");
});

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
