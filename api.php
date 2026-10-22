<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

const DATABASE_FILE = __DIR__ . DIRECTORY_SEPARATOR . 'valifilmes.sqlite';

function responder(array $dados, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function dadosPadrao(): array
{
    return [
        'favoritos' => [],
        'avaliacoes' => [],
        'catalogo' => [],
        'perfil' => [
            'nome' => 'Visitante',
            'bio' => 'Gosto de assistir filmes.',
        ],
        'tema' => 'escuro',
        'visualAtualizado' => true,
        'apiKey' => '',
    ];
}

function banco(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    try {
        $pdo = new PDO('sqlite:' . DATABASE_FILE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                api_key TEXT NOT NULL,
                dados_json TEXT NOT NULL,
                criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )'
        );
    } catch (PDOException $erro) {
        responder(['error' => 'Não foi possível abrir o banco SQLite. Verifique se o PDO SQLite está habilitado no PHP.'], 500);
    }

    return $pdo;
}

function usuarioAtual(): ?array
{
    $id = $_SESSION['valifilmes_usuario_id'] ?? null;
    return is_numeric($id) ? ['id' => (int)$id] : null;
}

function exigirLogin(): array
{
    $usuario = usuarioAtual();
    if ($usuario === null) {
        responder(['error' => 'Faça login para continuar.', 'authenticated' => false], 401);
    }

    $consulta = banco()->prepare('SELECT id, username, api_key, dados_json FROM usuarios WHERE id = :id');
    $consulta->execute(['id' => $usuario['id']]);
    $conta = $consulta->fetch();
    if (!$conta) {
        unset($_SESSION['valifilmes_usuario_id']);
        responder(['error' => 'Sessão inválida. Faça login novamente.', 'authenticated' => false], 401);
    }

    return $conta;
}

function dadosDaConta(array $conta): array
{
    $dados = json_decode($conta['dados_json'], true);
    $padrao = dadosPadrao();
    return array_replace_recursive($padrao, is_array($dados) ? $dados : []);
}

function dadosRecebidos(array $recebidos, string $apiKey): array
{
    $padrao = dadosPadrao();
    return [
        'favoritos' => is_array($recebidos['favoritos'] ?? null) ? array_values($recebidos['favoritos']) : [],
        'avaliacoes' => is_array($recebidos['avaliacoes'] ?? null) ? array_values($recebidos['avaliacoes']) : [],
        'catalogo' => is_array($recebidos['catalogo'] ?? null) ? array_values($recebidos['catalogo']) : [],
        'perfil' => [
            'nome' => trim((string)($recebidos['perfil']['nome'] ?? $padrao['perfil']['nome'])) ?: $padrao['perfil']['nome'],
            'bio' => trim((string)($recebidos['perfil']['bio'] ?? '')),
        ],
        'tema' => ($recebidos['tema'] ?? '') === 'claro' ? 'claro' : 'escuro',
        'visualAtualizado' => true,
        'apiKey' => $apiKey,
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = $_SESSION['valifilmes_usuario_id'] ?? null;
    if (!is_numeric($id)) {
        responder(['authenticated' => false]);
    }

    $conta = exigirLogin();
    responder([
        ...dadosDaConta($conta),
        'apiKey' => $conta['api_key'],
        'authenticated' => true,
        'username' => $conta['username'],
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    responder(['error' => 'Método não permitido.'], 405);
}

$entrada = json_decode(file_get_contents('php://input'), true);
if (!is_array($entrada)) {
    responder(['error' => 'JSON inválido.'], 400);
}

$acao = $entrada['action'] ?? '';
$pdo = banco();

if ($acao === 'register' || $acao === 'login') {
    $username = trim((string)($entrada['username'] ?? ''));
    $senha = (string)($entrada['password'] ?? '');
    $apiKey = trim((string)($entrada['apiKey'] ?? ''));

    if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username)) {
        responder(['error' => 'O usuário deve ter entre 3 e 32 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.'], 422);
    }
    if (strlen($senha) < 6) {
        responder(['error' => 'A senha deve ter pelo menos 6 caracteres.'], 422);
    }
    if ($apiKey === '') {
        responder(['error' => 'Informe a API Key v3 do TMDB.'], 422);
    }

    $consulta = $pdo->prepare('SELECT id, username, password_hash, api_key, dados_json FROM usuarios WHERE username = :username');
    $consulta->execute(['username' => $username]);
    $conta = $consulta->fetch();

    if ($acao === 'register') {
        if ($conta) {
            responder(['error' => 'Esse usuário já existe.'], 409);
        }

        $inserir = $pdo->prepare(
            'INSERT INTO usuarios (username, password_hash, api_key, dados_json)
             VALUES (:username, :password_hash, :api_key, :dados_json)'
        );
        try {
            $inserir->execute([
                'username' => $username,
                'password_hash' => password_hash($senha, PASSWORD_DEFAULT),
                'api_key' => $apiKey,
                'dados_json' => json_encode(dadosPadrao(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
        } catch (PDOException $erro) {
            responder(['error' => 'Não foi possível criar a conta.'], 500);
        }
        $conta = [
            'id' => (int)$pdo->lastInsertId(),
            'username' => $username,
            'api_key' => $apiKey,
        ];
    } else {
        if (!$conta || !password_verify($senha, $conta['password_hash'])) {
            responder(['error' => 'Usuário ou senha inválidos.'], 401);
        }
        if (!hash_equals($conta['api_key'], $apiKey)) {
            responder(['error' => 'API Key inválida para este usuário.'], 401);
        }
    }

    session_regenerate_id(true);
    $_SESSION['valifilmes_usuario_id'] = (int)$conta['id'];
    responder(['ok' => true]);
}

if ($acao === 'logout') {
    unset($_SESSION['valifilmes_usuario_id']);
    responder(['ok' => true]);
}

$conta = exigirLogin();

if ($acao === 'clear-key') {
    responder(['error' => 'A API Key faz parte da conta e não pode ser removida sem sair.'], 422);
}

if ($acao !== 'save' || !isset($entrada['data']) || !is_array($entrada['data'])) {
    responder(['error' => 'Ação inválida.'], 400);
}

$dados = dadosRecebidos($entrada['data'], $conta['api_key']);
$atualizar = $pdo->prepare(
    'UPDATE usuarios
     SET dados_json = :dados_json, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = :id'
);
$atualizar->execute([
    'dados_json' => json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    'id' => $conta['id'],
]);
responder(['ok' => true]);
