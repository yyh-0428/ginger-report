// ── 全局状态 ──────────────────────────────────────────
const STATE = {
  mode: 'csv',
  rawData: null,        // { self: [], partner: [] } — messages array
  stats: null,          // computed statistics
  charts: {},           // ECharts instances
  personality: null,    // AI analysis result
};

// ── 中文停用词 ────────────────────────────────────────
const STOPWORDS = new Set([
  '的','了','是','在','我','你','他','她','它','们','这','那','就','都','和','与',
  '但','也','很','有','没','不','一','个','上','对','说','好','要','么','啊','呢',
  '吧','哦','嗯','然后','所以','因为','如果','可以','还是','已经','什么','怎么',
  '为什么','就是','还有','其实','感觉','觉得','现在','时候','一个','这个','那个',
  '一下','一起','一直','一样','一点','一些','知道','真的','看到','会','能','去',
  '来','还','被','让','给','把','做','做','做','做','用','想','看','应该','已经',
  '之后','之前','不过','而且','但是','虽然','可是','好像','真的','非常','比较',
  '有点','挺','太','很','特别','最近','上次','今天','明天','昨天',
]);

// ── UI 交互 ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      STATE.mode = t.dataset.mode;
      document.getElementById('uploadPanel').style.display = STATE.mode === 'manual' ? 'none' : 'block';
      document.getElementById('manualPanel').style.display = STATE.mode === 'manual' ? 'block' : 'none';
      updateUploadHint();
    });
  });

  // Upload zone
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });

  // Init manual
  addMsgEntry(); addMsgEntry(); addMsgEntry();
});

function updateUploadHint() {
  const hints = {
    csv: 'CSV 格式：需含 timestamp/datetime、sender/is_sender、content 列',
    json: 'JSON 格式：{messages:[{timestamp,is_sender,content},...]}',
    txt: 'TXT 格式：每行一条消息，格式 "发送者: 内容" 或 "时间 发送者 内容"',
    md: 'Markdown 格式：聊天导出 .md 文件',
  };
  document.getElementById('uploadHint').textContent = hints[STATE.mode] || '支持 CSV / JSON / TXT / Markdown 格式';
}

function handleFile(file) {
  document.getElementById('uploadFileName').textContent = '📎 ' + file.name;
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    let parsed = false;
    // Try all parsers in order: prefer extension, then try all as fallback
    const parsers = [];
    if (ext === 'csv' || STATE.mode === 'csv') parsers.push(parseCSV);
    if (ext === 'json' || STATE.mode === 'json') parsers.push(parseJSON);
    if (ext === 'md' || ext === 'markdown' || STATE.mode === 'md') parsers.push(parseMarkdown);
    parsers.push(parseTXT);
    // Also try other parsers as fallback if primary fails
    [parseCSV, parseJSON, parseTXT, parseMarkdown].forEach(p => { if (!parsers.includes(p)) parsers.push(p); });

    for (const parseFn of parsers) {
      try {
        STATE.rawData = { self: [], partner: [] };
        parseFn(text);
        const total = STATE.rawData.self.length + STATE.rawData.partner.length;
        if (total >= 5) {
          toast('✅ 文件已加载，共 ' + total + ' 条消息');
          parsed = true;
          break;
        }
      } catch { /* try next parser */ }
    }
    if (!parsed) {
      STATE.rawData = null;
      toast('❌ 无法解析此文件，请检查格式（支持 CSV/JSON/TXT/Markdown）');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function toggleAI() {
  document.getElementById('aiConfig').classList.toggle('show',
    document.getElementById('aiEnabled').checked);
}

// ── Manual input ─────────────────────────────────────
function addMsgEntry() {
  const container = document.getElementById('msgEntries');
  const div = document.createElement('div');
  div.className = 'msg-entry';
  div.innerHTML = `
    <select>
      <option value="self">我</option>
      <option value="partner">对方</option>
    </select>
    <input type="text" placeholder="输入消息内容...">
    <button onclick="this.parentElement.remove()">🗑</button>
  `;
  container.appendChild(div);
}

// ── 消息解析 ──────────────────────────────────────────

function parseCSV(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV 文件为空或只有表头');

  // Auto-detect header
  const header = lines[0].toLowerCase();
  const hasHeader = /timestamp|datetime|content|sender|is_sender/i.test(header);

  let colMap = {};
  const dataStart = hasHeader ? 1 : 0;

  if (hasHeader) {
    const cols = parseCSVLine(lines[0]);
    cols.forEach((c, i) => {
      const cl = c.trim().toLowerCase().replace(/['"]/g, '');
      if (/timestamp|create_time|createtime|ts/.test(cl)) colMap.ts = i;
      else if (/datetime|date/.test(cl)) colMap.datetime = i;
      else if (/content|message|text|msg/.test(cl)) colMap.content = i;
      else if (/is_sender|issender|sender_id/.test(cl)) colMap.isSender = i;
      else if (/sender|name|user/.test(cl) && colMap.sender === undefined) colMap.sender = i;
      else if (/type|msg_type/.test(cl)) colMap.type = i;
    });
  } else {
    // No header — try positional guess: timestamp, sender, content
    colMap = { ts: 0, sender: 1, content: 2, isSender: -1 };
  }

  if (colMap.content === undefined) {
    // Fallback: assume last column is content
    const firstLine = parseCSVLine(lines[dataStart]);
    colMap.content = firstLine.length - 1;
  }

  // Validate content column — check first few data rows actually have text
  let validContent = 0;
  for (let i = dataStart; i < Math.min(dataStart + 5, lines.length); i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols[colMap.content] && cols[colMap.content].trim().length > 0) validContent++;
  }
  if (validContent === 0) {
    // Content column is wrong — try each column to find the one with text
    const firstLine = parseCSVLine(lines[dataStart]);
    for (let c = 0; c < firstLine.length; c++) {
      if (firstLine[c] && firstLine[c].trim().length > 1) {
        colMap.content = c;
        break;
      }
    }
  }

  STATE.rawData = { self: [], partner: [] };

  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols.length) continue;
    const content = (cols[colMap.content] || '').trim();
    if (!content) continue;

    let ts, isSelf = null;

    // Time
    if (colMap.ts !== undefined && cols[colMap.ts]) {
      const v = cols[colMap.ts].trim();
      ts = /^\d+$/.test(v) ? parseInt(v) : new Date(v).getTime() / 1000;
    }

    // is_sender
    if (colMap.isSender !== undefined) {
      const v = cols[colMap.isSender].trim();
      isSelf = v === '1' || v === 'true' || v === '我' || /self|me/i.test(v);
    } else if (colMap.sender !== undefined) {
      const senderName = cols[colMap.sender].trim();
      isSelf = senderName === '我' || senderName === document.getElementById('selfName').value;
    }

    if (isSelf === null) {
      // No sender info — assign alternating or detect from name
      isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
    }

    if (colMap.type !== undefined) {
      const t = cols[colMap.type].trim();
      if (t && t !== '1' && t !== 'text') continue; // non-text message
    }

    const msg = { content: cleanMessage(content), ts };
    if (isSelf) STATE.rawData.self.push(msg);
    else STATE.rawData.partner.push(msg);
  }

  if (STATE.rawData.self.length < 2 && STATE.rawData.partner.length < 2) {
    throw new Error('解析出的消息太少，请检查 CSV 格式');
  }
}

function cleanMessage(text) {
  return text
    .replace(/\[([A-Za-z]+)\]/g, (_, name) => EMOJI_MAP[name] || EMOJI_MAP[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()] || '[' + name + ']')
    .replace(/\s+/g, ' ').trim();
}

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

function parseJSON(raw) {
  const data = JSON.parse(raw);
  const messages = Array.isArray(data) ? data : (data.messages || data.data || data.chat || data.records || []);

  STATE.rawData = { self: [], partner: [] };
  for (const m of messages) {
    const content = cleanMessage(String(m.content || m.text || m.message || m.msg || ''));
    if (!content) continue;
    const isSelf = m.is_sender !== undefined
      ? (m.is_sender === 1 || m.is_sender === true || m.isSender === 1 || m.isSender === true || m.isSelf || m.is_self)
      : (STATE.rawData.self.length <= STATE.rawData.partner.length);

    let ts;
    if (m.timestamp) ts = /^\d{10,13}$/.test(String(m.timestamp)) ? parseInt(m.timestamp) : new Date(m.timestamp).getTime() / 1000;
    else if (m.datetime) ts = new Date(m.datetime).getTime() / 1000;
    else if (m.create_time) ts = parseInt(m.create_time);
    else if (m.ts) ts = parseInt(m.ts);

    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content, ts });
  }
  if (STATE.rawData.self.length < 2 && STATE.rawData.partner.length < 2) {
    throw new Error('JSON 中消息数量不足');
  }
}

