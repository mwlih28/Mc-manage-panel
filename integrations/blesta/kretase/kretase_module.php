<?php
/**
 * Kretase provisioning module for Blesta.
 *
 * Ships with the full scaffolding Blesta requires to load this as a real
 * module: config.json (metadata) and language/en_us/kretase_module.php
 * (labels/errors) sit alongside this file. No logo is bundled — Blesta
 * falls back to a generic icon when config.json omits one, which is fine
 * here rather than shipping a placeholder image. Method signatures were
 * verified against Blesta's published Module base-class docs, but this
 * hasn't been exercised against a live Blesta install — test on staging
 * before relying on it for real orders.
 *
 * Install: unzip this whole directory to components/modules/kretase/ in
 * your Blesta installation (so kretase_module.php, config.json, and
 * language/ all land together), enable it under Settings -> Modules, add
 * a module row with your Kretase panel URL and an admin API key
 * (users:write + servers:write scopes), then use it on a package.
 *
 * This module is free to download and resell with — Kretase does not gate
 * or license the software itself. The optional "certificate_id" package
 * field only controls a cosmetic "Certified" badge shown to your own
 * customers via getClientServiceInfo() below; leaving it blank shows
 * nothing negative, it just omits the badge. Entering a certificate ID you
 * were not actually issued by the Kretase Core Team is a straightforward
 * misrepresentation to your customers — that's on you, not something this
 * code checks. Kretase is not responsible for the performance, uptime, or
 * support quality of any deployment, certified or not.
 */

App::uses('Module', 'Modules');

class Kretase_module extends Module
{
    public function __construct()
    {
        Language::loadLang('kretase_module', null, dirname(__FILE__) . DS . 'language' . DS);
        $this->loadConfig(dirname(__FILE__) . DS . 'config.json');
    }

    public function getName()
    {
        return Language::_('Kretase_module.name', true);
    }

    public function getVersion()
    {
        return '1.0.0';
    }

    public function getAuthors()
    {
        return [['name' => 'Kretase', 'url' => 'https://kretase.com']];
    }

    public function moduleRowName()
    {
        return Language::_('Kretase_module.module_row', true);
    }

    public function moduleRowNamePlural()
    {
        return Language::_('Kretase_module.module_row_plural', true);
    }

    public function moduleGroupName()
    {
        return Language::_('Kretase_module.module_group', true);
    }

    // The module row list is keyed/labeled by the panel URL, so admins can
    // tell panels apart if they ever manage more than one.
    public function moduleRowMetaKey()
    {
        return 'panel_url';
    }

    public function getModuleRowMetaFields()
    {
        return [
            (object) ['key' => 'panel_url', 'label' => Language::_('Kretase_module.row_meta.panel_url', true), 'type' => 'text'],
            (object) ['key' => 'api_key', 'label' => Language::_('Kretase_module.row_meta.api_key', true), 'type' => 'password'],
        ];
    }

    public function getPackageFields($vars = null)
    {
        $fields = new ModuleFields();
        $fields->setField($fields->fieldText('meta[node_id]', Language::_('Kretase_module.package_fields.node_id', true), $this->Html->ifSet($vars->meta['node_id'] ?? null)));
        $fields->setField($fields->fieldText('meta[egg_id]', Language::_('Kretase_module.package_fields.egg_id', true), $this->Html->ifSet($vars->meta['egg_id'] ?? null)));
        $fields->setField($fields->fieldText('meta[memory]', Language::_('Kretase_module.package_fields.memory', true), $this->Html->ifSet($vars->meta['memory'] ?? 2048)));
        $fields->setField($fields->fieldText('meta[disk]', Language::_('Kretase_module.package_fields.disk', true), $this->Html->ifSet($vars->meta['disk'] ?? 10000)));
        // Cosmetic only — see the note at the top of this file. Blank
        // unless this deployment was actually issued a certificate by the
        // Kretase Core Team; controls a badge in getClientServiceInfo()
        // below, nothing more.
        $fields->setField($fields->fieldText('meta[certificate_id]', Language::_('Kretase_module.package_fields.certificate_id', true), $this->Html->ifSet($vars->meta['certificate_id'] ?? null)));
        return $fields;
    }

    // Plain HTML string rather than a view-template render — keeps this
    // module to the single file, same choice made for the WHMCS variant.
    public function getClientServiceInfo($service, $package)
    {
        $serverId = $this->serviceServerId($service);
        if (!$serverId) return '';

        $moduleRow = $this->getModuleRow();
        $manageUrl = htmlspecialchars(rtrim($moduleRow->meta->panel_url, '/') . '/servers/' . $serverId, ENT_QUOTES);
        $html = '<a href="' . $manageUrl . '" target="_blank" style="display:inline-block;padding:8px 14px;background:#2E6FEE;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">' . Language::_('Kretase_module.manage_button', true) . '</a>';

        $certId = trim($package->meta->certificate_id ?? '');
        if ($certId !== '') {
            $safeCertId = htmlspecialchars($certId, ENT_QUOTES);
            $verifyUrl = 'https://kretase.com/verify.html?id=' . urlencode($certId);
            $html .= '<div style="margin-top:10px;font-size:12px;color:#2E6FEE">'
                . '&#10003; ' . Language::_('Kretase_module.certified_badge', true) . ' &mdash; <a href="' . $verifyUrl . '" target="_blank" style="color:inherit">' . $safeCertId . '</a>'
                . '</div>';
        }

        return $html;
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
            $this->Input->setErrors(['api' => ['create_user' => Language::_('Kretase_module.!error.create_user', true)]]);
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
            $message = $result['body']['message'] ?? 'Server creation failed';
            $this->Input->setErrors(['api' => ['create_server' => Language::_('Kretase_module.!error.create_server', true, $message)]]);
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
