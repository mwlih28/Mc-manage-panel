<?php
/**
 * Kretase provisioning module for WHMCS.
 *
 * Install: copy this file to modules/servers/kretase/kretase.php in your
 * WHMCS installation, then create a Server (Setup > Products/Services >
 * Servers) with Module = Kretase, Hostname = your panel URL
 * (https://panel.example.com, no trailing slash), and Access Hash = a
 * Kretase admin API key (Admin -> API Keys, needs users:write + servers:write
 * scopes). Then set a product's Module Settings to Kretase and fill in the
 * config options below.
 *
 * Written against Kretase's existing admin REST API (see Admin -> API
 * Reference in the panel for the exact, versioned contract) rather than a
 * separate WHMCS-specific endpoint — the same API third-party tools use.
 *
 * This module is free to download and resell with — Kretase does not gate
 * or license the software itself, and nothing here enforces certification.
 * The optional "Kretase Certificate ID" field only controls a cosmetic
 * "Certified" badge shown to your own customers in their client area
 * (kretase_ClientArea below); leaving it blank shows nothing negative,
 * it just omits the badge. Entering a certificate ID you were not actually
 * issued by the Kretase Core Team is a straightforward misrepresentation to
 * your customers — that's on you, not something this code checks. Kretase
 * is not responsible for the performance, uptime, or support quality of any
 * deployment, certified or not.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

function kretase_MetaData()
{
    return [
        'DisplayName' => 'Kretase',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
    ];
}

function kretase_ConfigOptions()
{
    return [
        'Node ID' => ['Type' => 'text', 'Size' => '40', 'Description' => 'Kretase node id to provision on (Admin -> Nodes)'],
        'Egg ID' => ['Type' => 'text', 'Size' => '40', 'Description' => 'Kretase egg id for this product (Admin -> Eggs)'],
        'Memory (MB)' => ['Type' => 'text', 'Size' => '10', 'Default' => '2048'],
        'Disk (MB)' => ['Type' => 'text', 'Size' => '10', 'Default' => '10000'],
        'Kretase Certificate ID' => ['Type' => 'text', 'Size' => '20', 'Description' => 'Optional. Only fill this in if the Kretase Core Team actually issued you a certificate (see kretase.com/partners.html) — it shows a verified badge to your customers.'],
    ];
}

/** Builds an HTTP client against this product's configured Kretase panel. */
function kretase_request($params, $method, $path, $body = null)
{
    $url = rtrim($params['serverhostname'], '/') . '/api/v1' . $path;
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $params['serverpassword'],
        'Content-Type: application/json',
        'Accept: application/json',
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($response === false) {
        throw new Exception('Kretase API request failed: ' . $error);
    }
    return ['status' => $status, 'body' => json_decode($response, true)];
}

/** Finds an existing Kretase user by email, or creates one. */
function kretase_findOrCreateUser($params)
{
    $email = $params['clientsdetails']['email'];

    $created = kretase_request($params, 'POST', '/users', [
        'email' => $email,
        'username' => preg_replace('/[^a-zA-Z0-9]/', '', strtolower($params['clientsdetails']['firstname'] . $params['clientsdetails']['lastname'] . substr(md5($email), 0, 4))),
        'password' => bin2hex(random_bytes(12)),
        'firstName' => $params['clientsdetails']['firstname'],
        'lastName' => $params['clientsdetails']['lastname'],
    ]);
    if ($created['status'] === 201) {
        return $created['body']['data']['id'];
    }
    if ($created['status'] === 409) {
        $search = kretase_request($params, 'GET', '/users?search=' . urlencode($email));
        if (!empty($search['body']['data'])) {
            return $search['body']['data'][0]['id'];
        }
    }
    throw new Exception('Could not find or create Kretase user for ' . $email);
}

function kretase_CreateAccount(array $params)
{
    try {
        $userId = kretase_findOrCreateUser($params);

        $result = kretase_request($params, 'POST', '/servers', [
            'name' => $params['domain'] ?: ('Service #' . $params['serviceid']),
            'userId' => $userId,
            'nodeId' => $params['configoption1'],
            'eggId' => $params['configoption2'],
            'memory' => (int) $params['configoption3'],
            'disk' => (int) $params['configoption4'],
        ]);
        if ($result['status'] !== 201) {
            $message = $result['body']['message'] ?? 'Unknown error';
            return 'Kretase server creation failed: ' . $message;
        }

        // Stash the Kretase server id so suspend/unsuspend/terminate know
        // which server to act on later.
        localAPI('UpdateClientProduct', [
            'serviceid' => $params['serviceid'],
            'customfields' => base64_encode(serialize(['Kretase Server ID' => $result['body']['data']['id']])),
        ]);

        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function kretase_getServerId($params)
{
    return $params['customfields']['Kretase Server ID'] ?? null;
}

function kretase_SuspendAccount(array $params)
{
    $serverId = kretase_getServerId($params);
    if (!$serverId) return 'No Kretase server id on file for this service';
    $result = kretase_request($params, 'PATCH', '/servers/' . $serverId, ['suspended' => true]);
    return $result['status'] === 200 ? 'success' : ($result['body']['message'] ?? 'Suspend failed');
}

function kretase_UnsuspendAccount(array $params)
{
    $serverId = kretase_getServerId($params);
    if (!$serverId) return 'No Kretase server id on file for this service';
    $result = kretase_request($params, 'PATCH', '/servers/' . $serverId, ['suspended' => false]);
    return $result['status'] === 200 ? 'success' : ($result['body']['message'] ?? 'Unsuspend failed');
}

function kretase_TerminateAccount(array $params)
{
    $serverId = kretase_getServerId($params);
    if (!$serverId) return 'success'; // Nothing to terminate.
    $result = kretase_request($params, 'DELETE', '/servers/' . $serverId);
    return ($result['status'] === 204 || $result['status'] === 404) ? 'success' : ($result['body']['message'] ?? 'Terminate failed');
}

// Plain HTML string rather than a 'templatefile' reference — that variant
// needs a matching templates/clientarea.tpl shipped alongside this file,
// which adds a second file to install for no real benefit here.
function kretase_ClientArea(array $params)
{
    $serverId = kretase_getServerId($params);
    if (!$serverId) return '';
    $panelUrl = rtrim($params['serverhostname'], '/');
    $manageUrl = htmlspecialchars($panelUrl . '/servers/' . $serverId, ENT_QUOTES);

    $html = '<a href="' . $manageUrl . '" target="_blank" style="display:inline-block;padding:8px 14px;background:#2E6FEE;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Manage Server</a>';

    // Cosmetic only — see the note at the top of this file. Blank unless
    // the admin filled in a real certificate ID; no badge is shown at all
    // for uncertified deployments, nothing negative either way.
    $certId = trim($params['configoption5'] ?? '');
    if ($certId !== '') {
        $safeCertId = htmlspecialchars($certId, ENT_QUOTES);
        $verifyUrl = 'https://kretase.com/verify.html?id=' . urlencode($certId);
        $html .= '<div style="margin-top:10px;font-size:12px;color:#2E6FEE">'
            . '&#10003; Kretase Certified Partner &mdash; <a href="' . $verifyUrl . '" target="_blank" style="color:inherit">' . $safeCertId . '</a>'
            . '</div>';
    }

    return $html;
}