function parseTXT(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  STATE.rawData = { self: [], partner: [] };

  // Common patterns: "Name: message", "Name - message", "YYYY-MM-DD HH:MM Name message"
  const patterns = [
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)[：:]\s*(.+)$/,  // 时间 名称: 内容
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)\s+(.+)$/,        // 时间 名称 内容
    /^(.+?)[：:]\s*(.+)$/,                                                                    // 名称: 内容
    /^(.+?)\s+-\s+(.+)$/,                                                                     // 名称 - 内容
    /^(.+?)\s{2,}(.+)$/,                                                                      // 名称  内容（多空格）
  ];

  for (const line of lines) {
    let matched = false;
    for (const re of patterns) {
      const m = line.match(re);
      if (m) {
        const sender = m[1].trim();
        const content = cleanMessage(m[2].trim());
        if (!content) break;
        const isSelf = sender === '我' || sender === (document.getElementById('selfName').value || '我');
        (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content, ts: null });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Treat as one person's message, alternating
      const content = cleanMessage(line);
      if (content) {
        const isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
        (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content, ts: null });
      }
    }
  }
  if (STATE.rawData.self.length < 2 && STATE.rawData.partner.length < 2) {
    throw new Error('TXT 解析失败，请使用"发送者: 内容"格式，每行一条');
  }
}

function parseMarkdown(raw) {
  // Extract messages from markdown
  const lines = raw.split(/\r?\n/);
  STATE.rawData = { self: [], partner: [] };

  // Pattern: "**Name**: message" or "- **Name**: message"
  const mdPattern = /^\s*(?:[-*]\s+)?(?:\*\*|__)?(.+?)(?:\*\*|__)?[：:]\s*(.+)$/;
  // Pattern for quoted chats
  const quotePattern = /^>\s*(.+?)[：:]\s*(.+)$/;

  for (const line of lines) {
    let m = line.match(mdPattern) || line.match(quotePattern);
    if (m) {
      const sender = m[1].trim();
      const content = cleanMessage(m[2].trim());
      if (!content) continue;
      const isSelf = sender === '我' || sender === (document.getElementById('selfName').value || '我');
      (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content, ts: null });
    }
  }
  if (STATE.rawData.self.length < 2 && STATE.rawData.partner.length < 2) {
    throw new Error('Markdown 解析失败，请确认格式为"**名称**: 内容"');
  }
}

// ── Emoji map ────────────────────────────────────────
const EMOJI_MAP = {
  Smile:'😊',Grin:'😁',Laugh:'😂',Joy:'😄',Chuckle:'😄',Lol:'🤣',Blush:'☺️',Smirk:'😏',Wink:'😉',
  Tongue:'😛',Cool:'😎',Angel:'😇',Hehe:'😄',Toothy:'😁',Naughty:'😝',
  Cry:'😢',Sob:'😭',Weep:'😢',Whimper:'😥',Wronged:'🥺',Pout:'😔',Frown:'🙁',Sad:'😞',
  Surprised:'😯',Shock:'😱',Wow:'😲',Confused:'😕',Question:'🤔',Think:'🤔',Speechless:'😶',Awkward:'😅',Sweat:'😅',
  Scowl:'😡',Angry:'😠',Rage:'🤬',Grimace:'😬',Disdain:'😒',Bored:'😒',
  Sleep:'😴',Drowsy:'😪',Sleepy:'😪',Yawn:'🥱',Dead:'💀',Skull:'💀',Zombie:'🧟',
  Shy:'🙈',Embarrassed:'😳',Sneaky:'🤭',Insidious:'😏',Trick:'😜',
  Clap:'👏',Wave:'👋',Pray:'🙏',ThumbsUp:'👍',ThumbsDown:'👎',Ok:'👌',Victory:'✌️',Salute:'🫡',Fist:'✊',Muscle:'💪',Handshake:'🤝',Hug:'🤗',
  Drool:'🤤',Vomit:'🤮',Sick:'🤒',Flower:'🌹',Heart:'❤️',BrokenHeart:'💔',Star:'⭐',Fire:'🔥',Ghost:'👻',Poop:'💩',
  Kneeling:'🧎',Worship:'🙇',Facepalm:'🤦',Shrug:'🤷',Strong:'💪',Ok:'👌',Triumph:'😤',
  ['[Grin]']:'😁',['[Smile]']:'😊',['[Laugh]']:'😂',['[Cry]']:'😢',['[Sob]']:'😭',
};

// ── 中文分词 (N-gram + 词典) ─────────────────────────

function segmentChinese(text) {
  // Mixed approach: character bigrams/trigrams + stopword filtering
  const clean = text.replace(/[^\u4e00-\u9fff\w]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = clean.replace(/\s/g, '');
  const words = [];

  // Bigrams
  for (let i = 0; i < chars.length - 1; i++) {
    const bigram = chars.substring(i, i + 2);
    if (!STOPWORDS.has(bigram) && !/^\d+$/.test(bigram)) words.push(bigram);
  }
  // Trigram
  for (let i = 0; i < chars.length - 2; i++) {
    const trigram = chars.substring(i, i + 3);
    if (!STOPWORDS.has(trigram) && !/^\d+$/.test(trigram)) words.push(trigram);
  }
  // Single chars (for completeness)
  for (const ch of chars) {
    if (!STOPWORDS.has(ch) && ch.charCodeAt(0) > 127) words.push(ch);
  }
  return words;
}

// ── 统计计算 ──────────────────────────────────────────

function computeStats() {
  if (!STATE.rawData) throw new Error('请先上传聊天数据');

  const selfMsgs = STATE.rawData.self;
  const partnerMsgs = STATE.rawData.partner;
  const allRaw = [...selfMsgs, ...partnerMsgs];

  if (selfMsgs.length < 5) throw new Error('自己消息数量不足（需要至少 5 条）');

  // ── Self stats ──
  const selfText = selfMsgs.map(m => m.content);
  const selfAllText = selfText.join(' ');
  const selfWords = segmentChinese(selfAllText);
  const selfWordFreq = {};
  selfWords.forEach(w => { selfWordFreq[w] = (selfWordFreq[w] || 0) + 1; });

  // Time analysis
  const timestamps = selfMsgs.map(m => m.ts).filter(t => t != null);
  let timeRange = null;
  if (timestamps.length > 0) {
    timestamps.sort((a, b) => a - b);
    timeRange = { start: new Date(timestamps[0] * 1000), end: new Date(timestamps[timestamps.length - 1] * 1000) };
  }

  const hourly = new Array(24).fill(0);
  const weekday = new Array(7).fill(0);
  const daily = {};
  const monthly = {};

  selfMsgs.forEach(m => {
    if (m.ts) {
      const d = new Date(m.ts * 1000);
      hourly[d.getHours()]++;
      weekday[(d.getDay() + 6) % 7]++; // Mon=0
      const dateKey = d.toISOString().split('T')[0];
      daily[dateKey] = (daily[dateKey] || 0) + 1;
      const monthKey = dateKey.substring(0, 7);
      monthly[monthKey] = (monthly[monthKey] || 0) + 1;
    }
  });

  const lengths = selfText.map(t => t.length);
  const avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);

  // ── Partner stats ──
  let partnerStats = null;
  if (partnerMsgs.length >= 10) {
    const pText = partnerMsgs.map(m => m.content);
    const pAllText = pText.join(' ');
    const pWords = segmentChinese(pAllText);
    const pWordFreq = {};
    pWords.forEach(w => { pWordFreq[w] = (pWordFreq[w] || 0) + 1; });

    const pDaily = {};
    const pHourly = new Array(24).fill(0);
    partnerMsgs.forEach(m => {
      if (m.ts) {
        const d = new Date(m.ts * 1000);
        pHourly[d.getHours()]++;
        pDaily[d.toISOString().split('T')[0]] = (pDaily[d.toISOString().split('T')[0]] || 0) + 1;
      }
    });

    const pMonthly = {};
    const pWeekday = new Array(7).fill(0);
    partnerMsgs.forEach(m => {
      if (m.ts) {
        const d = new Date(m.ts * 1000);
        pWeekday[(d.getDay() + 6) % 7]++;
        const monthKey = d.toISOString().split('T')[0].substring(0, 7);
        pMonthly[monthKey] = (pMonthly[monthKey] || 0) + 1;
      }
    });

    partnerStats = {
      total: partnerMsgs.length,
      wordFreq: pWordFreq,
      daily: pDaily,
      hourly: pHourly,
      weekday: pWeekday,
      monthly: pMonthly,
    };
  }

  // Sort word freq
  const topWordsSelf = Object.entries(selfWordFreq).sort((a, b) => b[1] - a[1]).slice(0, 100);

  STATE.stats = {
    self: {
      total: selfMsgs.length,
      avgLength,
      wordFreq: selfWordFreq,
      topWords: topWordsSelf,
      hourly,
      weekday,
      daily,
      monthly,
      lengths,
      timeRange,
    },
    partner: partnerStats,
    hasPartner: !!partnerStats,
  };
}

