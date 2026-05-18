// ── 全局状态 ──────────────────────────────────────────
const STATE = {
  mode: 'file',
  rawData: null,        // { self: [], partner: [] } — messages array
  stats: null,          // computed statistics
  charts: {},           // ECharts instances
  personality: null,    // AI analysis result
  detectedNames: null,  // { self: '', partner: '' } — auto-detected from file
};

// ── 中文停用词 ────────────────────────────────────────
const STOPWORDS = new Set([
  // 对齐 Python jieba 版本的停用词（仅保留虚词/功能词）
  '的','了','是','在','我','你','他','她','它','们','这','那','就','都','和','与',
  '但','也','很','有','没','不','一','个','上','对','说','好','要','么','啊','呢',
  '吧','哦','嗯','然后','所以','因为','如果','可以','还是','已经','什么','怎么',
  '为什么','就是','还有','其实','感觉','觉得','现在','时候','一个','这个','那个',
  '一下','一起','一直','一样','一点','一些',
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
  document.getElementById('uploadHint').textContent = '自动识别格式：CSV / JSON / TXT / Markdown';
}

function handleFile(file) {
  document.getElementById('uploadFileName').textContent = '📎 ' + file.name;
  const ext = file.name.split('.').pop().toLowerCase();

  // Extract partner hint from file name (e.g. "张依婷.json" → "张依婷")
  // Remove extension and common suffixes like (1), _backup, etc.
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[\s_]*\(\d+\)\s*$/, '').trim();
  STATE._fileBaseName = baseName || null;

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    let parsed = false;
    // Try preferred parser first, then all as fallback
    const preferred = { csv: parseCSV, json: parseJSON, md: parseMarkdown, markdown: parseMarkdown, txt: parseTXT };
    const parsers = [];
    if (preferred[ext]) parsers.push(preferred[ext]);
    [parseJSON, parseCSV, parseTXT, parseMarkdown].forEach(p => { if (!parsers.includes(p)) parsers.push(p); });

    for (const parseFn of parsers) {
      try {
        STATE.rawData = { self: [], partner: [] };
        STATE.detectedNames = null;
        parseFn(text);
        const total = STATE.rawData.self.length + STATE.rawData.partner.length;
        if (total >= 5) {
          autoDetectNames();
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

function autoDetectNames() {
  const selfField = document.getElementById('selfName');
  const partnerField = document.getElementById('partnerName');
  const hint = document.getElementById('nameHint');

  // Collect all unique names from both sides
  const allNames = {};
  [...STATE.rawData.self, ...STATE.rawData.partner].forEach(m => {
    if (m.senderName) allNames[m.senderName] = (allNames[m.senderName] || 0) + 1;
  });
  const names = Object.entries(allNames).sort((a, b) => b[1] - a[1]);

  // Collect names per side
  const selfNames = {};
  const partnerNames = {};
  STATE.rawData.self.forEach(m => { if (m.senderName) selfNames[m.senderName] = (selfNames[m.senderName] || 0) + 1; });
  STATE.rawData.partner.forEach(m => { if (m.senderName) partnerNames[m.senderName] = (partnerNames[m.senderName] || 0) + 1; });

  const topSelf = Object.entries(selfNames).sort((a, b) => b[1] - a[1])[0];
  const topPartner = Object.entries(partnerNames).sort((a, b) => b[1] - a[1])[0];

  // Determine names: prefer top from each side, fallback to overall top 2
  let selfName = topSelf?.[0] || '';
  let partnerName = topPartner?.[0] || '';

  // If both sides have the same name (bad split), use overall top 2
  if (selfName && selfName === partnerName && names.length >= 2) {
    selfName = names[0][0];
    partnerName = names[1][0];
  }
  // If one side is empty, use overall top 2
  if (!selfName && names.length >= 1) selfName = names[0][0];
  if (!partnerName && names.length >= 2) partnerName = names[1][0];

  if (selfName) {
    selfField.value = selfName;
    STATE.detectedNames = { self: selfName };
  }
  if (partnerName) {
    partnerField.value = partnerName;
    STATE.detectedNames = { ...(STATE.detectedNames || {}), partner: partnerName };
  }

  if (selfName || partnerName) {
    const display = [selfName, partnerName].filter(Boolean).join(' & ');
    hint.textContent = '✅ 已自动识别：' + display;
    hint.style.color = '#4a7b6f';
  }
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
    colMap = { ts: 0, sender: 1, content: 2, isSender: -1 };
  }

  if (colMap.content === undefined) {
    const firstLine = parseCSVLine(lines[dataStart]);
    colMap.content = firstLine.length - 1;
  }

  // Validate content column
  let validContent = 0;
  for (let i = dataStart; i < Math.min(dataStart + 5, lines.length); i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols[colMap.content] && cols[colMap.content].trim().length > 0) validContent++;
  }
  if (validContent === 0) {
    const firstLine = parseCSVLine(lines[dataStart]);
    for (let c = 0; c < firstLine.length; c++) {
      if (firstLine[c] && firstLine[c].trim().length > 1) {
        colMap.content = c;
        break;
      }
    }
  }

  // Two-pass: first collect all rows, then determine self/partner
  const allRows = [];
  const senderNames = new Set();
  let hasIsSender = false;

  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols.length) continue;
    const content = (cols[colMap.content] || '').trim();
    if (!content) continue;

    let ts;
    if (colMap.ts !== undefined && cols[colMap.ts]) {
      const v = cols[colMap.ts].trim();
      ts = /^\d+$/.test(v) ? parseInt(v) : new Date(v).getTime() / 1000;
    }

    if (colMap.type !== undefined) {
      const t = cols[colMap.type].trim();
      if (t && t !== '1' && t !== 'text') continue;
    }

    let isSenderRaw = null;
    if (colMap.isSender !== undefined) {
      const v = cols[colMap.isSender].trim();
      isSenderRaw = v === '1' || v === 'true' || v === '我' || /self|me/i.test(v);
      if (isSenderRaw) hasIsSender = true;
    }

    const senderName = (colMap.sender !== undefined && cols[colMap.sender]) ? cols[colMap.sender].trim() : '';
    if (senderName) senderNames.add(senderName);

    allRows.push({ content: cleanMessage(content), ts, senderName, isSenderRaw });
  }

  // Determine self/partner
  const names = [...senderNames];
  const fileBaseName = STATE._fileBaseName;
  let partnerFromFileName = '';
  if (fileBaseName && names.length >= 2) {
    const match = names.find(n => fileBaseName.includes(n) || n.includes(fileBaseName));
    if (match) partnerFromFileName = match;
  }

  STATE.rawData = { self: [], partner: [] };
  for (const row of allRows) {
    let isSelf;
    if (hasIsSender && row.isSenderRaw !== null) {
      isSelf = row.isSenderRaw;
    } else if (partnerFromFileName) {
      isSelf = row.senderName !== partnerFromFileName;
    } else if (names.length >= 2) {
      const selfVal = document.getElementById('selfName').value;
      isSelf = row.senderName === '我' || (selfVal && row.senderName === selfVal);
      if (!isSelf && row.senderName !== '我' && !selfVal) {
        isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
      }
    } else {
      isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
    }
    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({
      content: row.content, ts: row.ts, senderName: row.senderName
    });
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

  // First pass: collect all messages with raw data
  const allMsgs = [];
  const nameSet = {};
  for (const m of messages) {
    const msgType = m.type ?? m.msg_type;
    if (msgType === 10000 || msgType === 'system') continue;
    if (msgType && msgType !== 1 && msgType !== 'text' && msgType !== '1') continue;

    const content = cleanMessage(String(m.content || m.text || m.message || m.msg || ''));
    if (!content) continue;

    let ts;
    if (m.timestamp) ts = /^\d{10,13}$/.test(String(m.timestamp)) ? parseInt(m.timestamp) : new Date(m.timestamp).getTime() / 1000;
    else if (m.time) ts = new Date(m.time).getTime() / 1000;
    else if (m.datetime) ts = new Date(m.datetime).getTime() / 1000;
    else if (m.create_time) ts = parseInt(m.create_time);
    else if (m.ts) ts = parseInt(m.ts);

    const senderName = m.display_name || m.sender_name || m.senderName || m.name || '';
    const isSenderRaw = m.is_sender;
    allMsgs.push({ content, ts, senderName, isSenderRaw });
    if (senderName) nameSet[senderName] = (nameSet[senderName] || 0) + 1;
  }

  // Determine self/partner split
  const hasSenderFlag = allMsgs.some(m => m.isSenderRaw === true || m.isSenderRaw === 1);
  const names = Object.keys(nameSet);
  const fileBaseName = STATE._fileBaseName;

  // Find partner name from file name: "张依婷.json" → partner is "张依婷"
  let partnerFromFileName = '';
  if (fileBaseName && names.length >= 2) {
    // Exact match or contains match
    const match = names.find(n => fileBaseName.includes(n) || n.includes(fileBaseName));
    if (match) partnerFromFileName = match;
  }

  STATE.rawData = { self: [], partner: [] };
  for (const msg of allMsgs) {
    let isSelf;
    if (hasSenderFlag) {
      isSelf = msg.isSenderRaw === true || msg.isSenderRaw === 1;
    } else if (partnerFromFileName) {
      // File name matches one sender — that's the partner
      isSelf = msg.senderName !== partnerFromFileName;
    } else if (names.length >= 2) {
      isSelf = msg.senderName === names[0];
    } else {
      isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
    }
    delete msg.isSenderRaw;
    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push(msg);
  }

  if (STATE.rawData.self.length + STATE.rawData.partner.length < 2) {
    throw new Error('JSON 中消息数量不足');
  }
}

function parseTXT(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());

  // Common patterns: "Name: message", "Name - message", "YYYY-MM-DD HH:MM Name message"
  const patterns = [
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)[：:]\s*(.+)$/,
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)\s+(.+)$/,
    /^(.+?)[：:]\s*(.+)$/,
    /^(.+?)\s+-\s+(.+)$/,
    /^(.+?)\s{2,}(.+)$/,
  ];

  // Two-pass: collect all parsed rows first
  const allRows = [];
  const senderNames = new Set();
  const unmatchedLines = [];

  for (const line of lines) {
    let matched = false;
    for (const re of patterns) {
      const m = line.match(re);
      if (m) {
        const sender = m[1].trim();
        const content = cleanMessage(m[2].trim());
        if (!content) break;
        allRows.push({ content, senderName: sender, ts: null });
        if (sender) senderNames.add(sender);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const content = cleanMessage(line);
      if (content) unmatchedLines.push(content);
    }
  }

  // Determine self/partner using file name hint
  const names = [...senderNames];
  const fileBaseName = STATE._fileBaseName;
  let partnerFromFileName = '';
  if (fileBaseName && names.length >= 2) {
    const match = names.find(n => fileBaseName.includes(n) || n.includes(fileBaseName));
    if (match) partnerFromFileName = match;
  }

  STATE.rawData = { self: [], partner: [] };

  for (const row of allRows) {
    let isSelf;
    if (partnerFromFileName) {
      isSelf = row.senderName !== partnerFromFileName;
    } else {
      const selfVal = document.getElementById('selfName').value;
      isSelf = row.senderName === '我' || (selfVal && row.senderName === selfVal);
      if (!isSelf && row.senderName !== '我' && !selfVal && names.length >= 2) {
        isSelf = row.senderName === names[0];
      } else if (!isSelf && names.length < 2) {
        isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
      }
    }
    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push(row);
  }

  // Unmatched lines go to alternating
  for (const content of unmatchedLines) {
    const isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content, ts: null, senderName: '' });
  }

  if (STATE.rawData.self.length < 2 && STATE.rawData.partner.length < 2) {
    throw new Error('TXT 解析失败，请使用"发送者: 内容"格式，每行一条');
  }
}

