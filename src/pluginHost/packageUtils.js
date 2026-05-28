function toText(value) {
  return String(value ?? '').trim();
}

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }
  return [];
}

function inferRiskLevel(score) {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export function buildPluginPackageFromForm(form = {}) {
  const manifest = {
    id: toText(form.id),
    name: toText(form.name),
    version: toText(form.version) || '1.0.0',
    description: toText(form.description),
    author: toText(form.author),
    homepage: toText(form.homepage),
    entry: toText(form.entry),
    permissions: toList(form.permissions),
    roles: toList(form.roles),
    backend: {
      enabled: Boolean(form.backendEnabled),
      url: toText(form.backendUrl),
      eventSubscriptions: toList(form.eventSubscriptions),
    },
  };

  const packageData = { manifest };
  if (manifest.entry) {
    packageData.entry = manifest.entry;
  }

  const moduleSource = toText(form.moduleSource);
  if (moduleSource) {
    packageData.moduleSource = moduleSource;
  }

  return packageData;
}

export function buildPluginPackageFromRecord(plugin = {}) {
  const manifest = plugin.manifest || {};
  const entry = toText(plugin.entry || manifest.entry);
  const packageData = {
    manifest: {
      id: toText(manifest.id || plugin.id),
      name: toText(manifest.name || plugin.name || plugin.id),
      version: toText(manifest.version || plugin.version || '0.0.0'),
      description: toText(manifest.description || plugin.description),
      author: toText(manifest.author || plugin.author),
      homepage: toText(manifest.homepage || ''),
      entry,
      permissions: toList(plugin.permissions || manifest.permissions),
      roles: toList(plugin.roles || manifest.roles),
      backend: {
        enabled: Boolean(plugin.backendEnabled),
        url: toText(plugin.backendUrl),
        eventSubscriptions: toList(plugin.eventSubscriptions || manifest.backend?.eventSubscriptions),
      },
    },
  };

  if (entry) {
    packageData.entry = entry;
  }

  return packageData;
}

export function serializePluginPackage(packageData) {
  return `${JSON.stringify(packageData, null, 2)}\n`;
}

export function analyzePluginPackage(packageData = {}) {
  const manifest = packageData.manifest && typeof packageData.manifest === 'object'
    ? packageData.manifest
    : packageData;
  const entry = toText(packageData.entry || manifest.entry);
  const moduleSource = toText(packageData.moduleSource);
  const permissions = toList(manifest.permissions);
  const roles = toList(manifest.roles);
  const backend = manifest.backend && typeof manifest.backend === 'object' ? manifest.backend : {};
  const backendUrl = toText(backend.url);
  const backendEvents = toList(backend.eventSubscriptions);
  const warnings = [];
  const checks = [];
  let score = 0;

  const requiredFields = [
    ['id', manifest.id],
    ['name', manifest.name],
    ['version', manifest.version],
  ];

  for (const [label, value] of requiredFields) {
    if (!toText(value)) {
      checks.push({ label, status: 'fail', detail: 'Missing required field' });
      score += 4;
    } else {
      checks.push({ label, status: 'pass', detail: toText(value) });
    }
  }

  if (!entry && !moduleSource) {
    checks.push({ label: 'entry/module', status: 'fail', detail: 'No entry URL or module source provided' });
    score += 4;
  } else if (moduleSource) {
    checks.push({ label: 'module source', status: 'pass', detail: 'Self-contained module source included' });
  } else if (entry.startsWith('/api/plugins/files/')) {
    checks.push({ label: 'entry', status: 'pass', detail: 'Local Frontdoor bundle' });
  } else {
    checks.push({ label: 'entry', status: 'warn', detail: 'External entry URL will be fetched at runtime' });
    score += 2;
    warnings.push('The plugin loads from an external entry URL.');
  }

  if (backend.enabled) {
    if (backendUrl) {
      checks.push({ label: 'backend webhook', status: 'warn', detail: backendUrl });
      score += 2;
      warnings.push('Backend webhook delivery is enabled.');
    } else {
      checks.push({ label: 'backend webhook', status: 'fail', detail: 'Backend is enabled but no URL is set' });
      score += 4;
    }
  } else {
    checks.push({ label: 'backend webhook', status: 'pass', detail: 'Disabled' });
  }

  if (permissions.length > 0) {
    const broadPermissions = permissions.filter((permission) => ['actions.write', 'routes.write', 'surfaces.write'].includes(permission));
    if (broadPermissions.length > 0) {
      checks.push({
        label: 'permissions',
        status: 'warn',
        detail: `Broad capabilities: ${broadPermissions.join(', ')}`,
      });
      score += broadPermissions.length;
      warnings.push('The package requests broad UI/runtime capabilities.');
    } else {
      checks.push({ label: 'permissions', status: 'pass', detail: permissions.join(', ') });
    }
  } else {
    checks.push({ label: 'permissions', status: 'pass', detail: 'No permissions declared' });
  }

  if (roles.length > 0) {
    checks.push({ label: 'visibility', status: 'pass', detail: roles.join(', ') });
  } else {
    checks.push({ label: 'visibility', status: 'warn', detail: 'No role restriction declared' });
    score += 1;
  }

  if (backendEvents.length > 0) {
    checks.push({ label: 'backend events', status: 'pass', detail: backendEvents.join(', ') });
  }

  const riskLevel = inferRiskLevel(score);
  if (riskLevel === 'high') {
    warnings.unshift('This package is high risk and should only be approved after a careful review.');
  } else if (riskLevel === 'medium') {
    warnings.unshift('This package has a moderate risk profile.');
  }

  return {
    valid: !checks.some((check) => check.status === 'fail'),
    riskLevel,
    score,
    warnings,
    checks,
    manifest: {
      id: toText(manifest.id),
      name: toText(manifest.name),
      version: toText(manifest.version),
      description: toText(manifest.description),
      author: toText(manifest.author),
      homepage: toText(manifest.homepage),
      permissions,
      roles,
      backend: {
        enabled: Boolean(backend.enabled),
        url: backendUrl,
        eventSubscriptions: backendEvents,
      },
    },
    summary: {
      entry: entry || 'none',
      moduleSource: Boolean(moduleSource),
      backendEnabled: Boolean(backend.enabled),
    },
  };
}
