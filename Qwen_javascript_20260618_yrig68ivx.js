/**
 * FAST LIFE - Proxy Backend para APIs DATASUS/IBGE/CNES
 * Contorna CORS e faz cache inteligente
 */
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Cache em memória com TTL
const cache = new Map();
const TTL = { pop: 86400000, cnes: 21600000, sinan: 1800000, geo: 604800000 };

const getCache = (k, ttl) => {
  const e = cache.get(k);
  if (!e || Date.now() - e.ts > ttl) { cache.delete(k); return null; }
  return e.data;
};
const setCache = (k, d) => cache.set(k, { data: d, ts: Date.now() });

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), cache: cache.size });
});

// Lista de estados (IBGE)
app.get('/api/ibge/estados', async (req, res) => {
  const k = 'ibge_estados';
  const c = getCache(k, TTL.geo);
  if (c) return res.json(c);
  try {
    const r = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
    const d = await r.json();
    setCache(k, d);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// População (SIDRA - Censo 2022)
app.get('/api/ibge/populacao/:uf', async (req, res) => {
  const uf = req.params.uf.toUpperCase();
  const k = `pop_${uf}`;
  const c = getCache(k, TTL.pop);
  if (c) return res.json(c);
  try {
    let url;
    if (uf === 'BR') {
      url = 'https://apisidra.ibge.gov.br/values/t/6579/n1/all/v/93?c61=2022';
    } else {
      const estR = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      const estados = await estR.json();
      const estado = estados.find(e => e.sigla === uf);
      if (!estado) return res.status(404).json({ error: 'UF não encontrada' });
      url = `https://apisidra.ibge.gov.br/values/t/6579/n3/${estado.id}/v/93?c61=2022`;
    }
    const r = await fetch(url);
    const data = await r.json();
    const total = data.reduce((s, r) => s + (parseInt(r.V) || 0), 0);
    const result = { uf, populacao: total, fonte: 'IBGE/SIDRA Censo 2022' };
    setCache(k, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CNES Estabelecimentos
app.get('/api/cnes/estabelecimentos/:uf', async (req, res) => {
  const uf = req.params.uf.toUpperCase();
  const k = `cnes_estab_${uf}`;
  const c = getCache(k, TTL.cnes);
  if (c) return res.json(c);
  try {
    const url = uf === 'BR'
      ? 'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos'
      : `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?UF=${uf}`;
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    const data = await r.json();
    const total = Array.isArray(data) ? data.length : 0;
    const result = { uf, estabelecimentos: total, fonte: 'DATASUS/CNES' };
    setCache(k, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CNES Leitos
app.get('/api/cnes/leitos/:uf', async (req, res) => {
  const uf = req.params.uf.toUpperCase();
  const k = `cnes_leitos_${uf}`;
  const c = getCache(k, TTL.cnes);
  if (c) return res.json(c);
  try {
    const url = uf === 'BR'
      ? 'https://apidadosabertos.saude.gov.br/cnes/leitos'
      : `https://apidadosabertos.saude.gov.br/cnes/leitos?UF=${uf}`;
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    const data = await r.json();
    const total = Array.isArray(data) ? data.length : 0;
    const result = { uf, leitos: total, fonte: 'DATASUS/CNES' };
    setCache(k, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SINAN Casos
app.get('/api/sinan/casos/:uf/:cid/:ano', async (req, res) => {
  const { uf, cid, ano } = req.params;
  const k = `sinan_${uf}_${cid}_${ano}`;
  const c = getCache(k, TTL.sinan);
  if (c) return res.json(c);
  try {
    const url = `https://apidadosabertos.saude.gov.br/cases/arboviroses?UF=${uf}&CID=${cid}&ANO=${ano}`;
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    const data = await r.json();
    const total = Array.isArray(data) ? data.reduce((s, r) => s + (r.casos || 0), 0) : (data.total || 0);
    const result = { uf, cid, ano, casos: total, fonte: 'DATASUS/SINAN' };
    setCache(k, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 FAST LIFE rodando em http://localhost:${PORT}`);
});