// ── 图表生成 (ECharts) ──────────────────────────────

function createCharts(containerId) {
  // Dispose old chart instances and clean up year switchers
  Object.values(STATE.charts).forEach(c => { try { c.dispose(); } catch {} });
  STATE.charts = {};

  const s = STATE.stats.self;
  const container = document.getElementById(containerId);
  const theme = { textColor: '#5a4a3a', accent: '#c68642', brown: '#8b5e3c', teal: '#6faa9c' };

  // Clean up stale year switchers from previous renders
  container.querySelectorAll('.hm-year-switcher').forEach(el => el.remove());

  // Hourly chart
  function chartHourly() {
    const el = container.querySelector('#chart-hourly');
    if (!el) return;
    const chart = echarts.init(el);
    const peak = s.hourly.indexOf(Math.max(...s.hourly));
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 40, right: 20, bottom: 30, left: 50 },
      title: { text: '几点最爱发消息？', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
      xAxis: { type: 'category', data: Array.from({length:24},(_,i)=>i+':00'), axisLabel: { rotate: 45, fontSize: 10, interval: 3 } },
      yAxis: { type: 'value', name: '消息数' },
      series: [{
        type: 'bar', data: s.hourly.map((v, i) => ({
          value: v,
          itemStyle: { color: i === peak ? theme.accent : theme.brown, borderRadius: [4,4,0,0] }
        })),
        markArea: {
          silent: true,
          data: [[{ xAxis: '0:00' }, { xAxis: '6:00', itemStyle: { color: 'rgba(0,0,50,.04)' } }],
                 [{ xAxis: '22:00' }, { xAxis: '23:00', itemStyle: { color: 'rgba(0,0,50,.04)' } }]]
        }
      }]
    });
    STATE.charts.hourly = chart;
  }

  // Monthly trend
  function chartMonthly() {
    const el = container.querySelector('#chart-monthly');
    if (!el) return;
    const chart = echarts.init(el);
    const months = Object.keys(s.monthly).sort();
    if (months.length === 0) return;
    const values = months.map(k => s.monthly[k]);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 40, right: 20, bottom: 30, left: 50 },
      title: { text: '每月消息量变化', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
      xAxis: { type: 'category', data: months, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: 'value', name: '消息数' },
      series: [{
        type: 'line', data: values,
        lineStyle: { color: theme.brown, width: 2 },
        itemStyle: { color: theme.brown },
        areaStyle: { color: 'rgba(139,94,60,.12)' },
        smooth: true
      }]
    });
    STATE.charts.monthly = chart;
  }

  // Weekday bar
  function chartWeekday() {
    const el = container.querySelector('#chart-weekday');
    if (!el) return;
    const chart = echarts.init(el);
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 40, right: 20, bottom: 30, left: 50 },
      title: { text: '哪天最活跃？', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
      xAxis: { type: 'category', data: days },
      yAxis: { type: 'value', name: '消息数' },
      series: [{
        type: 'bar',
        data: s.weekday.map((v, i) => ({
          value: v,
          itemStyle: { color: i >= 5 ? theme.accent : theme.brown, borderRadius: [4,4,0,0] }
        }))
      }]
    });
    STATE.charts.weekday = chart;
  }

  // Length distribution
  function chartLengthDist() {
    const el = container.querySelector('#chart-length');
    if (!el) return;
    const chart = echarts.init(el);
    const clamped = s.lengths.map(l => Math.min(l, 200));
    const bins = 30;
    const max = Math.max(...clamped, 1);
    const step = max / bins;
    const dist = new Array(bins).fill(0);
    clamped.forEach(l => { const i = Math.min(Math.floor(l / step), bins - 1); dist[i]++; });
    const avg = s.avgLength;
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { top: 40, right: 20, bottom: 30, left: 50 },
      title: { text: '消息长度分布', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
      xAxis: { type: 'category', data: Array.from({length:bins},(_,i)=>Math.round(i*step)), axisLabel: { fontSize: 9, interval: 4 } },
      yAxis: { type: 'value', name: '条数' },
      series: [{
        type: 'bar', data: dist,
        itemStyle: { color: theme.brown, borderRadius: [3,3,0,0] },
        markLine: { silent: true, data: [{ xAxis: Math.round(avg/step), label: { formatter: `平均 ${avg}字`, color: theme.accent }, lineStyle: { color: theme.accent, type: 'dashed' } }] }
      }]
    });
    STATE.charts.length = chart;
  }

  // Word cloud
  function chartWordCloud(elId, wordFreq, title) {
    const el = container.querySelector('#' + elId);
    if (!el) return;
    const chart = echarts.init(el);
    const data = Object.entries(wordFreq).slice(0, 80).map(([name, value]) => ({
      name, value: Math.log(value + 1) * 10
    }));
    if (data.length === 0) return;
    chart.setOption({
      tooltip: { show: true },
      title: { text: title, left: 'center', top: 6, textStyle: { fontSize: 14, color: theme.textColor } },
      series: [{
        type: 'wordCloud',
        shape: 'circle',
        sizeRange: [12, 50],
        rotationRange: [-45, 45],
        gridSize: 8,
        drawOutOfBound: false,
        textStyle: {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontWeight: 'normal',
          color: () => ['#8b5e3c','#c68642','#d4956a','#e8c49a','#4a7b6f','#6faa9c','#8abfb8'][Math.floor(Math.random()*7)]
        },
        data
      }]
    });
    STATE.charts[elId] = chart;
  }

  // Big5 radar
  function chartBig5Radar(scores) {
    const el = container.querySelector('#chart-radar');
    if (!el || !scores) return;
    const chart = echarts.init(el);
    chart.setOption({
      title: { text: '大五人格 · 雷达图', left: 'center', top: 6, textStyle: { fontSize: 14, color: theme.textColor } },
      radar: {
        indicator: [
          { name: '开放性', max: 100 }, { name: '尽责性', max: 100 },
          { name: '外倾性', max: 100 }, { name: '宜人性', max: 100 }, { name: '神经质', max: 100 }
        ],
        shape: 'circle', splitNumber: 4,
        axisName: { color: theme.textColor },
        splitArea: { areaStyle: { color: ['rgba(139,94,60,.03)','rgba(139,94,60,.06)'] } }
      },
      series: [{
        type: 'radar',
        data: [{ value: Object.values(scores), name: document.getElementById('selfName').value || '我',
          areaStyle: { color: 'rgba(139,94,60,.2)' },
          lineStyle: { color: theme.brown },
          itemStyle: { color: theme.accent }
        }]
      }]
    });
    STATE.charts.radar = chart;
  }

  // Heatmap
  function chartHeatmap(elId, dailyData, title, colorRange) {
    const el = container.querySelector('#' + elId);
    if (!el || Object.keys(dailyData).length === 0) return;
    const chart = echarts.init(el);

    const dates = Object.entries(dailyData).map(([d, v]) => [d, v]);
    if (dates.length === 0) return;

    const data = dates.map(([date, value]) => [date, value]);

    // Calculate years
    const years = [...new Set(dates.map(([d]) => d.substring(0, 4)))].sort();
    let currentYear = years[years.length - 1];

    function renderYear(year) {
      const yearData = data.filter(([d]) => d.startsWith(year));
      const maxVal = Math.max(1, ...yearData.map(([,v]) => v));
      chart.setOption({
        title: { text: title, left: 'center', top: 6, textStyle: { fontSize: 14, color: theme.textColor } },
        tooltip: { position: 'top', formatter: p => `${p.data[0]}: ${p.data[1]} 条` },
        visualMap: { min: 0, max: maxVal, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
          inRange: { color: colorRange }, show: false },
        calendar: { range: year, cellSize: ['auto', 13], dayLabel: { nameMap: 'CN' },
          monthLabel: { nameMap: 'CN' }, itemStyle: { borderWidth: 2, borderColor: '#fff' } },
        series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: yearData }]
      });
    }

    // Year switcher
    if (years.length > 1) {
      const switcher = document.createElement('div');
      switcher.className = 'hm-year-switcher';
      switcher.style.cssText = 'text-align:center;margin-bottom:8px';
      years.forEach(y => {
        const btn = document.createElement('button');
        btn.textContent = y;
        btn.style.cssText = `margin:2px 4px;padding:3px 12px;border-radius:12px;border:1.5px solid #d4956a;background:${y===currentYear?'#8b5e3c':'transparent'};color:${y===currentYear?'#fff':'#8b5e3c'};cursor:pointer;font-size:12px`;
        btn.onclick = () => {
          currentYear = y;
          switcher.querySelectorAll('button').forEach(b => { b.style.background='transparent'; b.style.color='#8b5e3c'; });
          btn.style.background = '#8b5e3c';
          btn.style.color = '#fff';
          renderYear(y);
        };
        switcher.appendChild(btn);
      });
      el.parentElement.insertBefore(switcher, el);
    }
    renderYear(currentYear);
    STATE.charts[elId] = chart;
  }

  // Execute
  chartHourly();
  chartMonthly();
  chartWeekday();
  chartLengthDist();

  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';

  chartWordCloud('chart-wc-self', s.wordFreq, `${selfName} 的高频词`);

  if (STATE.stats.hasPartner && STATE.stats.partner) {
    chartWordCloud('chart-wc-partner', STATE.stats.partner.wordFreq, `${partnerName} 的高频词`);
  }

  if (Object.keys(s.daily).length > 0) {
    chartHeatmap('chart-hm-self', s.daily, `${selfName} 的聊天热力图`,
      ['#ede5dc', '#d4a882', '#b87040', '#8b5e3c', '#5a3020']);
  }
  if (STATE.stats.hasPartner && STATE.stats.partner && Object.keys(STATE.stats.partner.daily).length > 0) {
    chartHeatmap('chart-hm-partner', STATE.stats.partner.daily, `${partnerName} 的聊天热力图`,
      ['#d8edea', '#8abfb8', '#5a9b93', '#4a7b6f', '#2e5048']);
  }
}

