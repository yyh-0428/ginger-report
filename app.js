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
    try {
      if (ext === 'csv' || STATE.mode === 'csv') parseCSV(text);
      else if (ext === 'json' || STATE.mode === 'json') parseJSON(text);
      else if (ext === 'md' || ext === 'markdown' || STATE.mode === 'md') parseMarkdown(text);
      else parseTXT(text);
      toast('✅ 文件已加载，共 ' + (STATE.rawData.self.length + STATE.rawData.partner.length) + ' 条消息');
    } catch (e) {
      toast('❌ 文件解析失败：' + e.message);
      STATE.rawData = null;
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

  if (STATE.rawData.self.length < 10 && STATE.rawData.partner.length < 10) {
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
  if (STATE.rawData.self.length < 10 && STATE.rawData.partner.length < 10) {
    throw new Error('JSON 中消息数量不足');
  }
}

function parseTXT(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  STATE.rawData = { self: [], partner: [] };

  // Common patterns: "Name: message", "Name - message", "YYYY-MM-DD HH:MM Name message"
  const patterns = [
    /^(.+?)[：:]\s*(.+)$/,
    /^(.+?)\s+-\s+(.+)$/,
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)[：:\s]+(.+)$/,
    /^(.+?)\s{2,}(.+)$/,
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
  if (STATE.rawData.self.length < 5 && STATE.rawData.partner.length < 5) {
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
  if (STATE.rawData.self.length < 5 && STATE.rawData.partner.length < 5) {
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

  if (selfMsgs.length < 10) throw new Error('自己消息数量不足（需要至少 10 条）');

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

    partnerStats = {
      total: partnerMsgs.length,
      wordFreq: pWordFreq,
      daily: pDaily,
      hourly: pHourly,
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
  // Dispose old chart instances before replacing
  Object.values(STATE.charts).forEach(c => { try { c.dispose(); } catch {} });
  STATE.charts = {};

  const s = STATE.stats.self;
  const container = document.getElementById(containerId);
  const theme = { textColor: '#5a4a3a', accent: '#c68642', brown: '#8b5e3c', teal: '#6faa9c' };

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
    chartHeatmap('chart-hm-partner', STATE.stats.partner.daily, `${partnerName} 的聊天热力图',
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
  const tag = (name, isPartner) => `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 10px 2px 5px;border-radius:20px;font-size:.8em;font-weight:600;color:#fff;background:${isPartner?'#4a7b6f':'#8b5e3c'}">${name.charAt(0)} ${name}</span>`;

  // Helper: section
  const section = (title, body, extra = '') => `<div style="background:#fdfaf6;border-radius:16px;padding:24px;margin-bottom:14px;box-shadow:0 2px 12px rgba(58,42,26,.05);${extra}">
    <div style="font-weight:700;font-size:1.05em;color:#3a2a1a;padding-bottom:12px;margin-bottom:16px;border-bottom:1.5px solid #e8d5c0;">${title}</div>${body}</div>`;

  // Big5
  let big5HTML = '';
  if (hasDualAI && p.partner.big5) {
    // Dual Big5 butterfly
    const dims = [
      { key: 'openness', zh: '开放性', en: 'Openness' },
      { key: 'conscientiousness', zh: '尽责性', en: 'Conscientiousness' },
      { key: 'extraversion', zh: '外倾性', en: 'Extraversion' },
      { key: 'agreeableness', zh: '宜人性', en: 'Agreeableness' },
      { key: 'neuroticism', zh: '神经质', en: 'Neuroticism' },
    ];
    big5HTML = `<div style="display:grid;grid-template-columns:1fr 100px 1fr;gap:6px;align-items:center;margin-bottom:8px;font-size:.8em;font-weight:600;color:#8a7a6a">
      <div style="text-align:right">${tag(selfName, false)}</div><div style="text-align:center">维度</div><div>${tag(partnerName, true)}</div></div>`;
    dims.forEach(d => {
      const si = big5[d.key] || {};
      const pi = p.partner.big5[d.key] || {};
      big5HTML += `<div style="display:grid;grid-template-columns:1fr 100px 1fr;gap:6px;align-items:center;margin:5px 0">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
          <span style="font-size:.8em;font-weight:700;color:#8b5e3c">${si.score||0} <span style="font-weight:400;color:#8a7a6a">${si.level||''}</span></span>
          <div style="width:100px;height:14px;background:#e8d5c0;border-radius:7px 0 0 7px;overflow:hidden"><div style="height:100%;background:linear-gradient(to left,#3a2a1a,#c68642);border-radius:7px 0 0 7px;width:${si.score||0}%"></div></div>
        </div>
        <div style="text-align:center;font-size:.84em;font-weight:600">${d.zh}<br><small style="font-weight:400;color:#8a7a6a">${d.en}</small></div>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:100px;height:14px;background:#c4ddd8;border-radius:0 7px 7px 0;overflow:hidden"><div style="height:100%;background:linear-gradient(90deg,#6faa9c,#4a7b6f);border-radius:0 7px 7px 0;width:${pi.score||0}%"></div></div>
          <span style="font-size:.8em;font-weight:700;color:#4a7b6f">${pi.score||0} <span style="font-weight:400;color:#8a7a6a">${pi.level||''}</span></span>
        </div></div>`;
    });
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
        rows += `<div style="display:grid;grid-template-columns:64px 24px 44px 1fr;gap:4px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.4);font-size:.8em">
          <span style="font-weight:600">${label}</span><span style="font-weight:800;color:${isP?'#6faa9c':'#c68642'}">${d.lean||'?'}</span>
          <span style="color:#8a7a6a;font-size:.85em">${d.strength||''}</span><span style="color:#5a4a3a">${d.reason||''}</span></div>`;
      });
      return `<div style="border-radius:12px;padding:16px;background:${isP?'#ecf5f2':'#f7f2ea'};flex:1">
        <div style="margin-bottom:8px">${tag(name, isP)}</div>
        <div style="font-size:2.4rem;font-weight:700;letter-spacing:4px;color:${isP?'#4a7b6f':'#8b5e3c'}">${data.type||'??'}</div>
        <div style="font-size:.78em;color:#8a7a6a;margin:2px 0">置信度：${data.confidence||''}</div>
        <div style="font-size:.82em;color:#5a4a3a;font-style:italic;margin:6px 0">${data.note||''}</div>${rows}</div>`;
    };
    mbtiHTML = `<div style="display:flex;gap:14px">${mbtiPanel(mbti, selfName, false)}${mbtiPanel(p.partner.mbti, partnerName, true)}</div>`;
  } else if (mbti) {
    const dims = { EI: '内/外向', SN: '感知/直觉', TF: '思考/情感', JP: '判断/感知' };
    let rows = '';
    Object.entries(dims).forEach(([dim, label]) => {
      const d = mbti.dims?.[dim] || {};
      rows += `<div style="display:grid;grid-template-columns:64px 24px 44px 1fr;gap:4px;padding:5px 0;border-bottom:1px solid rgba(58,42,26,.1);font-size:.8em">
        <span style="font-weight:600">${label}</span><span style="font-weight:800;color:#c68642">${d.lean||'?'}</span>
        <span style="color:#8a7a6a;font-size:.85em">${d.strength||''}</span><span style="color:#5a4a3a">${d.reason||''}</span></div>`;
    });
    mbtiHTML = `<div style="max-width:500px;border-radius:12px;padding:16px;background:#f7f2ea">
      <div style="font-size:2.4rem;font-weight:700;letter-spacing:4px;color:#8b5e3c">${mbti.type||'??'}</div>
      <div style="font-size:.78em;color:#8a7a6a;margin:2px 0">置信度：${mbti.confidence||''}</div>
      <div style="font-size:.82em;color:#5a4a3a;font-style:italic;margin:6px 0">${mbti.note||''}</div>${rows}</div>`;
  }

  // Style
  const stylePanel = (data, name, isP) => `
    <div style="flex:1">
      <div style="margin-bottom:12px">${tag(name, isP)}</div>
      <blockquote style="background:${isP?'#ecf5f2':'#f7f2ea'};border-left:4px solid ${isP?'#6faa9c':'#c68642'};padding:12px 16px;border-radius:0 8px 8px 0;font-style:italic;margin-bottom:12px">"${data.one_line||''}"</blockquote>
      <p style="font-size:.9em;color:#5a4a3a;line-height:1.8;margin-bottom:10px">${data.summary||''}</p>
      <ul style="padding-left:16px;margin-bottom:10px">${(data.strengths||[]).map(s => `<li style="font-size:.85em;color:#5a4a3a;margin:4px 0">${s}</li>`).join('')}</ul>
      ${(data.fun_facts||[]).length ? `<div style="font-size:.8em;font-weight:700;color:${isP?'#6faa9c':'#c68642'};margin:10px 0 6px">意外发现</div>${data.fun_facts.map(f => `<div style="background:${isP?'#ecf5f2':'#f7f2ea'};border-left:3px solid ${isP?'#6faa9c':'#d4956a'};padding:8px 12px;border-radius:0 6px 6px 0;font-size:.84em;margin:5px 0">${f}</div>`).join('')}` : ''}
    </div>`;

  let styleHTML = '';
  if (hasDualAI && p.partner.style) {
    styleHTML = `<div style="display:flex;gap:18px">${stylePanel(style, selfName, false)}${stylePanel(p.partner.style, partnerName, true)}</div>`;
  } else if (style) {
    styleHTML = stylePanel(style, selfName, false);
  }

  // Charts HTML
  const chartsHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div id="chart-hourly" style="height:280px"></div>
      <div id="chart-weekday" style="height:280px"></div>
      <div id="chart-monthly" style="height:280px"></div>
      <div id="chart-length" style="height:280px"></div>
    </div>
    <div style="display:grid;grid-template-columns:${hasPartner ? '1fr 1fr' : '1fr'};gap:10px;margin-bottom:14px">
      <div id="chart-wc-self" style="height:320px"></div>
      ${hasPartner ? '<div id="chart-wc-partner" style="height:320px"></div>' : ''}
    </div>
    <div id="chart-hm-self" style="height:200px;margin-bottom:10px"></div>
    ${hasPartner ? '<div id="chart-hm-partner" style="height:200px;margin-bottom:10px"></div>' : ''}`;

  // Reliability
  const reliability = p?.self?.reliability || '';

  const html = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信聊天人格分析 · ${selfName}${hasPartner ? ' & ' + partnerName : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif;background:#f5f0e8;color:#2d2018;line-height:1.6;padding:20px 16px}
.c{max-width:880px;margin:0 auto}
.hdr{background:linear-gradient(135deg,#3a2a1a,#5a3a28);border-radius:20px;padding:36px 28px;color:#fff;text-align:center;position:relative;overflow:hidden;margin-bottom:16px}
.hdr::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(-45deg,transparent,transparent 40px,rgba(255,255,255,.03) 40px,rgba(255,255,255,.03) 41px)}
.hdr h1{font-size:1.6rem;font-weight:700;letter-spacing:.04em;position:relative;z-index:1}
.hdr-meta{opacity:.5;font-size:.82em;margin-top:6px;position:relative;z-index:1}
.hdr-vs{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;position:relative;z-index:1}
.hdr-pill{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:50px;padding:4px 14px 4px 4px}
.hdr-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.av-s{background:linear-gradient(135deg,#8b5e3c,#d4956a);color:#fff}
.av-p{background:linear-gradient(135deg,#4a7b6f,#6faa9c);color:#fff}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.stat{background:#fdfaf6;border-radius:12px;padding:18px 12px 16px;text-align:center;box-shadow:0 2px 8px rgba(58,42,26,.04);position:relative}
.stat::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:32px;height:3px;background:linear-gradient(90deg,#c68642,#d4956a);border-radius:2px 2px 0 0}
.stat-num{font-size:1.5rem;font-weight:700;color:#8b5e3c;font-variant-numeric:tabular-nums}
.stat-lbl{font-size:.76em;color:#8a7a6a;margin-top:6px}
.disc{text-align:center;font-size:.74em;color:#8a7a6a;padding:20px 16px;border-top:1.5px solid #e8d5c0;line-height:2}
.brand{font-weight:700;color:#c68642;margin-top:10px;letter-spacing:.06em}
@media(max-width:600px){.stats{grid-template-columns:1fr}}
</style></head>
<body><div class="c">
<div class="hdr">
  <h1>🍪 微信聊天人格分析报告</h1>
  <div class="hdr-meta">${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})}</div>
  <div class="hdr-vs">
    <div class="hdr-pill"><div class="hdr-av av-s">${selfName.charAt(0)}</div><span style="font-size:.85em;font-weight:600">${selfName}</span></div>
    ${hasPartner ? `<span style="opacity:.35;font-weight:200">VS</span><div class="hdr-pill"><div class="hdr-av av-p">${partnerName.charAt(0)}</div><span style="font-size:.85em;font-weight:600">${partnerName}</span></div>` : ''}
  </div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-num">${s.total.toLocaleString()}</div><div class="stat-lbl">${selfName} 发出的消息</div></div>
  <div class="stat"><div class="stat-num">${s.avgLength}</div><div class="stat-lbl">平均消息字数</div></div>
  <div class="stat"><div class="stat-num">${spanStr}</div><div class="stat-lbl">数据覆盖时长</div></div>
</div>
${section('📊 消息行为分析', chartsHTML)}
${big5HTML ? section('🧠 大五人格分析 (Big Five)', big5HTML) : ''}
${mbtiHTML ? section('🔮 MBTI 推断', mbtiHTML) : ''}
${styleHTML ? section('✨ AI 对' + (hasDualAI ? '你们' : '你') + '的总结', styleHTML) : ''}
${reliability ? `<div style="font-size:.78em;color:#8a7a6a;text-align:center;padding:12px">📋 ${reliability}</div>` : ''}
<div class="disc">⚠️ 本报告基于语言模式的统计推断，仅供娱乐与自我探索，不构成心理学诊断。<br>MBTI 信效度存在学术争议；Big Five 具有更强的研究支撑，但仍需谨慎解读。<div class="brand">🍪 姜饼探AI · Ginger Report v2.0</div></div>
</div></body></html>`;

  return html;
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
      if (STATE.rawData.self.length + STATE.rawData.partner.length < 10) {
        throw new Error('请至少输入 10 条消息');
      }
    }

    if (!STATE.rawData || (STATE.rawData.self.length + STATE.rawData.partner.length < 10)) {
      throw new Error('请先上传聊天数据或输入至少 10 条消息');
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
    const reportHTML = generateReportHTML();

    // Step 3: Show report
    updateProgress(40, '正在渲染报告...');
    const reportContent = document.getElementById('reportContent');
    reportContent.innerHTML = reportHTML;
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
        const newHTML = generateReportHTML();
        reportContent.innerHTML = newHTML;
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
  const reportHTML = document.getElementById('reportContent').innerHTML;
  if (!reportHTML) return;
  const html = generateReportHTML(); // re-generate for full HTML
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