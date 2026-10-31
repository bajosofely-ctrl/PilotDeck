// Shared by the two standalone learning pages; all model calls stay same-origin.
export function createManagedSettings({ onChange, onStatus }) {
  const $ = id => document.getElementById(id);
  let mode = 'loading';
  let models = [];
  let loading = false;
  const price = value => (value / 1_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  function updatePrice() {
    const model = models.find(item => item.id === $('managed-model').value);
    $('managed-price').textContent = model
      ? `输入 ${price(model.inputPriceMicros)} 元 / 百万 Token；输出 ${price(model.outputPriceMicros)} 元 / 百万 Token。按实际用量计费。`
      : '暂无可用的学习模型，请联系管理员。';
  }
  async function load() {
    if (loading) return;
    loading = true;
    mode = 'loading';
    onChange(null);
    $('settings-apply').disabled = true;
    $('managed-refresh').disabled = true;
    $('managed-settings').hidden = true;
    const local = $('local-settings');
    if (local) { local.hidden = true; local.disabled = true; }
    $('managed-status').textContent = '正在读取模型设置…';
    try {
      const response = await fetch('/api/managed/config', {
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok || typeof data.managed !== 'boolean') throw new Error('Configuration unavailable.');
      if (data.managed) {
        if (!Array.isArray(data.models) || data.models.some(item => !item || typeof item.id !== 'string'
            || typeof item.name !== 'string' || !Number.isSafeInteger(item.inputPriceMicros)
            || !Number.isSafeInteger(item.outputPriceMicros))) throw new Error('Invalid model list.');
        mode = 'managed';
        models = data.models;
        local?.remove();
        if ($('clear-key')) $('clear-key').hidden = true;
        $('managed-model').replaceChildren(...models.map(item => new Option(`${item.name} (${item.id})`, item.id)));
        $('managed-model').value = models.find(item => item.id === data.defaultModelId)?.id || models[0]?.id || '';
        $('managed-model').disabled = !models.length;
        $('managed-settings').hidden = false;
        $('settings-apply').disabled = !models.length;
        updatePrice();
        onChange(models.length ? { modelId: $('managed-model').value } : null);
        $('managed-status').textContent = models.length ? '账户托管模型' : '暂无可用的学习模型，请联系管理员。';
      } else {
        // A live page cannot downgrade after it has received managed settings.
        if (!local) throw new Error('Managed mode changed; reload required.');
        mode = 'local';
        local.hidden = false;
        local.disabled = false;
        $('settings-apply').disabled = false;
        $('managed-status').textContent = '本地模式 · 独立模型配置';
      }
      onStatus($('managed-status').textContent);
    } catch {
      mode = 'error';
      $('managed-status').textContent = '无法读取模型设置，请重试。';
      onStatus($('managed-status').textContent);
    } finally {
      loading = false;
      $('managed-refresh').disabled = false;
    }
  }
  $('managed-model').onchange = updatePrice;
  $('managed-refresh').onclick = load;
  load();
  return {
    get mode() { return mode; },
    selection() {
      return mode === 'managed' && models.some(item => item.id === $('managed-model').value)
        ? { modelId: $('managed-model').value } : null;
    },
  };
}