// ── AI 人格分析 ──────────────────────────────────────

async function analyzePersonality() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const endpoint = document.getElementById('apiEndpoint').value.trim();
  const model = document.getElementById('apiModel').value.trim();

  if (!apiKey || !endpoint || !model) {
    throw new Error('请填写完整的 API 配置');
  }

  updateProgress(60, '正在调用 AI 进行人格分析...');

  const s = STATE.stats.self;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';

  // Sample messages for analysis
  const filterForAI = msgs => msgs
    .filter(m => m.content.length >= 10 && m.content.length <= 200)
    .slice(0, 120);

  const selfSamples = filterForAI(STATE.rawData.self);
  const partnerSamples = STATE.rawData.partner.length > 0 ? filterForAI(STATE.rawData.partner) : [];

  const selfMsgText = selfSamples.map(m => '• ' + m.content).join('\n');
  const partnerMsgText = partnerSamples.map(m => '• ' + m.content).join('\n');

  const prompt = (samples, name, isSelf) => `你是一位语言学人格研究者，正在分析一位用户的微信聊天记录样本。

【分析对象】${name}（${isSelf ? '聊天记录的导出者' : '聊天对象'}）
【样本消息数】${samples.length} 条
【时间跨度】${s.timeRange ? Math.max(1, Math.round((s.timeRange.end - s.timeRange.start) / (1000*60*60*24*30))) + ' 个月' : '未知'}
【消息样本】
${samples.map(m => '• ' + m.content).join('\n')}

请基于语言模式推断人格特质，输出严格符合以下格式的 JSON（不要包含任何额外文字）：

{
  "big5": {
    "openness": {"score": 0-100, "level": "低/中/高", "evidence": "引用1条原文", "note": "一句解读"},
    "conscientiousness": {"score": 0-100, "level": "低/中/高", "evidence": "引用1条原文", "note": "一句解读"},
    "extraversion": {"score": 0-100, "level": "低/中/高", "evidence": "引用1条原文", "note": "一句解读"},
    "agreeableness": {"score": 0-100, "level": "低/中/高", "evidence": "引用1条原文", "note": "一句解读"},
    "neuroticism": {"score": 0-100, "level": "低/中/高", "evidence": "引用1条原文", "note": "一句解读"}
  },
  "mbti": {
    "type": "四字母类型",
    "confidence": "低/中/高",
    "note": "一句话说明置信度原因",
    "dims": {
      "EI": {"lean": "E或I", "strength": "明显/轻微", "reason": "简短理由"},
      "SN": {"lean": "S或N", "strength": "明显/轻微", "reason": "简短理由"},
      "TF": {"lean": "T或F", "strength": "明显/轻微", "reason": "简短理由"},
      "JP": {"lean": "J或P", "strength": "明显/轻微", "reason": "简短理由"}
    }
  },
  "style": {
    "one_line": "用一句话生动描述这个人",
    "summary": "2-3句话描述聊天风格",
    "strengths": ["特点1","特点2","特点3"],
    "fun_facts": ["有趣发现1","有趣发现2"]
  },
  "reliability": "关于分析可靠性的简短说明"
}

重要：evidence 必须是消息样本中的原文。只输出 JSON，不要包装在代码块中。`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // Analyze self
  const selfResp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt(selfSamples.length > 0 ? selfSamples.map(m => m.content) : ['无充足数据'], selfName, true) }],
      max_tokens: 2500,
      temperature: 0.7,
    }),
  });

  if (!selfResp.ok) {
    const err = await selfResp.text();
    throw new Error(`AI API 错误 (${selfResp.status}): ${err.substring(0, 200)}`);
  }
  const selfResult = await selfResp.json();
  const selfContent = selfResult.choices?.[0]?.message?.content || '';

  // Extract JSON from response
  const jsonMatch = selfContent.match(/\{[\s\S]*\}/);
  let selfPersonality;
  try {
    selfPersonality = JSON.parse(jsonMatch ? jsonMatch[0] : selfContent);
  } catch {
    throw new Error('AI 返回的 JSON 解析失败');
  }

  // Analyze partner if applicable
  let partnerPersonality = null;
  if (partnerSamples.length >= 20) {
    updateProgress(75, '正在分析对方的人格特质...');
    const partnerResp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt(partnerSamples.map(m => m.content), partnerName, false) }],
        max_tokens: 2500,
        temperature: 0.7,
      }),
    });
    if (partnerResp.ok) {
      const pResult = await partnerResp.json();
      const pContent = pResult.choices?.[0]?.message?.content || '';
      const pMatch = pContent.match(/\{[\s\S]*\}/);
      try {
        partnerPersonality = JSON.parse(pMatch ? pMatch[0] : pContent);
      } catch { /* ignore parse failure for partner */ }
    }
  }

  STATE.personality = { self: selfPersonality, partner: partnerPersonality };
  updateProgress(80, 'AI 分析完成！');
}