function parseMarkdown(raw) {
  const lines = raw.split(/\r?\n/);

  const mdPattern = /^\s*(?:[-*]\s+)?(?:\*\*|__)?(.+?)(?:\*\*|__)?[：:]\s*(.+)$/;
  const quotePattern = /^>\s*(.+?)[：:]\s*(.+)$/;

  // Two-pass: collect all parsed rows first
  const allRows = [];
  const senderNames = new Set();

  for (const line of lines) {
    let m = line.match(mdPattern) || line.match(quotePattern);
    if (m) {
      const sender = m[1].trim();
      const content = cleanMessage(m[2].trim());
      if (!content) continue;
      allRows.push({ content, senderName: sender, ts: null });
      if (sender) senderNames.add(sender);
    }
  }

  // Determine self/partner using file name hint
  const names = [...senderNames];
  const fileBaseName = STATE._fileBaseName;
  let partnerFromFileName = '';
  if (fileBaseName && names.length >= 2) {
    const match = names.find(n => fileBaseName.includes(n) || n.includes(fileBaseName));
    if (match) partnerFromFileName = match;
  }

  STATE.rawData = { self: [], partner: [] };
  for (const row of allRows) {
    let isSelf;
    if (partnerFromFileName) {
      isSelf = row.senderName !== partnerFromFileName;
    } else {
      const selfVal = document.getElementById('selfName').value;
      isSelf = row.senderName === '我' || (selfVal && row.senderName === selfVal);
      if (!isSelf && row.senderName !== '我' && !selfVal && names.length >= 2) {
        isSelf = row.senderName === names[0];
      } else if (!isSelf && names.length < 2) {
        isSelf = STATE.rawData.self.length <= STATE.rawData.partner.length;
      }
    }
    (isSelf ? STATE.rawData.self : STATE.rawData.partner).push(row);
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

// ── 中文词典 (常见2-4字词，500+条) ─────────────────────
const DICT = new Set([
  // ── 2字高频核心词 ──
  '学习','考试','成绩','作业','老师','同学','学校','上课','放学','放假','复习','预习',
  '数学','语文','英语','化学','物理','生物','历史','地理','政治','音乐','美术','体育',
  '爸爸','妈妈','爷爷','奶奶','哥哥','姐姐','弟弟','妹妹','叔叔','阿姨','朋友','闺蜜',
  '喜欢','开心','难过','生气','害怕','担心','紧张','激动','失望','伤心','后悔','感动',
  '谢谢','抱歉','对不起','没事','客气','麻烦','帮忙','拜托','打扰',
  '吃饭','喝水','睡觉','起床','洗澡','出门','回家','上班','下班','加班','休息','运动',
  '聊天','说话','告诉','回答','解释','道歉','安慰','鼓励','支持','帮助','陪伴',
  '好看','漂亮','可爱','帅气','厉害','聪明','有趣','无聊','奇怪','搞笑','感人','温暖',
  '照片','视频','语音','表情','红包','转账','朋友圈','公众号','小程序','群聊',
  '明天','昨天','今天','后天','前天','早上','中午','下午','晚上','凌晨','周末','假期',
  '分钟','小时','秒钟','真的','确实','当然','绝对','肯定','可能','也许','大概','应该',
  '感觉','觉得','认为','相信','希望','期待','想象','回忆','忘记','记得','发现','注意',
  '开始','结束','继续','停止','放弃','坚持','尝试','努力','成功','失败','进步','退步',
  '手机','电脑','平板','耳机','充电','网络','信号','密码','账号','软件','应用',
  '奶茶','咖啡','饮料','零食','水果','蛋糕','火锅','烧烤','外卖','食堂','餐厅','超市',
  '衣服','裤子','鞋子','裙子','帽子','围巾','手套','外套','包包',
  '感冒','发烧','咳嗽','头疼','肚子','医院','吃药','打针','手术','住院','康复','健康',
  // ── 2字情感/社交词 ──
  '微笑','大笑','苦笑','冷笑','痛哭','流泪','叹气','拥抱','牵手','亲吻','撒娇','吃醋',
  '想念','思念','牵挂','依赖','信任','尊重','理解','包容','体谅','迁就','忍让','妥协',
  '承诺','誓言','约定','纪念','惊喜','浪漫','甜蜜','幸福','满足','安心','踏实','放心',
  '孤独','寂寞','空虚','疲惫','烦躁','郁闷','委屈','心酸','心碎','绝望','崩溃','无奈',
  '羡慕','嫉妒','骄傲','自卑','敏感','脆弱','坚强','勇敢','独立','自信','谦虚','诚实',
  // ── 2字日常动作 ──
  '走路','跑步','游泳','打球','唱歌','跳舞','画画','拍照','逛街','购物','旅游','出差',
  '做饭','洗碗','打扫','整理','收拾','洗衣','晾衣','浇花','养猫','养狗','种花','钓鱼',
  '看书','读报','写字','画画','弹琴','下棋','打牌','玩游戏','看电影','听歌','追剧',
  '排队','等车','坐车','开车','骑车','堵车','晕车','加油','停车','导航','路线','机场',
  '快递','包裹','签收','退货','下单','付款','收款','转账','充值','缴费','退款','发票',
  // ── 2字名词/事物 ──
  '天气','下雨','下雪','刮风','晴天','阴天','雾霾','台风','地震','洪水','干旱','雷电',
  '春天','夏天','秋天','冬天','元旦','春节','元宵','清明','端午','中秋','国庆','除夕',
  '生日','婚礼','葬礼','聚会','约会','面试','考试','竞赛','比赛','演出','展览','讲座',
  '工资','房租','水电','账单','贷款','存款','理财','股票','基金','保险','税收','消费',
  '爱情','亲情','友情','感情','情绪','心情','心态','性格','人格','气质','魅力','颜值',
  '梦想','理想','目标','计划','安排','方案','策略','方法','技巧','经验','教训','智慧',
  '知识','文化','教育','科学','技术','艺术','文学','哲学','宗教','历史','地理','天文',
  '国家','社会','家庭','学校','公司','单位','社区','城市','乡村','地球','宇宙','世界',
  // ── 2字状态/程度 ──
  '严重','轻微','明显','模糊','清楚','简单','复杂','容易','困难','安全','危险','紧急',
  '正常','异常','特别','普通','优秀','完美','糟糕','讨厌','喜欢','热爱','沉迷','厌倦',
  '积极','消极','主动','被动','热情','冷淡','亲密','疏远','熟悉','陌生','自然','刻意',
  '突然','忽然','逐渐','慢慢','立刻','马上','暂时','永久','偶尔','经常','总是','从来',
  // ── 2字连接/逻辑 ──
  '虽然','但是','因此','不过','然而','而且','另外','同时','否则','既然','尽管','除非',
  '关于','对于','至于','根据','按照','通过','经过','利用','采取','进行','实现','达到',
  // ── 2字高频口语词 (参考词云补充) ──
  '这么','那么','怎样','如何','什么','为何','哪里','哪个','哪些','几个','多少','几时',
  '不是','不会','不能','不要','不行','不好','不够','不对','不错','不赖','不差',
  '没有','没人','没事','没用','没门','没空','没戏','没错','没劲','没辙',
  '我们','你们','他们','她们','它们','大家','别人','人家','自己','对方',
  '知道','觉得','认为','以为','相信','明白','清楚','了解','懂得','理解',
  '意思','意思意思','看到','见到','听见','听说','发现','想起','忘记','记得',
  '正常','普通','一般','特别','奇怪','搞笑','无聊','有趣','好玩','有意思',
  '回来','过去','出来','进去','起来','下去','上来','下来','过来','过去',
  '时候','时间','日子','今天','明天','昨天','前天','后天','早上','晚上',
  '东西','事情','问题','想法','办法','方法','原因','理由','借口','情况',
  '应该','可以','可能','愿意','想要','需要','必须','只好','不得不',
  '这样','那样','怎样','怎么样','怎么回事','为什么','凭什么',
  '嘻嘻','哈哈','嘿嘿','呵呵','呜呜','嘤嘤','么么','拜拜',
  '不要','别闹','别说','别问','别急','别怕','别哭','别笑',
  '真的','确实','的确','实在','简直','根本','完全','绝对',
  '已经','曾经','正在','将要','快要','就要','马上','立刻',
  '其实','事实','真相','本来','原来','到底','究竟','毕竟',
  '一下','一直','一起','一样','一般','一切','一律','一向',
  '之后','以前','然后','接着','于是','随后','最后','首先',
  '不错','可以','挺好','还行','凑合','马马虎虎','将就','随便',
  '喜欢','爱','热爱','讨厌','恨','嫌弃','无所谓','不在乎',
  '开心','高兴','快乐','难过','伤心','生气','郁闷','烦躁',
  '谢谢','感谢','多谢','客气','不谢','不用谢','应该的',
  '对不起','抱歉','不好意思','见谅','包涵','海涵','恕罪',
  '晚安','早安','午安','你好','嗨','哈喽','再见','拜拜',
  '好的','可以','没问题','行','嗯','哦','啊','呢',
  '吃饭','睡觉','上班','下班','上学','放学','回家','出门',
  '好看','漂亮','可爱','帅气','酷','美','丑','帅',
  '厉害','牛','强','棒','差','弱','菜','渣',
  '聪明','笨','傻','机智','机灵','呆','木','愣',
  '有趣','无聊','好玩','没意思','有意思','搞笑','逗','乐',
  '温暖','寒冷','热','冷','凉','暖','酷','爽',
  '健康','生病','难受','舒服','痛苦','开心','快乐','幸福',
  '安全','危险','放心','担心','害怕','紧张','放松','淡定',
  '成功','失败','赢','输','赢了','输了','胜','败',
  '开始','结束','继续','暂停','停止','中断','完成','搞定',
  '努力','加油','奋斗','拼搏','坚持','放弃','躺平','摆烂',
  '进步','退步','提高','降低','上升','下降','增长','减少',
  '多','少','大','小','长','短','高','低','快','慢','新','旧',
  '好','坏','美','丑','善','恶','真','假','对','错',
  '你','我','他','她','它','谁','哪','什么','怎么','几',
  '这','那','哪','这里','那里','哪里','这边','那边',
  '今','明','昨','前','后','上','下','左','右','中',
  '天','年','月','日','周','星期','号','点','分','秒',
  '人','物','事','情','话','声','色','味','形','样',
  '心','眼','耳','口','手','脚','头','身','脸','发',
  '爸','妈','爷','奶','哥','姐','弟','妹','叔','姨',
  '男','女','老','少','大','小','新','旧','好','坏',
  '吃','喝','睡','起','走','跑','跳','飞','游','唱',
  '看','听','说','读','写','画','弹','拉','打','拍',
  '买','卖','送','收','给','要','拿','放','用','做',
  '想','念','思','忆','忘','记','知','觉','感','受',
  '爱','恨','喜','怒','哀','乐','悲','欢','苦','甜',
  '生','死','存','亡','来','去','进','出','回','到',
  '开','关','启','停','动','静','起','落','升','降',
  '有','无','是','非','真','假','对','错','好','坏',
  '能','会','可','应','要','需','必','敢','肯','愿',
  '很','最','更','太','真','好','挺','颇','甚','极',
  '都','全','总','只','仅','光','净','独','专','特',
  '正','刚','才','就','便','已','曾','将','要','会',
  '和','与','或','但','而','虽','却','既','又','也',
  '因为','所以','如果','那么','虽然','但是','不过','然而',
  '其实','事实','真相','本来','原来','到底','究竟','毕竟',
  '已经','曾经','正在','将要','快要','就要','马上','立刻',
  '一下','一直','一起','一样','一般','一切','一律','一向',
  '之后','以前','然后','接着','于是','随后','最后','首先',
  '不错','可以','挺好','还行','凑合','马马虎虎','将就','随便',
  '喜欢','爱','热爱','讨厌','恨','嫌弃','无所谓','不在乎',
  '开心','高兴','快乐','难过','伤心','生气','郁闷','烦躁',
  '谢谢','感谢','多谢','客气','不谢','不用谢','应该的',
  '对不起','抱歉','不好意思','见谅','包涵','海涵','恕罪',
  '晚安','早安','午安','你好','嗨','哈喽','再见','拜拜',
  '好的','可以','没问题','行','嗯','哦','啊','呢',
  '吃饭','睡觉','上班','下班','上学','放学','回家','出门',
  '好看','漂亮','可爱','帅气','酷','美','丑','帅',
  '厉害','牛','强','棒','差','弱','菜','渣',
  '聪明','笨','傻','机智','机灵','呆','木','愣',
  '有趣','无聊','好玩','没意思','有意思','搞笑','逗','乐',
  '温暖','寒冷','热','冷','凉','暖','酷','爽',
  '健康','生病','难受','舒服','痛苦','开心','快乐','幸福',
  '安全','危险','放心','担心','害怕','紧张','放松','淡定',
  '成功','失败','赢','输','赢了','输了','胜','败',
  '开始','结束','继续','暂停','停止','中断','完成','搞定',
  '努力','加油','奋斗','拼搏','坚持','放弃','躺平','摆烂',
  '进步','退步','提高','降低','上升','下降','增长','减少',
  // ── 3字词 ──
  '不好意思','没关系','不知道','真的吗','为什么','怎么办','还可以','差不多',
  '哈哈哈','嘿嘿嘿','嗯嗯嗯','好好好','对对对','加油啊','辛苦了','早点睡','晚安啦',
  '想你了','想见你','想回家','想出去','想吃啥','想干嘛',
  '开心啊','好看啊','漂亮啊','可爱啊','厉害啊','聪明啊',
  '谢谢啊','没事的','别担心','吃饭了','睡觉了','起床了','出门了','回家了','到家了',
  '拍照片','发红包','朋友圈','聊天记录',
  '小可爱','小宝贝','小傻瓜','小笨蛋','小仙女','小哥哥','小姐姐','小弟弟','小妹妹',
  '怎么了','真的吗','好的呀','可以啊','没问题','当然啦','随便你','无所谓','不知道',
  '太好了','太棒了','太厉害','太可爱','太漂亮','太搞笑','太感动','太温暖','太委屈',
  '有点累','有点饿','有点冷','有点热','有点困','有点烦','有点忙','有点想','有点怕',
  '不要了','别说了','别问了','别闹了','别生气','别难过','别担心','别着急','别客气',
  '好开心','好难过','好想你','好喜欢','好漂亮','好厉害','好聪明','好有趣','好温暖',
  '在一起','分手吧','我爱你','我想你','对不起','谢谢你','不客气','没关系','打扰了',
  // ── 4字词 ──
  '真的不好意思','没有没有','加油加油','辛苦辛苦',
  '晚安晚安','好好学习','天天向上','努力加油','坚持下去','继续加油',
  '生日快乐','新年快乐','节日快乐','恭喜发财','万事如意','心想事成',
  '一路顺风','注意安全','注意身体','好好休息','好好吃饭',
  '开开心心','快快乐乐','平平安安','健健康康','顺顺利利',
  '不好意思','不知道的','没必要的','应该的啦','随便你啦','无所谓啦',
  '想你了呢','好想你呢','好喜欢你','超级喜欢','特别喜欢','非常喜欢',
  '晚安好梦','好梦成真','心想事成','万事顺意','天天开心','永远幸福',
  '么么哒','哈哈哈','嘿嘿嘿','嘻嘻嘻','咯咯咯','呜呜呜','嘤嘤嘤',
  // ── 5字+常用短语 ──
  '我好想你','我真的好想','你在哪里','你在干嘛','你在干什么','你在忙吗',
  '吃了吗','吃了没','睡了吗','睡了没','到家了吗','到家了没',
  '好的好的','嗯嗯好的','收到收到','了解了解','可以可以','没问题的',
  '我爱你哦','我想你哦','么么哒哦','晚安哦','早安哦','拜拜哦',
]);

// ── 中文分词 (词典优先 + N-gram + 英文词) ──────────────
function segmentChinese(text) {
  // Split into Chinese runs and non-Chinese runs
  const tokens = text.split(/([a-zA-Z]{2,}|[一-鿿]+)/g).filter(Boolean);
  const words = [];

  for (const token of tokens) {
    // English words (2+ chars): keep as-is (lowercase for frequency grouping)
    if (/^[a-zA-Z]{2,}$/.test(token)) {
      const lw = token.toLowerCase();
      if (!STOPWORDS.has(lw) && lw.length >= 2) words.push(lw);
      continue;
    }
    // Chinese run: forward max matching
    const seg = token;
    let i = 0;
    while (i < seg.length) {
      let found = false;
      for (let len = 4; len >= 2; len--) {
        if (i + len <= seg.length) {
          const w = seg.substring(i, i + len);
          if (DICT.has(w) && !STOPWORDS.has(w)) {
            words.push(w);
            i += len;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        if (i + 2 <= seg.length) {
          const bg = seg.substring(i, i + 2);
          if (!STOPWORDS.has(bg) && !/^\d+$/.test(bg)) {
            words.push(bg);
          }
        }
        i++;
      }
    }
  }
  return words;
}

// ── 统计计算 ──────────────────────────────────────────

function computeStats() {
  if (!STATE.rawData) throw new Error('请先上传聊天数据');

  const selfMsgs = STATE.rawData.self || [];
  const partnerMsgs = STATE.rawData.partner || [];
  const allRaw = [...selfMsgs, ...partnerMsgs];

  if (selfMsgs.length < 5) throw new Error('自己消息数量不足（需要至少 5 条）');

  // ── Self stats ──
  const selfText = selfMsgs.map(m => m.content);
  // Filter for word frequency: exclude system msgs, emoji-only, very short
  const selfCleanForWords = selfText.filter(t =>
    t.length >= 2 &&
    !/^(以上|我通过了|系统消息|图片|语音|视频|文件|表情包|链接|撤回了一条消息)/.test(t) &&
    !/^\[.+\]$/.test(t) &&
    !/^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u.test(t)
  );
  const selfAllText = selfCleanForWords.join(' ');
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
    const pCleanForWords = pText.filter(t =>
      t.length >= 2 &&
      !/^(以上|我通过了|系统消息|图片|语音|视频|文件|表情包|链接|撤回了一条消息)/.test(t) &&
      !/^\[.+\]$/.test(t) &&
      !/^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u.test(t)
    );
    const pAllText = pCleanForWords.join(' ');
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

  // ── Reply speed analysis ──
  const allMsgs = [...selfMsgs.map(m => ({...m, who:'self'})), ...partnerMsgs.map(m => ({...m, who:'partner'}))]
    .filter(m => m.ts).sort((a, b) => a.ts - b.ts);
  const selfReplyTimes = [];  // time (sec) for self to reply to partner
  const partnerReplyTimes = [];
  for (let i = 1; i < allMsgs.length; i++) {
    const gap = allMsgs[i].ts - allMsgs[i-1].ts;
    if (gap > 0 && gap < 3600 * 24) { // within 24h
      if (allMsgs[i].who === 'self' && allMsgs[i-1].who === 'partner') selfReplyTimes.push(gap);
      if (allMsgs[i].who === 'partner' && allMsgs[i-1].who === 'self') partnerReplyTimes.push(gap);
    }
  }
  const avgReply = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  const medianReply = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a,b)=>a-b);
    return s[Math.floor(s.length/2)];
  };
  const replySpeed = {
    selfAvg: avgReply(selfReplyTimes), selfMedian: medianReply(selfReplyTimes), selfCount: selfReplyTimes.length,
    partnerAvg: avgReply(partnerReplyTimes), partnerMedian: medianReply(partnerReplyTimes), partnerCount: partnerReplyTimes.length,
  };

  // ── Emotion keywords ──
  const EMO = {
    positive: ['开心','快乐','高兴','喜欢','爱','感谢','谢谢','棒','好','厉害','漂亮','可爱','有趣','幸福','满足','期待','感动','温暖','甜蜜','兴奋','哈哈','嘿嘿'],
    negative: ['难过','伤心','生气','害怕','担心','紧张','失望','后悔','烦','累','无聊','孤独','焦虑','痛苦','讨厌','累','困','头疼','崩溃','无语','尴尬'],
    question: ['吗','呢','什么','怎么','为什么','哪','谁','几','是否'],
  };
  function countEmotion(texts) {
    const result = { positive: 0, negative: 0, question: 0 };
    for (const t of texts) {
      for (const w of EMO.positive) if (t.includes(w)) result.positive++;
      for (const w of EMO.negative) if (t.includes(w)) result.negative++;
      for (const w of EMO.question) if (t.includes(w)) result.question++;
    }
    return result;
  }
  const selfEmotion = countEmotion(selfText);
  const hasPartner = !!partnerStats;
  const partnerEmotion = hasPartner ? countEmotion(partnerMsgs.map(m => m.content)) : null;

  STATE.stats = {
    self: {
      total: selfMsgs.length,
      avgLength,
      wordFreq: selfWordFreq,
      topWords: topWordsSelf,
      hourly, weekday, daily, monthly, lengths, timeRange,
      replySpeed, emotion: selfEmotion,
    },
    partner: partnerStats ? { ...partnerStats, emotion: partnerEmotion } : null,
    hasPartner: !!partnerStats,
  };
}

// ── 图表生成 (ECharts) ──────────────────────────────

function createCharts(containerId) {
  if (!STATE.stats) return;
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

  // Word cloud — combined self + partner
  function chartWordCloud() {
    const selfName = document.getElementById('selfName').value || '我';
    const partnerName = document.getElementById('partnerName').value || '对方';
    const hasPartner = STATE.stats.hasPartner && STATE.stats.partner;

    function filterWords(wordFreq, max) {
      return Object.entries(wordFreq)
        .filter(([w, v]) => {
          if (w.length < 2) return false;
          if (STOPWORDS.has(w)) return false;
          return true;
        })
        .slice(0, max)
        .map(([name, value]) => ({ name, value: Math.log(value + 1) * 10 }));
    }

    const BROWN = ['#8b5e3c','#c68642','#d4956a','#e8c49a'];
    const TEAL  = ['#4a7b6f','#6faa9c','#8abfb8','#b4d8d2'];

    // Self word cloud
    const selfEl = container.querySelector('#chart-wc-self');
    if (selfEl) {
      const selfChart = echarts.init(selfEl);
      const selfWords = filterWords(s.wordFreq, 50);
      if (selfWords.length > 0) {
        selfChart.setOption({
          title: { text: selfName + ' 的高频词', left: 'center', top: 4, textStyle: { fontSize: 13, fontWeight: 'bold', color: '#3a2a1a' } },
          tooltip: { show: true },
          series: [{
            type: 'wordCloud',
            shape: 'circle',
            sizeRange: [12, 52],
            rotationRange: [-45, 45],
            gridSize: 6,
            drawOutOfBound: false,
            textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif', fontWeight: 'normal' },
            color: function() { return BROWN[Math.floor(Math.random() * BROWN.length)]; },
            data: selfWords
          }]
        });
        STATE.charts['wc-self'] = selfChart;
      }
    }

    // Partner word cloud
    if (hasPartner) {
      const partnerEl = container.querySelector('#chart-wc-partner');
      if (partnerEl) {
        const partnerChart = echarts.init(partnerEl);
        const partnerWords = filterWords(STATE.stats.partner.wordFreq, 50);
        if (partnerWords.length > 0) {
          partnerChart.setOption({
            title: { text: partnerName + ' 的高频词', left: 'center', top: 4, textStyle: { fontSize: 13, fontWeight: 'bold', color: '#3a2a1a' } },
            tooltip: { show: true },
            series: [{
              type: 'wordCloud',
              shape: 'circle',
              sizeRange: [12, 52],
              rotationRange: [-45, 45],
              gridSize: 6,
              drawOutOfBound: false,
              textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif', fontWeight: 'normal' },
              color: function() { return TEAL[Math.floor(Math.random() * TEAL.length)]; },
              data: partnerWords
            }]
          });
          STATE.charts['wc-partner'] = partnerChart;
        }
      }
    } else {
      const partnerEl = container.querySelector('#chart-wc-partner');
      if (partnerEl) partnerEl.style.display = 'none';
    }
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

  // Custom HTML/CSS heatmap (GitHub-style calendar grid)
  window._initHeatmap = function(selfData, partnerData, hasPartner) {
    var SELF_PAL    = ['#EDE5DC','#D4A882','#B87040','#8B5E3C','#5A3020'];
    var PARTNER_PAL = ['#D8EDEA','#8ABFB8','#5A9B93','#4A7B6F','#2E5048'];
    var MON = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    var allKeys = Object.keys(selfData).concat(hasPartner ? Object.keys(partnerData) : []);
    var yearSet = {};
    allKeys.forEach(function(k) { yearSet[k.slice(0, 4)] = true; });
    var years = Object.keys(yearSet).sort();
    if (!years.length) return;

    var curYear = years[years.length - 1];
    var btnBox = document.getElementById('hm-year-btns');
    if (!btnBox) return;
    btnBox.innerHTML = '';

    years.forEach(function(y) {
      var btn = document.createElement('button');
      btn.className = 'hm-yr-btn' + (y === curYear ? ' hm-active' : '');
      btn.textContent = y;
      btn.onclick = function() {
        btnBox.querySelectorAll('.hm-yr-btn').forEach(function(b) { b.classList.remove('hm-active'); });
        btn.classList.add('hm-active');
        curYear = y;
        renderGrid('hm-self-grid', selfData, SELF_PAL);
        if (hasPartner) renderGrid('hm-partner-grid', partnerData, PARTNER_PAL);
      };
      btnBox.appendChild(btn);
    });

    function getColor(n, mx, pal) {
      if (!n || mx === 0) return pal[0];
      var r = n / mx;
      return r < 0.15 ? pal[1] : r < 0.40 ? pal[2] : r < 0.72 ? pal[3] : pal[4];
    }

    function ymd(d) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    function renderGrid(elId, data, pal) {
      var el = document.getElementById(elId);
      if (!el) return;
      el.innerHTML = '';

      var yr = parseInt(curYear, 10);
      var yrVals = [];
      Object.keys(data).forEach(function(k) {
        if (k.startsWith(curYear)) yrVals.push(+data[k]);
      });
      var mx = yrVals.length ? Math.max.apply(null, yrVals) : 1;

      var wrap = document.createElement('div');
      wrap.className = 'hm-flex';

      var dayCol = document.createElement('div');
      dayCol.className = 'hm-daycol';
      var sp = document.createElement('div');
      sp.className = 'hm-month-sp';
      dayCol.appendChild(sp);
      ['一','二','三','四','五','六','日'].forEach(function(lbl, i) {
        var d = document.createElement('div');
        d.className = 'hm-daylbl';
        d.textContent = (i % 2 === 0) ? lbl : '';
        dayCol.appendChild(d);
      });
      wrap.appendChild(dayCol);

      var scroll = document.createElement('div');
      scroll.className = 'hm-scroll';

      var jan1 = new Date(yr, 0, 1);
      var dow0 = (jan1.getDay() + 6) % 7;
      var startD = new Date(jan1);
      startD.setDate(startD.getDate() - dow0);

      var dec31 = new Date(yr, 11, 31);
      var dow31 = (dec31.getDay() + 6) % 7;
      var endD = new Date(dec31);
      endD.setDate(endD.getDate() + (6 - dow31));

      var cur = new Date(startD);
      var seenMon = {};

      while (cur <= endD) {
        var col = document.createElement('div');
        col.className = 'hm-col';

        var monLbl = document.createElement('div');
        monLbl.className = 'hm-monlbl';

        var weekEl = document.createElement('div');
        weekEl.className = 'hm-weekcol';

        for (var i = 0; i < 7; i++) {
          var inYr = cur.getFullYear() === yr;

          if (inYr && cur.getDate() === 1 && !seenMon[cur.getMonth()]) {
            monLbl.textContent = MON[cur.getMonth()];
            seenMon[cur.getMonth()] = true;
          }

          var cell = document.createElement('div');
          if (inYr) {
            var ds = ymd(cur);
            var n = +(data[ds] || 0);
            cell.className = 'hm-cell';
            cell.style.backgroundColor = getColor(n, mx, pal);
            cell.dataset.d = ds;
            cell.dataset.n = n;
          } else {
            cell.className = 'hm-cell hm-out';
          }
          weekEl.appendChild(cell);
          cur.setDate(cur.getDate() + 1);
        }

        col.appendChild(monLbl);
        col.appendChild(weekEl);
        scroll.appendChild(col);
      }

      wrap.appendChild(scroll);
      el.appendChild(wrap);
    }

    renderGrid('hm-self-grid', selfData, SELF_PAL);
    if (hasPartner) renderGrid('hm-partner-grid', partnerData, PARTNER_PAL);

    // Tooltip (only create once)
    if (!document.querySelector('.hm-tip')) {
      var tip = document.createElement('div');
      tip.className = 'hm-tip';
      document.body.appendChild(tip);

      document.addEventListener('mouseover', function(e) {
        var t = e.target;
        if (t.classList && t.classList.contains('hm-cell') && t.dataset && t.dataset.d) {
          var n = +t.dataset.n;
          tip.textContent = t.dataset.d + (n > 0 ? '  ·  ' + n + ' 条' : '  ·  无消息');
          tip.style.display = 'block';
        }
      });
      document.addEventListener('mouseout', function(e) {
        if (e.target.classList && e.target.classList.contains('hm-cell')) {
          tip.style.display = 'none';
        }
      });
      document.addEventListener('mousemove', function(e) {
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top  = (e.clientY - 38) + 'px';
      });
    }
  };

  // Execute
  chartHourly();
  chartMonthly();
  chartWeekday();
  chartLengthDist();

  chartWordCloud();

  // Custom HTML/CSS heatmap (GitHub-style calendar grid)
  if (window._initHeatmap && Object.keys(s.daily).length > 0) {
    window._initHeatmap(s.daily, STATE.stats.hasPartner ? STATE.stats.partner?.daily || {} : {}, STATE.stats.hasPartner && !!STATE.stats.partner);
  }
}

// ── AI 人格分析 ──────────────────────────────────────

async function streamAIRequest(endpoint, headers, body, onChunk, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (attempt < maxRetries) {
          onChunk(`\n[重试 ${attempt + 1}/${maxRetries}：API 返回 ${resp.status}]`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(`AI API 错误 (${resp.status}): ${errText.substring(0, 200)}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              onChunk(delta);
            }
          } catch {}
        }
      }
      return fullContent;
    } catch (err) {
      if (attempt < maxRetries) {
        onChunk(`\n[重试 ${attempt + 1}/${maxRetries}：${err.message}]`);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

async function analyzePersonality() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const endpoint = document.getElementById('apiEndpoint').value.trim();
  const model = document.getElementById('apiModel').value.trim();

  if (!apiKey || !endpoint || !model) {
    throw new Error('请填写完整的 API 配置');
  }

  updateProgress(60, '正在调用 AI 进行人格分析...');

  // Show streaming output area
  const streamEl = document.getElementById('aiStreamOutput');
  if (streamEl) {
    streamEl.style.display = 'block';
    streamEl.innerHTML = '<div class="stream-label">AI 分析中...</div><div class="stream-text"></div>';
  }
  const streamTextEl = streamEl?.querySelector('.stream-text');

  const s = STATE.stats.self;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';

  const filterForAI = msgs => msgs
    .filter(m => m.content.length >= 10 && m.content.length <= 200)
    .slice(0, 120);

  const selfSamples = filterForAI(STATE.rawData.self);
  const partnerSamples = STATE.rawData.partner.length > 0 ? filterForAI(STATE.rawData.partner) : [];

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

  const makeBody = (samples, name, isSelf) => ({
    model,
    messages: [{ role: 'user', content: prompt(samples.length > 0 ? samples : [{content:'无充足数据'}], name, isSelf) }],
    max_tokens: 2500,
    temperature: 0.7,
  });

  // Analyze self with streaming
  if (streamTextEl) streamTextEl.innerHTML = '';
  let selfContent;
  try {
    selfContent = await streamAIRequest(
      endpoint, headers,
      makeBody(selfSamples, selfName, true),
      delta => {
        if (streamTextEl) {
          streamTextEl.textContent += delta;
          streamTextEl.scrollTop = streamTextEl.scrollHeight;
        }
      }
    );
  } catch (err) {
    if (streamEl) streamEl.style.display = 'none';
    throw err;
  }

  const jsonMatch = selfContent.match(/\{[\s\S]*\}/);
  let selfPersonality;
  try {
    selfPersonality = JSON.parse(jsonMatch ? jsonMatch[0] : selfContent);
  } catch {
    if (streamEl) streamEl.style.display = 'none';
    throw new Error('AI 返回的 JSON 解析失败');
  }

  // Analyze partner if applicable
  let partnerPersonality = null;
  if (partnerSamples.length >= 20) {
    updateProgress(75, '正在分析对方的人格特质...');
    if (streamTextEl) streamTextEl.innerHTML += '\n\n--- 分析对方 ---\n';
    try {
      const pContent = await streamAIRequest(
        endpoint, headers,
        makeBody(partnerSamples, partnerName, false),
        delta => {
          if (streamTextEl) {
            streamTextEl.textContent += delta;
            streamTextEl.scrollTop = streamTextEl.scrollHeight;
          }
        }
      );
      const pMatch = pContent.match(/\{[\s\S]*\}/);
      partnerPersonality = JSON.parse(pMatch ? pMatch[0] : pContent);
    } catch { /* ignore parse failure for partner */ }
  }

  // Hide streaming output after completion
  if (streamEl) {
    setTimeout(() => { streamEl.style.display = 'none'; }, 1500);
  }

  STATE.personality = { self: selfPersonality, partner: partnerPersonality };
  updateProgress(80, 'AI 分析完成！');
}

// ── 报告生成 ──────────────────────────────────────────

function generateReportHTML() {
  if (!STATE.stats) throw new Error('统计数据未初始化，请重新生成报告');
  const s = STATE.stats.self;
  const p = STATE.personality;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';
  const hasPartner = !!(STATE.stats.hasPartner && STATE.stats.partner);

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

  // Charts HTML (ECharts)
  const chartsHTML = `
    <div class="chart-grid">
      <div id="chart-hourly" class="chart-cell"></div>
      <div id="chart-weekday" class="chart-cell"></div>
      <div id="chart-monthly" class="chart-cell"></div>
      <div id="chart-length" class="chart-cell"></div>
    </div>`;

  // Custom HTML/CSS heatmap (GitHub-style calendar grid)
  const heatmapHTML = `
    <div class="hm-controls">
      <span class="hm-label-sm">年份</span>
      <div class="hm-yr-btns" id="hm-year-btns"></div>
    </div>
    <div class="hm-person-block">
      <div class="hm-person-label">${tag(selfName, false)}</div>
      <div id="hm-self-grid"></div>
    </div>
    ${hasPartner ? `<hr class="hm-sep">
    <div class="hm-person-block">
      <div class="hm-person-label">${tag(partnerName, true)}</div>
      <div id="hm-partner-grid"></div>
    </div>` : ''}
    <div class="hm-legend">
      <div class="hm-leg-row">${tag(selfName, false)} &nbsp;少 <div class="hm-leg-cells"><div class="hm-leg-cell" style="background:#EDE5DC"></div><div class="hm-leg-cell" style="background:#D4A882"></div><div class="hm-leg-cell" style="background:#B87040"></div><div class="hm-leg-cell" style="background:#8B5E3C"></div><div class="hm-leg-cell" style="background:#5A3020"></div></div> 多</div>
      ${hasPartner ? `&nbsp;&nbsp;
      <div class="hm-leg-row">${tag(partnerName, true)} &nbsp;少 <div class="hm-leg-cells"><div class="hm-leg-cell" style="background:#D8EDEA"></div><div class="hm-leg-cell" style="background:#8ABFB8"></div><div class="hm-leg-cell" style="background:#5A9B93"></div><div class="hm-leg-cell" style="background:#4A7B6F"></div><div class="hm-leg-cell" style="background:#2E5048"></div></div> 多</div>` : ''}
    </div>`;

  // Reply speed HTML
  const fmtTime = sec => {
    if (sec == null) return '—';
    if (sec < 60) return sec + '秒';
    if (sec < 3600) return Math.round(sec/60) + '分钟';
    return (sec/3600).toFixed(1) + '小时';
  };
  const rs = s.replySpeed;
  const replyHTML = `<div class="stats" style="margin-bottom:0">
    <div class="stat"><div class="stat-num">${fmtTime(rs.selfMedian)}</div><div class="stat-lbl">${selfName} 回复中位数</div></div>
    <div class="stat"><div class="stat-num">${rs.selfCount}</div><div class="stat-lbl">${selfName} 回复次数</div></div>
    ${hasPartner ? `<div class="stat"><div class="stat-num">${fmtTime(rs.partnerMedian)}</div><div class="stat-lbl">${partnerName} 回复中位数</div></div>` : `<div class="stat"><div class="stat-num">${fmtTime(rs.selfAvg)}</div><div class="stat-lbl">${selfName} 回复均值</div></div>`}
  </div>`;

  // Emotion HTML
  const emo = s.emotion;
  const emoTotal = Math.max(1, emo.positive + emo.negative + emo.question);
  const emoHTML = (data, name, isP) => {
    const t = Math.max(1, data.positive + data.negative + data.question);
    return `<div style="margin-bottom:10px">
      ${tag(name, isP)}
      <div style="display:flex;gap:3px;height:22px;border-radius:6px;overflow:hidden;margin:6px 0">
        <div style="width:${(data.positive/t*100).toFixed(1)}%;background:${isP?'var(--tl-500)':'var(--br-500)'}" title="积极 ${data.positive}"></div>
        <div style="width:${(data.negative/t*100).toFixed(1)}%;background:${isP?'var(--tl-200)':'var(--br-300)'}" title="消极 ${data.negative}"></div>
        <div style="width:${(data.question/t*100).toFixed(1)}%;background:var(--tx-400);opacity:.3" title="疑问 ${data.question}"></div>
      </div>
      <div style="display:flex;gap:12px;font-size:.76em;color:var(--tx-400)">
        <span>积极 ${data.positive}</span><span>消极 ${data.negative}</span><span>疑问 ${data.question}</span>
      </div>
    </div>`;
  };
  const emotionSection = hasPartner
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${emoHTML(emo, selfName, false)}${emoHTML(STATE.stats.partner.emotion, partnerName, true)}</div>`
    : emoHTML(emo, selfName, false);

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
<div class="section" style="--i:3"><div class="section-title">💬 高频词对比</div><div class="chart-grid"><div id="chart-wc-self" class="chart-cell"></div><div id="chart-wc-partner" class="chart-cell"></div></div></div>
<div class="section" style="--i:4"><div class="section-title">📅 聊天频率热力图</div>${heatmapHTML}</div>
<div class="section" style="--i:5"><div class="section-title">⚡ 回复速度分析</div>${replyHTML}</div>
<div class="section" style="--i:6"><div class="section-title">😊 情绪关键词</div>${emotionSection}</div>
${big5HTML ? `<div class="section" style="--i:7"><div class="section-title">🧠 大五人格分析 (Big Five)</div>${big5HTML}</div>` : ''}
${mbtiHTML ? `<div class="section" style="--i:8"><div class="section-title">🔮 MBTI 推断</div>${mbtiHTML}</div>` : ''}
${styleHTML ? `<div class="section" style="--i:9"><div class="section-title">✨ AI 对${hasDualAI?'你们':'你'}的总结</div>${styleHTML}</div>` : ''}
${reliability ? `<div style="font-size:.78em;color:var(--tx-400,#8a7a6a);text-align:center;padding:12px">📋 ${reliability}</div>` : ''}
<div class="disc">⚠️ 本报告基于语言模式的统计推断，仅供娱乐与自我探索，不构成心理学诊断。<br>MBTI 信效度存在学术争议；Big Five 具有更强的研究支撑，但仍需谨慎解读。<div class="brand">🍪 姜饼探AI · Ginger Report v2.0</div></div>`;

  return bodyHTML;
}

function getFullReportHTML(bodyHTML, selfName, partnerName, hasPartner, chartData) {
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

/* AI Streaming Output */
.ai-stream-output {
  display: none;
  background: var(--surface-2);
  border: 1.5px solid var(--br-100);
  border-radius: var(--r-md);
  padding: 14px 18px;
  margin-top: 14px;
  max-height: 260px;
  overflow-y: auto;
}
.stream-label {
  font-size: .79em; font-weight: 600; color: var(--br-700);
  margin-bottom: 8px;
}
.stream-text {
  font-size: .81em; color: var(--tx-600);
  line-height: 1.7; white-space: pre-wrap; word-break: break-all;
  font-family: var(--ff-body);
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
  const chartScript = chartData ? `
<script>
document.addEventListener('DOMContentLoaded', function() {
  var D = ${JSON.stringify(chartData)};
  var BROWN = ['#8b5e3c','#c68642','#d4956a','#e8c49a'];
  var TEAL  = ['#4a7b6f','#6faa9c','#8abfb8','#b4d8d2'];
  var theme = { textColor: '#5a4a3a', accent: '#c68642', brown: '#8b5e3c', teal: '#6faa9c' };

  function initChart(id, opt) {
    var el = document.getElementById(id);
    if (!el) return null;
    var c = echarts.init(el);
    c.setOption(opt);
    return c;
  }

  // Hourly
  var peak = D.hourly.indexOf(Math.max.apply(null, D.hourly));
  initChart('chart-hourly', {
    tooltip: { trigger: 'axis' },
    grid: { top: 40, right: 20, bottom: 30, left: 50 },
    title: { text: '几点最爱发消息？', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
    xAxis: { type: 'category', data: Array.from({length:24},function(_,i){return i+':00'}), axisLabel: { rotate: 45, fontSize: 10, interval: 3 } },
    yAxis: { type: 'value', name: '消息数' },
    series: [{ type: 'bar', data: D.hourly.map(function(v,i){return {value:v,itemStyle:{color:i===peak?theme.accent:theme.brown,borderRadius:[4,4,0,0]}}}), markArea: { silent: true, data: [[{xAxis:'0:00'},{xAxis:'6:00',itemStyle:{color:'rgba(0,0,50,.04)'}}],[{xAxis:'22:00'},{xAxis:'23:00',itemStyle:{color:'rgba(0,0,50,.04)'}}]] } }]
  });

  // Monthly
  var months = Object.keys(D.monthly).sort();
  initChart('chart-monthly', {
    tooltip: { trigger: 'axis' },
    grid: { top: 40, right: 20, bottom: 30, left: 50 },
    title: { text: '每月消息量变化', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
    xAxis: { type: 'category', data: months, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', name: '消息数' },
    series: [{ type: 'line', data: months.map(function(k){return D.monthly[k]}), lineStyle: { color: theme.brown, width: 2 }, itemStyle: { color: theme.brown }, areaStyle: { color: 'rgba(139,94,60,.12)' }, smooth: true }]
  });

  // Weekday
  var days = ['周一','周二','周三','周四','周五','周六','周日'];
  initChart('chart-weekday', {
    tooltip: { trigger: 'axis' },
    grid: { top: 40, right: 20, bottom: 30, left: 50 },
    title: { text: '哪天最活跃？', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
    xAxis: { type: 'category', data: days },
    yAxis: { type: 'value', name: '消息数' },
    series: [{ type: 'bar', data: D.weekday.map(function(v,i){return {value:v,itemStyle:{color:i>=5?theme.accent:theme.brown,borderRadius:[4,4,0,0]}}}) }]
  });

  // Length distribution
  var clamped = D.lengths.map(function(l){return Math.min(l,200)});
  var bins = 30, maxV = Math.max.apply(null,clamped.concat([1])), step = maxV/bins;
  var dist = new Array(bins).fill(0);
  clamped.forEach(function(l){var idx=Math.min(Math.floor(l/step),bins-1);dist[idx]++});
  initChart('chart-length', {
    tooltip: { trigger: 'axis' },
    grid: { top: 40, right: 20, bottom: 30, left: 50 },
    title: { text: '消息长度分布', left: 'center', top: 8, textStyle: { fontSize: 14, color: theme.textColor } },
    xAxis: { type: 'category', data: Array.from({length:bins},function(_,i){return Math.round(i*step)}), axisLabel: { fontSize: 9, interval: 4 } },
    yAxis: { type: 'value', name: '条数' },
    series: [{ type: 'bar', data: dist, itemStyle: { color: theme.brown, borderRadius: [3,3,0,0] }, markLine: { silent: true, data: [{ xAxis: Math.round(D.avgLength/step), label: { formatter: '平均 '+D.avgLength+'字', color: theme.accent }, lineStyle: { color: theme.accent, type: 'dashed' } }] } }]
  });

  // Word clouds
  function filterWords(wf, max) {
    return Object.entries(wf).filter(function(e){return e[0].length>=2}).slice(0,max).map(function(e){return {name:e[0],value:Math.log(e[1]+1)*10}});
  }
  var selfEl = document.getElementById('chart-wc-self');
  if (selfEl && D.selfWords && D.selfWords.length) {
    var sc = echarts.init(selfEl);
    sc.setOption({
      title: { text: D.selfName+' 的高频词', left: 'center', top: 4, textStyle: { fontSize: 13, fontWeight: 'bold', color: '#3a2a1a' } },
      tooltip: { show: true },
      series: [{ type: 'wordCloud', shape: 'circle', sizeRange: [12, 52], rotationRange: [-45, 45], gridSize: 6, drawOutOfBound: false, textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' }, color: function(){return BROWN[Math.floor(Math.random()*BROWN.length)]}, data: D.selfWords }]
    });
  }
  if (D.hasPartner) {
    var partnerEl = document.getElementById('chart-wc-partner');
    if (partnerEl && D.partnerWords && D.partnerWords.length) {
      var pc = echarts.init(partnerEl);
      pc.setOption({
        title: { text: D.partnerName+' 的高频词', left: 'center', top: 4, textStyle: { fontSize: 13, fontWeight: 'bold', color: '#3a2a1a' } },
        tooltip: { show: true },
        series: [{ type: 'wordCloud', shape: 'circle', sizeRange: [12, 52], rotationRange: [-45, 45], gridSize: 6, drawOutOfBound: false, textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' }, color: function(){return TEAL[Math.floor(Math.random()*TEAL.length)]}, data: D.partnerWords }]
      });
    }
  } else {
    var pe = document.getElementById('chart-wc-partner');
    if (pe) pe.style.display = 'none';
  }

  window.addEventListener('resize', function() {
    document.querySelectorAll('[id^=chart-]').forEach(function(el) {
      var inst = echarts.getInstanceByDom(el);
      if (inst) inst.resize();
    });
  });
});
<\/script>` : '';

  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信聊天人格分析 · ${selfName}${hasPartner ? ' & ' + partnerName : ''}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/echarts-wordcloud@2.1.0/dist/echarts-wordcloud.min.js"><\/script>
<style>${STYLES}</style></head><body><div class="container">
${bodyHTML}
</div>${chartScript}</body></html>`;
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
          (isSelf ? STATE.rawData.self : STATE.rawData.partner).push({ content: cleanMessage(content), ts: null, senderName: isSelf ? '我' : '对方' });
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
        try {
          const newBody = generateReportHTML();
          reportContent.innerHTML = newBody;
        } catch (genErr) {
          console.error('报告生成失败:', genErr);
          toast('⚠️ 报告生成出错：' + genErr.message);
        }
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
  if (!reportBody || !STATE.stats) return;
  const selfName = document.getElementById('selfName').value || '我';
  const partnerName = document.getElementById('partnerName').value || '对方';
  const hasPartner = !!(STATE.stats.hasPartner && STATE.stats.partner);
  const s = STATE.stats.self;

  // Prepare chart data for standalone rendering
  const STOPWORDS_DL = new Set(['的','了','是','在','我','你','他','她','它','们','这','那','就','都','和','与','但','也','很','有','没','不','一','个','上','对','说','好','要','么','啊','呢','吧','哦','嗯','然后','所以','因为','如果','可以','还是','已经','什么','怎么','为什么','就是','还有','其实','感觉','觉得','现在','时候','一个','这个','那个','一下','一起','一直','一样','一点','一些']);
  function fw(wf, max) {
    return Object.entries(wf).filter(([w]) => w.length >= 2 && !STOPWORDS_DL.has(w)).slice(0, max).map(([name, value]) => ({ name, value: Math.log(value + 1) * 10 }));
  }

  const chartData = {
    hourly: s.hourly,
    monthly: s.monthly,
    weekday: s.weekday,
    lengths: s.lengths,
    avgLength: s.avgLength,
    selfWords: fw(s.wordFreq, 50),
    partnerWords: hasPartner ? fw(STATE.stats.partner.wordFreq, 50) : [],
    selfName,
    partnerName,
    hasPartner,
  };

  const html = getFullReportHTML(reportBody, selfName, partnerName, hasPartner, chartData);
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