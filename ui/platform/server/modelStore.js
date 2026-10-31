// Every connection read joins channels. Legacy connection columns are inert migration placeholders.
const selection = `SELECT m.id,m.name,m.upstream_model,m.enabled,m.input_price_micros,m.output_price_micros,
  m.max_input_tokens,m.max_output_tokens,m.capabilities,m.channel_id,
  c.name AS channel_name,c.enabled AS channel_enabled,c.provider,c.protocol,c.base_url,c.secret
  FROM models m JOIN channels c ON c.id=m.channel_id`;

export const getModel = (db, id) => db.prepare(`${selection} WHERE m.id=?`).get(id);
export const listModels = db => db.prepare(`${selection} ORDER BY m.name,m.id`).all();
export const canonicalModelName = (protocol, name) => protocol === 'google' ? name.replace(/^models\//, '') : name;

export function publicModel(db, row) {
  return {
    id: row.id, name: row.name, channelId: row.channel_id, channelName: row.channel_name,
    channelEnabled: Boolean(row.channel_enabled),
    provider: row.provider, protocol: row.protocol, baseUrl: row.base_url, hasApiKey: Boolean(row.secret),
    upstreamModel: row.upstream_model, enabled: Boolean(row.enabled),
    inputPriceMicros: row.input_price_micros, outputPriceMicros: row.output_price_micros,
    maxInputTokens: row.max_input_tokens, maxOutputTokens: row.max_output_tokens,
    capabilities: JSON.parse(row.capabilities),
    appIds: db.prepare('SELECT id,model_ids FROM apps ORDER BY rowid').all()
      .filter(app => JSON.parse(app.model_ids).includes(row.id)).map(app => app.id),
  };
}
