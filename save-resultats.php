<?php
/**
 * Enregistre les bilans du questionnaire de conformité IA dans resultats.json.
 * POST : corps JSON = un bilan (meta, score, resultats). Ajout en tête de la liste.
 * Le fichier resultats.json est lu et réécrit à chaque envoi.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Méthode non autorisée']);
    exit;
}

$path = __DIR__ . '/resultats.json';
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data) || empty($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'JSON invalide ou vide']);
    exit;
}

$entry = [
    'id' => isset($data['id']) ? $data['id'] : (time() * 1000),
    'completedAt' => isset($data['completedAt']) ? $data['completedAt'] : date('c'),
    'meta' => isset($data['meta']) ? $data['meta'] : [],
    'score' => isset($data['score']) ? $data['score'] : [],
    'resultats' => isset($data['resultats']) ? $data['resultats'] : []
];

$list = [];
if (is_file($path)) {
    $content = file_get_contents($path);
    if ($content !== false) {
        $decoded = json_decode($content, true);
        if (is_array($decoded)) {
            $list = $decoded;
        }
    }
}

array_unshift($list, $entry);
$json = json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

if (file_put_contents($path, $json) === false) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Impossible d\'écrire le fichier']);
    exit;
}

echo json_encode(['success' => true]);
