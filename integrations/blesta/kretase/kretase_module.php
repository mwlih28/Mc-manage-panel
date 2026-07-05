<?php
/**
 * Kretase provisioning module for Blesta.
 *
 * Blesta modules require more scaffolding than this single file — a real
 * install also needs components/modules/kretase/kretase_module.json,
 * a language file at language/en_us/kretase.php, and a logo/icon. Those are
 * cosmetic/metadata files; this file carries every actual API integration
 * call and is the part worth reviewing carefully before use. Verify the
 * exact Module base-class method signatures against your Blesta version's
 * SDK docs (they've been stable across versions but this hasn't been tested
 * against a live Blesta install).
 *
 * Install: copy this directory to components/modules/kretase/ in your
 * Blesta installation, enable it under Settings -> Modules, add a module
 * row with your Kretase panel URL and an admin API key (users:write +
 * servers:write scopes), then use it on a package.
 */

App::uses('Module', 'Modules');

class Kretase_module extends Module
{
    public function __construct()
    {
        Language::loadLang('kretase_module', null, dirname(__FILE__) . DS . 'language' . DS);
    }

    public function getModuleRowMetaFields()
    {
        return [
            (object) ['key' => 'panel_url', 'label' => 'Panel URL', 'type' => 'text'],
            (object) ['key' => 'api_key', 'label' => 'Admin API Key', 'type' => 'password'],
        ];
    }

    public function getPackageFields($vars = null)
    {
        $fields = new ModuleFields();
        $fields->setField($fields->fieldText('meta[node_id]', 'Kretase Node ID', $this->Html->ifSet($vars->meta['node_id'] ?? null)));
        $fields->setField($fields->fieldText('meta[egg_id]', 'Kretase Egg ID', $this->Html->ifSet($vars->meta['egg_id'] ?? null)));
        $fields->setField($fields->fieldText('meta[memory]', 'Memory (MB)', $this->Html->ifSet($vars->meta['memory'] ?? 2048)));
        $fields->setField($fields->fieldText('meta[disk]', 'Disk (MB)', $this->Html->ifSet($vars->meta['disk'] ?? 10000)));
        return $fields;
    }

    private function request($moduleRow, $method, $path, $body = null)
    {
        $url = rtrim($moduleRow->meta->panel_url, '/') . '/api/v1' . $path;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $moduleRow->meta->api_key,
            'Content-Type: application/json',
            'Accept: application/json',
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $response = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => json_decode($response, true)];
    }

    private function findOrCreateUser($moduleRow, $clientEmail, $firstName, $lastName)
    {
        $created = $this->request($moduleRow, 'POST', '/users', [
            'email' => $clientEmail,
            'username' => preg_replace('/[^a-zA-Z0-9]/', '', strtolower($firstName . $lastName . substr(md5($clientEmail), 0, 4))),
            'password' => bin2hex(random_bytes(12)),
            'firstName' => $firstName,
            'lastName' => $lastName,
        ]);
        if ($created['status'] === 201) {
            return $created['body']['data']['id'];
        }
        if ($created['status'] === 409) {
            $search = $this->request($moduleRow, 'GET', '/users?search=' . urlencode($clientEmail));
            if (!empty($search['body']['data'])) {
                return $search['body']['data'][0]['id'];
            }
        }
        return null;
    }

    public function addService($package, array $vars = null, $parentPackage = null, $parentServiceId = null, $status = 'pending')
    {
        $moduleRow = $this->getModuleRow();
        $userId = $this->findOrCreateUser($moduleRow, $vars['client_email'] ?? '', $vars['client_first_name'] ?? '', $vars['client_last_name'] ?? '');
        if (!$userId) {
            $this->Input->setErrors(['api' => ['create_user' => 'Could not find or create the Kretase user for this client']]);
            return;
        }

        $result = $this->request($moduleRow, 'POST', '/servers', [
            'name' => $vars['domain'] ?? ('Service for ' . ($vars['client_email'] ?? 'client')),
            'userId' => $userId,
            'nodeId' => $package->meta->node_id,
            'eggId' => $package->meta->egg_id,
            'memory' => (int) $package->meta->memory,
            'disk' => (int) $package->meta->disk,
        ]);
        if ($result['status'] !== 201) {
            $this->Input->setErrors(['api' => ['create_server' => $result['body']['message'] ?? 'Server creation failed']]);
            return;
        }

        return [
            (object) ['key' => 'kretase_server_id', 'value' => $result['body']['data']['id'], 'encrypted' => 0],
        ];
    }

    private function serviceServerId($service)
    {
        foreach ($service->fields as $field) {
            if ($field->key === 'kretase_server_id') return $field->value;
        }
        return null;
    }

    public function suspendService($package, $service)
    {
        $serverId = $this->serviceServerId($service);
        if (!$serverId) return;
        $this->request($this->getModuleRow(), 'PATCH', '/servers/' . $serverId, ['suspended' => true]);
    }

    public function unsuspendService($package, $service)
    {
        $serverId = $this->serviceServerId($service);
        if (!$serverId) return;
        $this->request($this->getModuleRow(), 'PATCH', '/servers/' . $serverId, ['suspended' => false]);
    }

    public function cancelService($package, $service)
    {
        $serverId = $this->serviceServerId($service);
        if (!$serverId) return;
        $this->request($this->getModuleRow(), 'DELETE', '/servers/' . $serverId);
    }
}
