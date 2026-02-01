const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;
const CONFIG_PATH = path.join(__dirname, '../config/sources.json');
const LOG_PATH = path.join(__dirname, '../logs/app.log');
const HISTORY_PATH = path.join(__dirname, '../data/history.json');

// Авторизация
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

// Логирование
async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logLine = JSON.stringify({ timestamp, level, message, ...meta }) + '\n';

  // Консоль
  const prefix = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
  console.log(`${prefix}[${timestamp}] [${level}]\x1b[0m ${message}`, Object.keys(meta).length ? meta : '');

  // Файл (async)
  ensureDir(LOG_PATH).then(() => {
    fs.appendFile(LOG_PATH, logLine).catch(() => {});
  });
}

// Basic Auth middleware
function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Photo Saver Admin"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    next();
  } else {
    log('WARN', 'Failed login attempt', { username, ip: req.ip });
    res.setHeader('WWW-Authenticate', 'Basic realm="Photo Saver Admin"');
    return res.status(401).send('Invalid credentials');
  }
}

app.use(express.json());

// Health check (без авторизации для мониторинга)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use(basicAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Загрузить конфиг
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { sources: [] };
  }
}

// Сохранить конфиг
async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Загрузить историю
async function loadHistory() {
  try {
    await ensureDir(HISTORY_PATH);
    const data = await fs.readFile(HISTORY_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Сохранить историю
async function saveHistory(history) {
  await ensureDir(HISTORY_PATH);
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// Скачать изображение
async function downloadImage(source) {
  const outputDir = path.resolve(__dirname, '..', source.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const imageBuffer = await response.arrayBuffer();
  const date = new Date();
  const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;

  let extension = 'jpg';
  const urlExtension = source.url.split('.').pop().split('?')[0].toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(urlExtension)) {
    extension = urlExtension;
  }

  const fileName = `${source.id}-${formattedDate}.${extension}`;
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, Buffer.from(imageBuffer));

  return { fileName, outputPath, size: imageBuffer.byteLength };
}

// Планировщик
const scheduledJobs = new Map();
let jobHistory = {};

async function addHistoryEntry(sourceId, entry) {
  if (!jobHistory[sourceId]) jobHistory[sourceId] = [];
  jobHistory[sourceId].unshift(entry);
  if (jobHistory[sourceId].length > 50) jobHistory[sourceId].pop();
  await saveHistory(jobHistory);
}

function scheduleJob(source) {
  if (scheduledJobs.has(source.id)) {
    clearInterval(scheduledJobs.get(source.id).interval);
  }

  if (!source.enabled) {
    scheduledJobs.delete(source.id);
    log('INFO', `Job disabled: ${source.id}`);
    return;
  }

  const runJob = async () => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      status: 'running'
    };

    try {
      const result = await downloadImage(source);
      logEntry.status = 'success';
      logEntry.fileName = result.fileName;
      logEntry.size = result.size;
      log('INFO', `Downloaded: ${result.fileName}`, { source: source.id, size: result.size });
    } catch (error) {
      logEntry.status = 'error';
      logEntry.error = error.message;
      log('ERROR', `Download failed: ${source.id}`, { error: error.message });
    }

    await addHistoryEntry(source.id, logEntry);

    // Обновить время следующего запуска
    if (scheduledJobs.has(source.id)) {
      scheduledJobs.get(source.id).nextRun = new Date(Date.now() + source.intervalMinutes * 60 * 1000);
    }
  };

  // Запуск сразу при старте
  runJob();

  const interval = setInterval(runJob, source.intervalMinutes * 60 * 1000);
  scheduledJobs.set(source.id, {
    interval,
    source,
    nextRun: new Date(Date.now() + source.intervalMinutes * 60 * 1000)
  });

  log('INFO', `Job scheduled: ${source.id}`, { interval: `${source.intervalMinutes}min` });
}

async function initScheduler() {
  jobHistory = await loadHistory();
  const config = await loadConfig();
  for (const source of config.sources) {
    scheduleJob(source);
  }
  log('INFO', `Scheduler initialized`, { sources: config.sources.length });
}

// API endpoints

// Получить все источники
app.get('/api/sources', async (req, res) => {
  const config = await loadConfig();
  const sourcesWithStatus = config.sources.map(source => ({
    ...source,
    isRunning: scheduledJobs.has(source.id),
    nextRun: scheduledJobs.get(source.id)?.nextRun,
    history: jobHistory[source.id] || []
  }));
  res.json(sourcesWithStatus);
});

// Получить логи
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await fs.readFile(LOG_PATH, 'utf-8');
    const lines = logs.trim().split('\n').slice(-100);
    res.json(lines.map(l => JSON.parse(l)));
  } catch {
    res.json([]);
  }
});

// Добавить источник
app.post('/api/sources', async (req, res) => {
  const config = await loadConfig();
  const { name, url, outputDir, intervalMinutes } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (config.sources.find(s => s.id === id)) {
    return res.status(400).json({ error: 'Source with this name already exists' });
  }

  const source = {
    id,
    name,
    url,
    outputDir: outputDir || `./images/${id}`,
    intervalMinutes: intervalMinutes || 60,
    enabled: true
  };

  config.sources.push(source);
  await saveConfig(config);
  scheduleJob(source);

  log('INFO', `Source added: ${source.id}`, { url: source.url });

  res.json(source);
});

// Обновить источник
app.put('/api/sources/:id', async (req, res) => {
  const config = await loadConfig();
  const index = config.sources.findIndex(s => s.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const updated = { ...config.sources[index], ...req.body, id: req.params.id };
  config.sources[index] = updated;
  await saveConfig(config);
  scheduleJob(updated);

  log('INFO', `Source updated: ${updated.id}`);

  res.json(updated);
});

// Удалить источник
app.delete('/api/sources/:id', async (req, res) => {
  const config = await loadConfig();
  const index = config.sources.findIndex(s => s.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Source not found' });
  }

  if (scheduledJobs.has(req.params.id)) {
    clearInterval(scheduledJobs.get(req.params.id).interval);
    scheduledJobs.delete(req.params.id);
  }

  config.sources.splice(index, 1);
  await saveConfig(config);

  log('INFO', `Source deleted: ${req.params.id}`);

  res.json({ success: true });
});

// Запустить задачу вручную
app.post('/api/sources/:id/run', async (req, res) => {
  const config = await loadConfig();
  const source = config.sources.find(s => s.id === req.params.id);

  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  try {
    const result = await downloadImage(source);
    await addHistoryEntry(source.id, {
      timestamp: new Date().toISOString(),
      status: 'success',
      fileName: result.fileName,
      size: result.size,
      manual: true
    });

    log('INFO', `Manual download: ${result.fileName}`, { source: source.id });

    res.json({ success: true, ...result });
  } catch (error) {
    log('ERROR', `Manual download failed: ${source.id}`, { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Включить/выключить источник
app.post('/api/sources/:id/toggle', async (req, res) => {
  const config = await loadConfig();
  const source = config.sources.find(s => s.id === req.params.id);

  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  source.enabled = !source.enabled;
  await saveConfig(config);
  scheduleJob(source);

  log('INFO', `Source toggled: ${source.id}`, { enabled: source.enabled });

  res.json(source);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  log('INFO', `Admin panel started`, { port: PORT });
  initScheduler();
});