// ── 报告生成 ──────────────────────────────────────────

function generateReportHTML() {
  const s = STATE.stats.self;
  const p = STATE.personality;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';
  const hasPartner = STATE.stats.hasPartner && STATE.stats.partner;

  const dr = s.timeRange;
  const days = dr ? Math.max(1, Math.round((dr.end - dr.start) / (1000*60*60*24))) : 0;
  const spanStr = days > 365 ? `${Math.floor(days/365)}年${Math.round(days%365/30)}个月`
    : (days > 30 ? `${Math.round(days/30)}个月` : `${days} 天`);

  const big5 = p?.self?.big5 || null;
  const mbti = p?.self?.mbti || null;
  const style = p?.self?.style || null;
  const hasAI = !!p?.self;
  const hasDualAI = hasAI && !!p?.partner?.big5;

  // Helper: tag pill
  const tag = (name, isPartner) => `<span class="${isPartner?'tag-partner':'tag-self'}"><span class="tag-av">${name.charAt(0)}</span>${name}</span>`;

  // Big5
  let big5HTML = '';
  if (hasDualAI && p.partner.big5) {
    const dims = [
      { key: 'openness', zh: '开放性', en: 'Openness' },
      { key: 'conscientiousness', zh: '尽责性', en: 'Conscientiousness' },
      { key: 'extraversion', zh: '外倾性', en: 'Extraversion' },
      { key: 'agreeableness', zh: '宜人性', en: 'Agreeableness' },
      { key: 'neuroticism', zh: '神经质', en: 'Neuroticism' },
    ];
    big5HTML = `<div class="butterfly-header">
      <div class="bf-head-left">${tag(selfName, false)}</div>
      <div style="text-align:center;color:var(--tx-400,#9A8070);font-size:.82em">维度</div>
      <div class="bf-head-right">${tag(partnerName, true)}</div>
    </div>`;
    dims.forEach((d, i) => {
      const si = big5[d.key] || {};
      const pi = p.partner.big5[d.key] || {};
      big5HTML += `<div class="butterfly-row">
        <div class="bf-left">
          <span class="bf-score-left">${si.score||0}<span class="bf-level"> ${si.level||''}</span></span>
          <div class="bf-track-left"><div class="bf-fill-self" style="width:${si.score||0}%;--bi:${i}"></div></div>
        </div>
        <div class="bf-center">${d.zh}<br><small>${d.en}</small></div>
        <div class="bf-right">
          <div class="bf-track-right"><div class="bf-fill-partner" style="width:${pi.score||0}%;--bi:${i}"></div></div>
          <span class="bf-score-right">${pi.score||0}<span class="bf-level"> ${pi.level||''}</span></span>
        </div>
      </div>`;
    });
    // Dual notes with evidence
    const dimKeys = ['openness','conscientiousness','extraversion','agreeableness','neuroticism'];
    const dimZh = ['开放性','尽责性','外倾性','宜人性','神经质'];
    let notesHTML = '<div class="dual-notes"><div class="note-col self-note"><div class="note-col-header">' + tag(selfName, false) + ' 解读</div>';
    dimKeys.forEach((k, i) => {
      const d = big5[k] || {};
      notesHTML += `<div class="note-item"><span class="note-dim">${dimZh[i]}</span><span class="note-text">${d.note||''}</span>${d.evidence?`<div class="note-evidence">💬 "${d.evidence}"</div>`:''}</div>`;
    });
    notesHTML += '</div><div class="note-col partner-note"><div class="note-col-header">' + tag(partnerName, true) + ' 解读</div>';
    dimKeys.forEach((k, i) => {
      const d = p.partner.big5[k] || {};
      notesHTML += `<div class="note-item"><span class="note-dim">${dimZh[i]}</span><span class="note-text">${d.note||''}</span>${d.evidence?`<div class="note-evidence">💬 "${d.evidence}"</div>`:''}</div>`;
    });
    notesHTML += '</div></div>';
    big5HTML += notesHTML;
  } else if (big5) {
    big5HTML = `<div id="chart-radar" style="width:100%;height:380px;margin-bottom:14px"></div>`;
  }

  // MBTI
  let mbtiHTML = '';
  if (hasDualAI && p.partner.mbti) {
    const mbtiPanel = (data, name, isP) => {
      const dims = { EI: '内/外向', SN: '感知/直觉', TF: '思考/情感', JP: '判断/感知' };
      let rows = '';
      Object.entries(dims).forEach(([dim, label]) => {
        const d = data.dims?.[dim] || {};
        rows += `<div class="dim-row">
          <span class="dim-axis">${label}</span>
          <span class="dim-lean ${isP?'panel-partner':''}">${d.lean||'?'}</span>
          <span class="dim-strength">${d.strength||''}</span>
          <div class="dim-reason">${d.reason||''}</div>
        </div>`;
      });
      return `<div class="person-panel ${isP?'panel-partner':''}">
        <div class="panel-header">${tag(name, isP)}</div>
        <div class="mbti-type-badge ${isP?'panel-partner':''}">${data.type||'??'}</div>
        <div class="mbti-conf">置信度：${data.confidence||''}</div>
        <div class="mbti-note">${data.note||''}</div>
        <div class="dims-list">${rows}</div>
      </div>`;
    };
    mbtiHTML = `<div class="dual-col">${mbtiPanel(mbti, selfName, false)}${mbtiPanel(p.partner.mbti, partnerName, true)}</div>`;
  } else if (mbti) {
    const dims = { EI: '内/外向', SN: '感知/直觉', TF: '思考/情感', JP: '判断/感知' };
    let rows = '';
    Object.entries(dims).forEach(([dim, label]) => {
      const d = mbti.dims?.[dim] || {};
      rows += `<div class="dim-row">
        <span class="dim-axis">${label}</span>
        <span class="dim-lean">${d.lean||'?'}</span>
        <span class="dim-strength">${d.strength||''}</span>
        <div class="dim-reason">${d.reason||''}</div>
      </div>`;
    });
    mbtiHTML = `<div class="person-panel" style="max-width:500px">
      <div class="mbti-type-badge">${mbti.type||'??'}</div>
      <div class="mbti-conf">置信度：${mbti.confidence||''}</div>
      <div class="mbti-note">${mbti.note||''}</div>
      <div class="dims-list">${rows}</div>
    </div>`;
  }

  // Style summary
  const stylePanel = (data, name, isP) => `
    <div class="${isP?'partner-col':''}">
      <div class="panel-header" style="margin-bottom:12px">${tag(name, isP)}</div>
      <blockquote class="one-line ${isP?'partner':''}">"${data.one_line||''}"</blockquote>
      <p class="summary-text">${data.summary||''}</p>
      <ul class="strengths">${(data.strengths||[]).map(s => `<li>${s}</li>`).join('')}</ul>
      ${(data.fun_facts||[]).length ? `<div class="fun-facts-label">意外发现</div>${data.fun_facts.map(f => `<div class="fun-fact">${f}</div>`).join('')}` : ''}
    </div>`;

  let styleHTML = '';
  if (hasDualAI && p.partner.style) {
    styleHTML = `<div class="dual-col">${stylePanel(style, selfName, false)}${stylePanel(p.partner.style, partnerName, true)}</div>`;
  } else if (style) {
    styleHTML = stylePanel(style, selfName, false);
  }

  // Charts HTML
  const chartsHTML = `
    <div class="chart-grid">
      <div id="chart-hourly" class="chart-cell"></div>
      <div id="chart-weekday" class="chart-cell"></div>
      <div id="chart-monthly" class="chart-cell"></div>
      <div id="chart-length" class="chart-cell"></div>
    </div>
    <div class="chart-grid" style="grid-template-columns:${hasPartner?'1fr 1fr':'1fr'}">
      <div id="chart-wc-self" class="chart-cell-full"></div>
      ${hasPartner ? '<div id="chart-wc-partner" class="chart-cell-full"></div>' : ''}
    </div>
    <div id="chart-hm-self" style="height:200px;margin-bottom:10px"></div>
    ${hasPartner ? '<div id="chart-hm-partner" style="height:200px;margin-bottom:10px"></div>' : ''}`;

  const reliability = p?.self?.reliability || '';

  const bodyHTML = `
<div class="header" style="--i:0">
  <h1>🍪 微信聊天人格分析报告</h1>
  <div class="header-meta">${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})}</div>
  <div class="header-vs">
    <div class="person-pill"><div class="av av-self">${selfName.charAt(0)}</div><span class="pill-name">${selfName}</span></div>
    ${hasPartner ? `<span class="vs-divider">VS</span><div class="person-pill"><div class="av av-partner">${partnerName.charAt(0)}</div><span class="pill-name">${partnerName}</span></div>` : ''}
  </div>
</div>
<div class="stats" style="--i:1">
  <div class="stat"><div class="stat-num">${s.total.toLocaleString()}</div><div class="stat-lbl">${selfName} 发出的消息</div></div>
  <div class="stat"><div class="stat-num">${s.avgLength}</div><div class="stat-lbl">平均消息字数</div></div>
  <div class="stat"><div class="stat-num">${spanStr}</div><div class="stat-lbl">数据覆盖时长</div></div>
</div>
<div class="section" style="--i:2"><div class="section-title">📊 消息行为分析</div>${chartsHTML}</div>
${big5HTML ? `<div class="section" style="--i:3"><div class="section-title">🧠 大五人格分析 (Big Five)</div>${big5HTML}</div>` : ''}
${mbtiHTML ? `<div class="section" style="--i:4"><div class="section-title">🔮 MBTI 推断</div>${mbtiHTML}</div>` : ''}
${styleHTML ? `<div class="section" style="--i:5"><div class="section-title">✨ AI 对${hasDualAI?'你们':'你'}的总结</div>${styleHTML}</div>` : ''}
${reliability ? `<div style="font-size:.78em;color:var(--tx-400,#8a7a6a);text-align:center;padding:12px">📋 ${reliability}</div>` : ''}
<div class="disc">⚠️ 本报告基于语言模式的统计推断，仅供娱乐与自我探索，不构成心理学诊断。<br>MBTI 信效度存在学术争议；Big Five 具有更强的研究支撑，但仍需谨慎解读。<div class="brand">🍪 姜饼探AI · Ginger Report v2.0</div></div>`;

  return bodyHTML;
}

function getFullReportHTML(bodyHTML, selfName, partnerName, hasPartner) {
  const STYLES = `
/* ── OKLCH Design Tokens ──────────────────────────── */
:root {
  --pg:        oklch(93.5% 0.022 55);
  --surface:   oklch(98.5% 0.008 52);
  --surface-2: oklch(96%   0.018 54);
  --br-900: oklch(32%  0.085 48);
  --br-700: oklch(44%  0.095 49);
  --br-500: oklch(58%  0.105 51);
  --br-300: oklch(74%  0.085 53);
  --br-100: oklch(91%  0.042 55);
  --br-050: oklch(96%  0.022 55);
  --tl-800: oklch(40%  0.075 174);
  --tl-500: oklch(58%  0.085 175);
  --tl-200: oklch(83%  0.055 175);
  --tl-050: oklch(95%  0.028 175);
  --tx-900: oklch(22%  0.025 48);
  --tx-600: oklch(46%  0.030 48);
  --tx-400: oklch(63%  0.022 50);
  --sh-sm: 0 1px 4px oklch(32% 0.085 48 / .07);
  --sh-md: 0 4px 18px oklch(32% 0.085 48 / .10);
  --r-sm: 8px;  --r-md: 14px;  --r-lg: 20px;  --r-xl: 28px;
  --ease-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ff-display: 'Songti SC', 'STSong', 'SimSun', Georgia, 'Times New Roman', serif;
  --ff-body:    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
blockquote { quotes: none; }
body {
  font-family: var(--ff-body); background: var(--pg); color: var(--tx-900);
  line-height: 1.6; padding: clamp(14px, 3vw, 32px) clamp(10px, 2.5vw, 20px);
  min-height: 100vh;
}
.container { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }

@keyframes fadeUp { from { opacity: 0; transform: translateY(18px); } }
@keyframes growX { from { transform: scaleX(0); } }
.header, .stats, .section {
  animation: fadeUp 560ms var(--ease-expo) both;
  animation-delay: calc(var(--i, 0) * 65ms);
}
.bar-fill, .bf-fill-self, .bf-fill-partner {
  animation: growX 750ms var(--ease-expo) both;
  animation-delay: calc(300ms + var(--bi, 0) * 40ms);
}
.bf-fill-self    { transform-origin: right center; }
.bf-fill-partner { transform-origin: left center; }
.bar-fill        { transform-origin: left center; }
@media (prefers-reduced-motion: reduce) {
  .header, .stats, .section, .bar-fill, .bf-fill-self, .bf-fill-partner { animation: none; }
}

/* Header */
.header {
  background: var(--br-900); border-radius: var(--r-xl);
  padding: clamp(28px, 5vw, 52px) clamp(22px, 4vw, 48px);
  color: #fff; text-align: center; position: relative; overflow: hidden;
}
.header::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(-45deg, transparent, transparent 32px, oklch(100% 0 0 / .022) 32px, oklch(100% 0 0 / .022) 33px);
  pointer-events: none;
}
.header::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 55%;
  background: linear-gradient(to bottom, transparent, oklch(28% 0.07 48 / .2));
  pointer-events: none;
}
.header h1 {
  font-family: var(--ff-display); font-size: clamp(1.45rem, 4.5vw, 2.1rem);
  font-weight: 700; letter-spacing: .04em; margin-bottom: 7px;
  position: relative; z-index: 1;
}
.header-meta { opacity: .58; font-size: .84em; letter-spacing: .03em; position: relative; z-index: 1; }
.header-vs {
  display: flex; align-items: center; justify-content: center;
  gap: 14px; margin-top: 20px; position: relative; z-index: 1;
}
.vs-divider { font-size: .9em; opacity: .38; font-weight: 200; letter-spacing: .2em; }
.person-pill {
  display: inline-flex; align-items: center; gap: 8px;
  background: oklch(100% 0 0 / .11); border: 1px solid oklch(100% 0 0 / .18);
  border-radius: 50px; padding: 5px 15px 5px 5px;
}
.av {
  width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; border: 2px solid oklch(100% 0 0 / .3);
}
.av-self    { background: linear-gradient(135deg, var(--br-700), var(--br-300)); color: #fff; }
.av-partner { background: linear-gradient(135deg, var(--tl-800), var(--tl-500)); color: #fff; }
.pill-name  { font-size: .88em; font-weight: 600; color: #fff; }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stat {
  background: var(--surface); border-radius: var(--r-md);
  padding: 22px 14px 20px; text-align: center;
  box-shadow: var(--sh-sm); position: relative;
}
.stat::after {
  content: ''; position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%); width: 40px; height: 3px;
  background: linear-gradient(90deg, var(--br-500), var(--br-300));
  border-radius: 2px 2px 0 0;
}
.stat-num {
  font-family: var(--ff-display); font-size: clamp(1.5rem, 3.5vw, 2.1rem);
  font-weight: 700; color: var(--br-700); line-height: 1; font-variant-numeric: tabular-nums;
}
.stat-lbl { color: var(--tx-400); font-size: .78em; margin-top: 7px; }

/* Section */
.section {
  background: var(--surface); border-radius: var(--r-lg);
  padding: clamp(18px, 3.5vw, 28px); box-shadow: var(--sh-sm);
}
.section-title {
  font-family: var(--ff-display); font-size: 1.02em; font-weight: 700;
  color: var(--br-900); letter-spacing: .04em;
  display: flex; align-items: center; gap: 9px;
  padding-bottom: 14px; margin-bottom: 18px;
  border-bottom: 1.5px solid var(--br-100);
}

/* Tags */
.tag-self, .tag-partner {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px 3px 4px; border-radius: 20px;
  font-size: .79em; font-weight: 600; white-space: nowrap; color: #fff;
}
.tag-self    { background: var(--br-700); }
.tag-partner { background: var(--tl-800); }
.tag-av {
  width: 20px; height: 20px; border-radius: 50%; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
  background: oklch(100% 0 0 / .22); color: #fff;
}

/* Butterfly Big5 */
.butterfly-header {
  display: grid; grid-template-columns: 1fr 120px 1fr;
  gap: 8px; margin-bottom: 8px; font-size: .79em; font-weight: 600; color: var(--tx-400);
}
.bf-head-left  { text-align: right; }
.bf-head-right { text-align: left; }
.butterfly-row {
  display: grid; grid-template-columns: 1fr 120px 1fr;
  gap: 8px; align-items: center; margin: 6px 0;
}
.bf-left  { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.bf-right { display: flex; align-items: center; gap: 8px; }
.bf-track-left {
  width: 110px; height: 17px; background: var(--br-100);
  border-radius: 8px 0 0 8px; overflow: hidden; direction: rtl; flex-shrink: 0;
}
.bf-track-right {
  width: 110px; height: 17px; background: var(--tl-200);
  border-radius: 0 8px 8px 0; overflow: hidden; flex-shrink: 0;
}
.bf-fill-self {
  height: 100%; background: linear-gradient(to left, var(--br-900), var(--br-500));
  border-radius: 8px 0 0 8px;
}
.bf-fill-partner {
  height: 100%; background: linear-gradient(90deg, var(--tl-500), var(--tl-800));
  border-radius: 0 8px 8px 0;
}
.bf-score-left {
  font-size: .79em; font-weight: 700; color: var(--br-700);
  text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.bf-score-right {
  font-size: .79em; font-weight: 700; color: var(--tl-800);
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.bf-level  { font-weight: 400; color: var(--tx-400); }
.bf-center { text-align: center; font-size: .84em; font-weight: 600; color: var(--tx-900); line-height: 1.3; }
.bf-center small { font-weight: 400; color: var(--tx-400); font-size: .78em; }

/* Big5 dual notes */
.dual-notes {
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
  margin-top: 22px; padding-top: 18px; border-top: 1.5px solid var(--br-100);
}
.note-col-header {
  font-size: .79em; font-weight: 600; color: var(--br-900);
  margin-bottom: 9px; display: flex; align-items: center; gap: 7px;
}
.note-item {
  margin-bottom: 9px; padding: 9px 11px;
  background: var(--br-050); border-radius: var(--r-sm);
  border-left: 3px solid var(--br-300);
}
.partner-note .note-item { background: var(--tl-050); border-left-color: var(--tl-500); }
.note-dim {
  display: inline-block; font-size: .73em; font-weight: 700;
  color: var(--br-700); background: oklch(100% 0 0 / .7);
  padding: 1px 7px; border-radius: 10px; margin-bottom: 3px;
}
.partner-note .note-dim { color: var(--tl-800); }
.note-text     { font-size: .82em; color: var(--tx-900); display: block; margin-top: 3px; line-height: 1.6; }
.note-evidence { font-size: .76em; color: var(--tx-400); font-style: italic; margin-top: 4px; }

/* Single Big5 */
.trait-row { display: flex; gap: 14px; margin: 13px 0; align-items: flex-start; }
.trait-label { width: 68px; font-weight: 600; font-size: .84em; color: var(--tx-900); flex-shrink: 0; line-height: 1.3; padding-top: 2px; }
.trait-label small { font-weight: 400; color: var(--tx-400); display: block; }
.trait-body { flex: 1; }
.bar-wrap { display: flex; align-items: center; gap: 10px; }
.bar-track { flex: 1; height: 17px; background: var(--br-100); border-radius: 8px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--br-300), var(--br-900)); border-radius: 8px; }
.bar-score { font-size: .79em; color: var(--br-700); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.trait-note     { font-size: .82em; color: var(--tx-600); margin-top: 6px; line-height: 1.65; }
.trait-evidence { font-size: .76em; color: var(--tx-400); font-style: italic; margin-top: 3px; }

/* MBTI */
.dual-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.person-panel { border-radius: var(--r-md); padding: 18px; background: var(--br-050); }
.person-panel.panel-partner { background: var(--tl-050); }
.panel-header { margin-bottom: 10px; }
.mbti-type-badge {
  font-family: var(--ff-display); font-size: clamp(1.8rem, 4vw, 2.7rem);
  font-weight: 700; letter-spacing: 5px; color: var(--br-700); line-height: 1; margin: 8px 0 4px;
}
.mbti-type-badge.panel-partner { color: var(--tl-800); }
.mbti-conf  { font-size: .77em; color: var(--tx-400); margin-top: 2px; }
.mbti-note  { font-size: .81em; color: var(--tx-600); margin: 8px 0 10px; font-style: italic; line-height: 1.55; }
.dim-row {
  display: grid; grid-template-columns: 74px 26px 48px 1fr;
  gap: 6px; padding: 6px 0; border-bottom: 1px solid oklch(100% 0 0 / .55);
  align-items: baseline; font-size: .81em;
}
.panel-partner .dim-row { border-bottom-color: oklch(100% 0 0 / .45); }
.dim-axis     { color: var(--tx-900); font-weight: 600; }
.dim-lean     { font-weight: 800; color: var(--br-500); }
.dim-lean.panel-partner { color: var(--tl-800); }
.dim-strength { color: var(--tx-400); font-size: .84em; }
.dim-reason   { color: var(--tx-600); line-height: 1.45; }

/* Style Summary */
.one-line {
  background: var(--surface-2); border-left: 4px solid var(--br-500);
  padding: 13px 18px; border-radius: 0 var(--r-sm) var(--r-sm) 0;
  font-size: .94em; font-style: italic; color: var(--tx-900);
  margin-bottom: 15px; line-height: 1.7;
}
.one-line.partner { border-left-color: var(--tl-500); background: var(--tl-050); }
.summary-text { font-size: .89em; color: var(--tx-600); line-height: 1.8; margin-bottom: 13px; }
.strengths    { padding-left: 18px; margin-bottom: 13px; }
.strengths li { font-size: .87em; color: var(--tx-600); margin: 6px 0; line-height: 1.6; }
.fun-facts-label { font-size: .82em; font-weight: 700; color: var(--br-500); margin: 13px 0 7px; }
.partner-col .fun-facts-label { color: var(--tl-800); }
.fun-fact {
  background: var(--surface-2); border-left: 3px solid var(--br-300);
  padding: 10px 14px; border-radius: 0 var(--r-sm) var(--r-sm) 0;
  font-size: .84em; margin: 7px 0; color: var(--tx-600); line-height: 1.65;
}
.partner-col .fun-fact { border-left-color: var(--tl-500); }

/* Heatmap */
.hm-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.hm-label-sm { font-size: .79em; color: var(--tx-400); }
.hm-yr-btns  { display: flex; gap: 5px; flex-wrap: wrap; }
.hm-yr-btn {
  padding: 4px 13px; border-radius: 20px; border: 1.5px solid var(--br-300);
  background: transparent; color: var(--br-700);
  cursor: pointer; font-size: .79em; font-family: inherit;
  transition: background 150ms, color 150ms, border-color 150ms;
}
.hm-yr-btn.hm-active { background: var(--br-700); color: #fff; border-color: var(--br-700); }
.hm-yr-btn:hover:not(.hm-active) { background: var(--br-100); }
.hm-person-block { margin-bottom: 18px; }
.hm-person-label { margin-bottom: 9px; }
.hm-flex    { display: flex; gap: 4px; }
.hm-daycol  { display: flex; flex-direction: column; flex-shrink: 0; }
.hm-month-sp { height: 18px; }
.hm-daylbl  { height: 14px; width: 18px; font-size: 9px; color: var(--tx-400); line-height: 14px; margin-bottom: 2px; text-align: right; }
.hm-scroll  { display: flex; gap: 2px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; scrollbar-color: var(--br-300) var(--br-100); }
.hm-scroll::-webkit-scrollbar       { height: 5px; }
.hm-scroll::-webkit-scrollbar-track { background: var(--br-100); border-radius: 3px; }
.hm-scroll::-webkit-scrollbar-thumb { background: var(--br-300); border-radius: 3px; }
.hm-col     { display: flex; flex-direction: column; }
.hm-monlbl  { height: 18px; font-size: 9px; color: var(--tx-400); white-space: nowrap; }
.hm-weekcol { display: flex; flex-direction: column; gap: 2px; }
.hm-cell    { width: 13px; height: 13px; border-radius: 2px; flex-shrink: 0; transition: opacity 100ms; cursor: default; }
.hm-cell:hover { opacity: .62; }
.hm-out     { background: transparent !important; }
.hm-sep     { border: none; border-top: 1.5px solid var(--br-100); margin: 14px 0; }
.hm-legend  { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; font-size: .75em; color: var(--tx-400); }
.hm-leg-row   { display: flex; align-items: center; gap: 5px; }
.hm-leg-cells { display: flex; gap: 2px; }
.hm-leg-cell  { width: 11px; height: 11px; border-radius: 2px; }
.hm-tip {
  position: fixed; background: var(--tx-900); color: oklch(96% 0.022 55);
  padding: 6px 12px; border-radius: var(--r-sm); font-size: 11px;
  pointer-events: none; z-index: 9999; display: none; white-space: nowrap; line-height: 1.5;
  box-shadow: 0 4px 14px oklch(22% 0.025 48 / .28);
}

/* Charts */
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.chart-cell { height: 280px; border-radius: var(--r-sm); }
.chart-cell-full { height: 320px; border-radius: var(--r-sm); }

/* Disclaimer */
.disc {
  text-align: center; font-size: .74em; color: var(--tx-400);
  padding: 26px 22px; border-top: 1.5px solid var(--br-100); line-height: 2;
}
.brand {
  font-family: var(--ff-display); font-weight: 700; color: var(--br-500);
  margin-top: 12px; font-size: 1em; letter-spacing: .08em;
}

/* Responsive */
@media (max-width: 600px) {
  .chart-grid       { grid-template-columns: 1fr; }
  .dual-col         { grid-template-columns: 1fr; }
  .dual-notes       { grid-template-columns: 1fr; }
  .stats            { gap: 7px; }
  .stat-num         { font-size: 1.4rem; }
  .butterfly-row,
  .butterfly-header { grid-template-columns: 1fr 80px 1fr; }
  .bf-track-left,
  .bf-track-right   { width: 72px; }
  .mbti-type-badge  { font-size: 1.75rem; letter-spacing: 3px; }
}`;
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信聊天人格分析 · ${selfName}${hasPartner ? ' & ' + partnerName : ''}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/echarts-wordcloud@2.1.0/dist/echarts-wordcloud.min.js"><\/script>
<style>${STYLES}</style></head><body><div class="container">
${bodyHTML}
</div></body></html>`;
}

// ── 主流程 ────────────────────────────────────────────

async function generateReport() {
  try {
    // Collect manual input if in manual mode
    if (STATE.mode === 'manual') {
      const entries = document.querySelectorAll('#msgEntries .msg-entry');
      STATE.rawData = { self: [], partner: [] };
      entries.forEach(e => {
        const isSelf = e.querySelector('select').value === 'self';
        const content = e.querySelector('input').value.trim();
        if (content) {
          (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content: cleanMessage(content), ts: null });
        }
      });
      if (STATE.rawData.self.length + STATE.rawData.partner.length < 5) {
        throw new Error('请至少输入 5 条消息');
      }
    }

    if (!STATE.rawData || (STATE.rawData.self.length + STATE.rawData.partner.length < 5)) {
      throw new Error('消息数量不足，请上传至少 5 条聊天记录');
    }

    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 处理中...';
    document.getElementById('progressWrap').classList.add('show');
    document.getElementById('reportWrap').classList.remove('show');

    // Step 1: Compute stats
    updateProgress(10, '正在解析消息数据...');
    await sleep(100);
    computeStats();

    // Step 2: Generate report HTML structure
    updateProgress(30, '正在生成报告框架...');
    const bodyHTML = generateReportHTML();

    // Step 3: Show report
    updateProgress(40, '正在渲染报告...');
    const reportContent = document.getElementById('reportContent');
    reportContent.innerHTML = bodyHTML;
    document.getElementById('reportWrap').classList.add('show');

    // Step 4: Create charts
    updateProgress(50, '正在生成图表...');
    await sleep(200);
    createCharts('reportContent');

    // Step 5: Resize charts
    updateProgress(55, '正在优化图表...');
    await sleep(300);
    Object.values(STATE.charts).forEach(c => { try { c.resize(); } catch {} });

    // Step 6: AI analysis (if enabled)
    if (document.getElementById('aiEnabled').checked) {
      updateProgress(56, '正在准备 AI 分析...');
      try {
        await analyzePersonality();
        // Regenerate report with AI data
        updateProgress(85, '正在整合 AI 分析结果...');
        const newBody = generateReportHTML();
        reportContent.innerHTML = newBody;
        await sleep(200);
        createCharts('reportContent');
        await sleep(300);
        Object.values(STATE.charts).forEach(c => { try { c.resize(); } catch {} });
      } catch (aiErr) {
        toast('⚠️ AI 分析失败：' + aiErr.message + '，报告将不包含人格分析');
      }
    }

    updateProgress(100, '✅ 报告生成完成！');
    btn.disabled = false;
    btn.textContent = '🍪 一键生成报告';

    // Scroll to report
    setTimeout(() => {
      document.getElementById('reportWrap').scrollIntoView({ behavior: 'smooth' });
      // Re-render charts for proper sizing
      Object.values(STATE.charts).forEach(c => { try { c.resize(); } catch {} });
    }, 400);

  } catch (err) {
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('generateBtn').textContent = '🍪 一键生成报告';
    toast('❌ 错误：' + err.message);
    console.error(err);
  }
}

function updateProgress(pct, text) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = text;
}

function downloadReport() {
  const reportBody = document.getElementById('reportContent').innerHTML;
  if (!reportBody) return;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';
  const hasPartner = STATE.stats.hasPartner && STATE.stats.partner;
  const html = getFullReportHTML(reportBody, selfName, partnerName, hasPartner);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wechat-report-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
  toast('✅ 报告已下载！');
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Utils ────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// Resize charts on window resize
window.addEventListener('resize', () => {
  Object.values(STATE.charts).forEach(c => { try { c.resize(); } catch {} });
});