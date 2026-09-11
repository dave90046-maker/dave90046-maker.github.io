// Tab switching (supports any number of tabs)
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');

    tabButtons.forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });

    tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.getAttribute('data-tab-panel') === target);
    });
  });
});

// Company Intelligence
const ICP_API_URL = 'https://dave-gtm-api.vercel.app/api/research';
const ICP_SECTION_HEADERS = [
  'Company Bio',
  'Recent Activity',
  'Strategic Focus',
  'Buyer Persona',
  'Competitive Positioning',
  'Key Takeaways'
];

/*
 * Shared markdown-ish brief parser.
 *
 * Turns the raw text returned by the API into a plain data structure:
 *   { sections: [ { header: string|null, blocks: [ Block, ... ] }, ... ] }
 * where Block is either:
 *   { type: 'paragraph', runs: Run[] }
 *   { type: 'list', items: Run[][] }
 * and Run is { text: string, bold: boolean }.
 *
 * Both the on-screen HTML renderer and the RTF export build off this same
 * structure so the two outputs never drift apart.
 */

function parseInlineRuns(text) {
  const runs = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = boldRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false });
  }

  return runs.filter(r => r.text.length > 0);
}

function matchBulletLine(line) {
  let m = line.match(/^(?:--|[-*•—])\s+(.+)$/);
  if (m) return m[1];
  m = line.match(/^\d+[.)]\s+(.+)$/);
  if (m) return m[1];
  return null;
}

function parseSectionBlocks(contentText) {
  const lines = contentText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const blocks = [];
  let currentList = null;

  const flushList = () => {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  lines.forEach(line => {
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line)) return;

    const bulletText = matchBulletLine(line);
    if (bulletText !== null) {
      if (!currentList) {
        currentList = { type: 'list', items: [] };
      }
      currentList.items.push(parseInlineRuns(bulletText));
    } else {
      flushList();
      blocks.push({ type: 'paragraph', runs: parseInlineRuns(line) });
    }
  });
  flushList();

  return blocks;
}

function parseBriefStructured(rawText) {
  const escapedHeaders = ICP_SECTION_HEADERS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const headerRegex = new RegExp(`(?:^|\\n)[ \\t]*#{0,3}[ \\t]*\\**[ \\t]*(${escapedHeaders.join('|')})[ \\t]*\\**[ \\t]*:?[ \\t]*`, 'gi');
  const matches = [...rawText.matchAll(headerRegex)];

  if (matches.length === 0) {
    return { sections: [{ header: null, blocks: parseSectionBlocks(rawText) }] };
  }

  const sections = matches.map((match, i) => {
    const headerName = ICP_SECTION_HEADERS.find(h => h.toLowerCase() === match[1].toLowerCase());
    const contentStart = match.index + match[0].length;
    const contentEnd = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    return { header: headerName, blocks: parseSectionBlocks(rawText.slice(contentStart, contentEnd).trim()) };
  });

  return { sections };
}

// ── HTML rendering ──

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderRunsHtml(runs) {
  return runs.map(r => r.bold ? `<strong>${escapeHtml(r.text)}</strong>` : escapeHtml(r.text)).join('');
}

function renderBlocksHtml(blocks) {
  return blocks.map(block => {
    if (block.type === 'list') {
      return '<ul>' + block.items.map(runs => `<li>${renderRunsHtml(runs)}</li>`).join('') + '</ul>';
    }
    return `<p>${renderRunsHtml(block.runs)}</p>`;
  }).join('');
}

function renderBriefHtml(structured) {
  return structured.sections.map(section => `
    <div class="icp-section-block">
      ${section.header ? `<h3 class="icp-section-title">${escapeHtml(section.header)}</h3>` : ''}
      <div class="icp-section-body">${renderBlocksHtml(section.blocks)}</div>
    </div>
  `).join('');
}

// ── RTF export ──

function escapeRtf(text) {
  return text
    .replace(/[\\{}]/g, '\\$&')
    .replace(/[-￿]/g, ch => '\\u' + ch.charCodeAt(0) + '?');
}

function renderRunsRtf(runs) {
  return runs.map(r => r.bold ? `{\\b ${escapeRtf(r.text)}}` : escapeRtf(r.text)).join('');
}

function renderBlocksRtf(blocks) {
  return blocks.map(block => {
    if (block.type === 'list') {
      return block.items
        .map(runs => `\\pard\\li360\\fi-360\\sa60 \\'95\\tab ${renderRunsRtf(runs)}\\par`)
        .join('\n');
    }
    return `\\pard\\sa120 ${renderRunsRtf(block.runs)}\\par`;
  }).join('\n');
}

function buildBriefRtf(structured, company) {
  const lines = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}}',
    '\\viewkind4\\uc1\\f0\\fs24',
    `\\pard\\sa200\\b\\fs32 ${escapeRtf('Research Brief: ' + company)}\\b0\\fs24\\par`
  ];

  structured.sections.forEach(section => {
    if (section.header) {
      lines.push(`\\pard\\sa120\\sb200\\b\\fs28 ${escapeRtf(section.header)}\\b0\\fs24\\par`);
    }
    lines.push(renderBlocksRtf(section.blocks));
  });

  lines.push('}');
  return lines.join('\n');
}

function buildJourneyRtf(stages, product) {
  const lines = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}}',
    '\\viewkind4\\uc1\\f0\\fs24',
    `\\pard\\sa200\\b\\fs32 ${escapeRtf('Lifecycle Journey: ' + product)}\\b0\\fs24\\par`
  ];

  stages.forEach(stage => {
    const charCount = typeof stage.subject_line_length === 'number'
      ? stage.subject_line_length
      : (stage.subject_line || '').length;

    lines.push(`\\pard\\sa120\\sb200\\b\\fs28 ${escapeRtf(stage.stage || '')}\\b0\\fs24\\par`);
    lines.push(`\\pard\\sa60 {\\b Subject Line} (${charCount} characters): ${escapeRtf(stage.subject_line || '')}\\par`);
    lines.push(`\\pard\\sa60 {\\b Headline}: ${escapeRtf(stage.headline || '')}\\par`);
    lines.push(`\\pard\\sa120 {\\b Body Preview}: ${escapeRtf(stage.body_preview || '')}\\par`);
    lines.push(`\\pard\\sa60 {\\b CTA}: ${escapeRtf(stage.cta || '')}\\par`);
    lines.push(`\\pard\\sa120 {\\b Strategic Intent}: ${escapeRtf(stage.strategic_intent || '')}\\par`);
  });

  lines.push('}');
  return lines.join('\n');
}

function sanitizeFilenameSegment(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-');
}

function downloadRtf(filename, content) {
  const blob = new Blob([content], { type: 'application/rtf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Form wiring ──

const icpForm = document.getElementById('icp-form');
if (icpForm) {
  const companyInput = document.getElementById('company-name');
  const submitBtn = document.getElementById('icp-submit');
  const exportBtn = document.getElementById('icp-export');
  const statusEl = document.getElementById('icp-status');
  const errorEl = document.getElementById('icp-error');
  const resultsEl = document.getElementById('icp-results');

  let lastBrief = null;
  let lastCompany = '';

  icpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const company = companyInput.value.trim();
    if (!company) return;

    submitBtn.disabled = true;
    exportBtn.disabled = true;
    statusEl.hidden = false;
    errorEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';

    try {
      const response = await fetch(ICP_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company })
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || typeof data.result !== 'string') {
        throw new Error('Unexpected response format');
      }

      lastBrief = parseBriefStructured(data.result);
      lastCompany = company;

      resultsEl.innerHTML = renderBriefHtml(lastBrief);
      resultsEl.hidden = false;
      exportBtn.disabled = false;
    } catch (err) {
      lastBrief = null;
      errorEl.textContent = "Something went wrong generating this research brief. Please try again in a moment.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      statusEl.hidden = true;
    }
  });

  exportBtn.addEventListener('click', () => {
    if (!lastBrief) return;
    const filename = `${sanitizeFilenameSegment(lastCompany)}-research-brief.rtf`;
    downloadRtf(filename, buildBriefRtf(lastBrief, lastCompany));
  });
}

// Lifecycle Journey Builder
const JOURNEY_API_URL = 'https://dave-gtm-api.vercel.app/api/journey';

function renderJourneyResults(stages) {
  const resultsEl = document.getElementById('journey-results');
  resultsEl.innerHTML = stages.map(stage => {
    const charCount = typeof stage.subject_line_length === 'number'
      ? stage.subject_line_length
      : (stage.subject_line || '').length;

    return `
    <div class="journey-card">
      <div class="journey-card-stage">${escapeHtml(stage.stage || '')}</div>

      <div class="journey-card-block">
        <span class="journey-card-label">Subject Line</span>
        <div class="journey-card-subject-row">
          <span class="journey-card-subject-text">${escapeHtml(stage.subject_line || '')}</span>
          <span class="journey-card-char-count">${charCount} characters</span>
        </div>
      </div>

      <h4 class="journey-card-headline">${escapeHtml(stage.headline || '')}</h4>

      <p class="journey-card-body">${escapeHtml(stage.body_preview || '')}</p>

      <div class="journey-card-block journey-card-cta-block">
        <span class="journey-card-label">CTA</span>
        <button type="button" class="journey-card-cta-btn">${escapeHtml(stage.cta || '')}</button>
      </div>

      <p class="journey-card-intent">${escapeHtml(stage.strategic_intent || '')}</p>
    </div>
  `;
  }).join('');
  resultsEl.hidden = false;
}

const journeyForm = document.getElementById('journey-form');
if (journeyForm) {
  const submitBtn = document.getElementById('journey-submit');
  const exportBtn = document.getElementById('journey-export');
  const statusEl = document.getElementById('journey-status');
  const errorEl = document.getElementById('journey-error');
  const resultsEl = document.getElementById('journey-results');

  let lastStages = null;
  let lastProduct = '';

  journeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const product = document.getElementById('journey-product').value.trim();
    const persona = document.getElementById('journey-persona').value.trim();
    const companySize = document.getElementById('journey-company-size').value;
    const painPoint = document.getElementById('journey-pain-point').value.trim();
    const goal = document.getElementById('journey-goal').value;

    if (!product || !persona || !companySize || !painPoint || !goal) return;

    submitBtn.disabled = true;
    exportBtn.disabled = true;
    statusEl.hidden = false;
    errorEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';

    try {
      const response = await fetch(JOURNEY_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, persona, companySize, painPoint, goal })
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.stages)) {
        throw new Error('Unexpected response format');
      }

      lastStages = data.stages;
      lastProduct = product;

      renderJourneyResults(data.stages);
      exportBtn.disabled = false;
    } catch (err) {
      lastStages = null;
      errorEl.textContent = "Something went wrong building this journey. Please try again in a moment.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      statusEl.hidden = true;
    }
  });

  exportBtn.addEventListener('click', () => {
    if (!lastStages) return;
    const filename = `${sanitizeFilenameSegment(lastProduct)}-lifecycle-journey.rtf`;
    downloadRtf(filename, buildJourneyRtf(lastStages, lastProduct));
  });
}

// Performance Analyzer
const PERF_API_URL = 'https://dave-gtm-api.vercel.app/api/performance-analysis';

const PERF_CONFIG = {
  email: {
    label: 'Email',
    nameCol: 'Campaign Name',
    hookCol: 'Subject Line',
    dateCol: 'Send Date',
    requiredColumns: ['Campaign Name', 'Subject Line', 'Send Date', 'Emails Sent', 'Opens', 'Clicks'],
    numericColumns: ['Emails Sent', 'Opens', 'Clicks'],
    hookLabel: 'Subject Line',
    xLabel: 'Open Rate',
    yLabel: 'CTOR (Click-to-Open Rate)',
    compute(row) {
      const sent = Number(row['Emails Sent']);
      const opens = Number(row['Opens']);
      const clicks = Number(row['Clicks']);
      const openRate = sent > 0 ? opens / sent : 0;
      const ctor = opens > 0 ? clicks / opens : 0;
      return {
        x: openRate,
        y: ctor,
        raw: { sent, opens, clicks }
      };
    },
    tableColumns: [
      { key: 'name', label: 'Campaign Name', type: 'string' },
      { key: 'hook', label: 'Subject Line', type: 'string' },
      { key: 'date', label: 'Send Date', type: 'date' },
      { key: 'sent', label: 'Emails Sent', type: 'number' },
      { key: 'opens', label: 'Opens', type: 'number' },
      { key: 'clicks', label: 'Clicks', type: 'number' },
      { key: 'x', label: 'Open Rate', type: 'percent' },
      { key: 'y', label: 'CTOR', type: 'percent' }
    ],
    quadrants: {
      hh: { title: 'Hook + Content Both Strong', desc: 'High Open Rate, High CTOR — the subject line grabbed attention and the content that followed converted.' },
      hl: { title: 'Hook Worked, Content Underperformed', desc: 'High Open Rate, Low CTOR — the subject line got the open, but the body/CTA didn’t land.' },
      lh: { title: 'Hook Underperformed, Content Resonated', desc: 'Low Open Rate, High CTOR — the subject line struggled, but whoever opened it engaged with the content.' },
      ll: { title: 'Both Hook and Content Need Work', desc: 'Low Open Rate, Low CTOR — neither the subject line nor the content that followed performed well.' }
    },
    quadrantShort: { hh: 'Hook + Content', hl: 'Hook Only', lh: 'Content Only', ll: 'Needs Work' },
    sampleData: [
      { 'Campaign Name': 'Q1 Product Launch', 'Subject Line': "The feature you've been asking for is here", 'Send Date': '2026-01-14', 'Emails Sent': '12000', 'Opens': '4200', 'Clicks': '1050' },
      { 'Campaign Name': 'Customer Success Spotlight', 'Subject Line': 'How Acme cut onboarding time by 60%', 'Send Date': '2026-01-21', 'Emails Sent': '9500', 'Opens': '3325', 'Clicks': '831' },
      { 'Campaign Name': 'Feature Announcement: AI Assist', 'Subject Line': 'Introducing AI Assist inside your dashboard', 'Send Date': '2026-03-11', 'Emails Sent': '13000', 'Opens': '5200', 'Clicks': '1300' },
      { 'Campaign Name': 'Case Study: RiskWorld', 'Subject Line': 'See how RiskWorld scaled without adding headcount', 'Send Date': '2026-03-18', 'Emails Sent': '9000', 'Opens': '3150', 'Clicks': '788' },
      { 'Campaign Name': 'Webinar Invite: Compliance Trends - A', 'Subject Line': 'Free 30-min session: 2026 compliance trends', 'Send Date': '2026-01-28', 'Emails Sent': '11000', 'Opens': '4400', 'Clicks': '220' },
      { 'Campaign Name': 'Webinar Invite: Compliance Trends - B', 'Subject Line': 'Free 30-min session: 2026 compliance trends', 'Send Date': '2026-01-29', 'Emails Sent': '11000', 'Opens': '4400', 'Clicks': '704' },
      { 'Campaign Name': 'Flash Sale Reminder - A', 'Subject Line': "Don't miss out - sale ends soon", 'Send Date': '2026-02-04', 'Emails Sent': '15000', 'Opens': '4200', 'Clicks': '252' },
      { 'Campaign Name': 'Flash Sale Reminder - B', 'Subject Line': "24 hours left - don't miss this", 'Send Date': '2026-02-05', 'Emails Sent': '15000', 'Opens': '6900', 'Clicks': '414' },
      { 'Campaign Name': 'New Pricing Tiers', 'Subject Line': "We've simplified our pricing", 'Send Date': '2026-04-01', 'Emails Sent': '10500', 'Opens': '4830', 'Clicks': '241' },
      { 'Campaign Name': 'Industry Report Release', 'Subject Line': 'New research: State of GTM in 2026', 'Send Date': '2026-02-11', 'Emails Sent': '8000', 'Opens': '2000', 'Clicks': '700' },
      { 'Campaign Name': 'Partner Program Update', 'Subject Line': 'An update on our partner program', 'Send Date': '2026-02-18', 'Emails Sent': '7000', 'Opens': '1610', 'Clicks': '563' },
      { 'Campaign Name': 'Security Advisory', 'Subject Line': 'Important: action required on your account', 'Send Date': '2026-04-08', 'Emails Sent': '9200', 'Opens': '2116', 'Clicks': '720' },
      { 'Campaign Name': 'Generic Newsletter #12', 'Subject Line': 'Monthly Newsletter', 'Send Date': '2026-02-25', 'Emails Sent': '10000', 'Opens': '1500', 'Clicks': '45' },
      { 'Campaign Name': 'Re-engagement Campaign', 'Subject Line': 'We miss you', 'Send Date': '2026-03-04', 'Emails Sent': '6000', 'Opens': '900', 'Clicks': '27' },
      { 'Campaign Name': 'Holiday Hours Notice', 'Subject Line': 'Our support hours this week', 'Send Date': '2026-03-25', 'Emails Sent': '8800', 'Opens': '1320', 'Clicks': '46' }
    ]
  },
  linkedin: {
    label: 'LinkedIn',
    nameCol: 'Post Name',
    hookCol: 'Headline',
    dateCol: 'Post Date',
    requiredColumns: ['Post Name', 'Headline', 'Post Date', 'Impressions', 'Clicks', 'Likes'],
    numericColumns: ['Impressions', 'Clicks', 'Likes'],
    hookLabel: 'Headline',
    xLabel: 'CTR',
    yLabel: 'Like Rate',
    compute(row) {
      const impressions = Number(row['Impressions']);
      const clicks = Number(row['Clicks']);
      const likes = Number(row['Likes']);
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const likeRate = impressions > 0 ? likes / impressions : 0;
      return {
        x: ctr,
        y: likeRate,
        raw: { impressions, clicks, likes }
      };
    },
    tableColumns: [
      { key: 'name', label: 'Post Name', type: 'string' },
      { key: 'hook', label: 'Headline', type: 'string' },
      { key: 'date', label: 'Post Date', type: 'date' },
      { key: 'impressions', label: 'Impressions', type: 'number' },
      { key: 'clicks', label: 'Clicks', type: 'number' },
      { key: 'likes', label: 'Likes', type: 'number' },
      { key: 'x', label: 'CTR', type: 'percent' },
      { key: 'y', label: 'Like Rate', type: 'percent' }
    ],
    quadrants: {
      hh: { title: 'Hook + Content Both Strong', desc: 'High CTR, High Like Rate — the headline grabbed attention and the post content resonated with the audience.' },
      hl: { title: 'Hook Worked, Content Underperformed', desc: 'High CTR, Low Like Rate — the headline earned clicks, but the post itself didn’t resonate.' },
      lh: { title: 'Hook Underperformed, Content Resonated', desc: 'Low CTR, High Like Rate — the headline struggled to earn clicks, but whoever engaged liked what they saw.' },
      ll: { title: 'Both Hook and Content Need Work', desc: 'Low CTR, Low Like Rate — neither the headline nor the post content performed well.' }
    },
    quadrantShort: { hh: 'Hook + Content', hl: 'Hook Only', lh: 'Content Only', ll: 'Needs Work' },
    sampleData: [
      { 'Post Name': 'Product Launch Teaser', 'Headline': "The feature you've been asking for is finally here", 'Post Date': '2026-01-12', 'Impressions': '45000', 'Clicks': '2160', 'Likes': '1890' },
      { 'Post Name': 'Customer Story: Acme', 'Headline': 'How Acme cut onboarding time by 60%', 'Post Date': '2026-01-19', 'Impressions': '38000', 'Clicks': '1634', 'Likes': '1444' },
      { 'Post Name': 'AI Assist Announcement', 'Headline': 'Introducing AI Assist inside your dashboard', 'Post Date': '2026-03-09', 'Impressions': '52000', 'Clicks': '2028', 'Likes': '2392' },
      { 'Post Name': 'Founder Thought Leadership', 'Headline': 'What five years of GTM data taught me', 'Post Date': '2026-02-02', 'Impressions': '31000', 'Clicks': '1426', 'Likes': '1085' },
      { 'Post Name': 'Webinar Promo', 'Headline': 'Free 30-min session: 2026 compliance trends', 'Post Date': '2026-01-26', 'Impressions': '42000', 'Clicks': '1848', 'Likes': '252' },
      { 'Post Name': 'Flash Sale Post', 'Headline': "24 hours left - don't miss this", 'Post Date': '2026-02-06', 'Impressions': '59000', 'Clicks': '2242', 'Likes': '531' },
      { 'Post Name': 'New Pricing Tiers', 'Headline': "We've simplified our pricing", 'Post Date': '2026-03-30', 'Impressions': '34000', 'Clicks': '1394', 'Likes': '374' },
      { 'Post Name': 'Team Culture Spotlight', 'Headline': 'A day in the life of our support team', 'Post Date': '2026-02-16', 'Impressions': '21000', 'Clicks': '756', 'Likes': '84' },
      { 'Post Name': 'Research Report Teaser', 'Headline': 'New research: State of GTM in 2026', 'Post Date': '2026-02-09', 'Impressions': '23000', 'Clicks': '184', 'Likes': '1012' },
      { 'Post Name': 'Employee Spotlight', 'Headline': 'Meet the team behind your favorite feature', 'Post Date': '2026-03-02', 'Impressions': '19000', 'Clicks': '209', 'Likes': '741' },
      { 'Post Name': 'Thought Leadership Quote', 'Headline': 'Why most GTM playbooks are already outdated', 'Post Date': '2026-04-06', 'Impressions': '27000', 'Clicks': '162', 'Likes': '1377' },
      { 'Post Name': 'Generic Company Update', 'Headline': 'Monthly company update', 'Post Date': '2026-02-23', 'Impressions': '30000', 'Clicks': '150', 'Likes': '150' },
      { 'Post Name': 'Re-engagement Post', 'Headline': 'We have some news for you', 'Post Date': '2026-03-16', 'Impressions': '20000', 'Clicks': '180', 'Likes': '160' },
      { 'Post Name': 'Holiday Hours Notice', 'Headline': 'Our support hours this week', 'Post Date': '2026-03-23', 'Impressions': '25000', 'Clicks': '175', 'Likes': '250' }
    ]
  }
};

let perfPlatform = 'email';
let perfState = null; // { campaigns, meanX, meanY }
let perfChart = null;
let perfSort = { key: null, dir: 'asc' };
let perfLastAnalysis = null;

function formatPct(v) {
  return (v * 100).toFixed(1) + '%';
}

function pctToFixed0(v) {
  return Math.round(v * 100) + '%';
}

const PERF_DOT_COLOR = '#c4541f';
const PERF_QUADRANT_COLORS = {
  hh: '#c4541f',
  hl: '#D9A831',
  lh: '#4FB3A9',
  ll: '#B454B0'
};
const PERF_SCORE_RADIUS_MIN = 4;
const PERF_SCORE_RADIUS_MAX = 15;

function computePerfCompositeScores(campaigns, meanX, meanY) {
  const devX = campaigns.map(c => c.x - meanX);
  const devY = campaigns.map(c => c.y - meanY);
  const maxAbsDevX = Math.max(...devX.map(Math.abs)) || 1;
  const maxAbsDevY = Math.max(...devY.map(Math.abs)) || 1;

  const rawScores = campaigns.map((c, i) => devX[i] / maxAbsDevX + devY[i] / maxAbsDevY);
  const rawMin = Math.min(...rawScores);
  const rawMax = Math.max(...rawScores);
  const rawRange = rawMax - rawMin;

  return rawScores.map(raw => (rawRange > 0 ? (raw - rawMin) / rawRange : 0.5));
}

function perfScoreToRadius(score) {
  return PERF_SCORE_RADIUS_MIN + (PERF_SCORE_RADIUS_MAX - PERF_SCORE_RADIUS_MIN) * (score * score);
}

function validateAndBuildCampaigns(rows, fields, config) {
  const missing = config.requiredColumns.filter(c => !fields.includes(c));
  if (missing.length > 0) {
    throw new Error(`Missing required column: "${missing[0]}". Expected columns: ${config.requiredColumns.join(', ')}.`);
  }

  if (rows.length === 0) {
    throw new Error('The CSV file has no data rows.');
  }

  rows.forEach((row, i) => {
    config.numericColumns.forEach(col => {
      const raw = row[col];
      const num = Number(String(raw).trim());
      if (raw === undefined || raw === null || String(raw).trim() === '' || !isFinite(num)) {
        throw new Error(`Row ${i + 2}: "${col}" must be a number (got "${raw === undefined ? '' : raw}").`);
      }
    });
  });

  const campaigns = rows.map(row => {
    const { x, y, raw } = config.compute(row);
    return {
      name: row[config.nameCol],
      hook: row[config.hookCol],
      date: row[config.dateCol],
      x, y,
      ...raw
    };
  });

  const meanX = campaigns.reduce((s, c) => s + c.x, 0) / campaigns.length;
  const meanY = campaigns.reduce((s, c) => s + c.y, 0) / campaigns.length;

  return { campaigns, meanX, meanY };
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderPerfTableHead(config) {
  const headEl = document.getElementById('perf-table-head');
  headEl.innerHTML = `<tr>${config.tableColumns.map(col => `<th data-key="${col.key}" data-type="${col.type}">${escapeHtml(col.label)}<span class="perf-sort-arrow"></span></th>`).join('')}</tr>`;

  headEl.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-key');
      if (perfSort.key === key) {
        perfSort.dir = perfSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        perfSort = { key, dir: 'asc' };
      }
      renderPerfTableBody(config);
      updatePerfSortArrows(config);
    });
  });
}

function updatePerfSortArrows(config) {
  const headEl = document.getElementById('perf-table-head');
  headEl.querySelectorAll('th').forEach(th => {
    const arrow = th.querySelector('.perf-sort-arrow');
    if (th.getAttribute('data-key') === perfSort.key) {
      arrow.textContent = perfSort.dir === 'asc' ? '↑' : '↓';
    } else {
      arrow.textContent = '';
    }
  });
}

function renderPerfTableBody(config) {
  const bodyEl = document.getElementById('perf-table-body');
  let rows = perfState.campaigns.slice();

  if (perfSort.key) {
    const col = config.tableColumns.find(c => c.key === perfSort.key);
    rows.sort((a, b) => {
      let av = a[perfSort.key];
      let bv = b[perfSort.key];
      if (col.type === 'number' || col.type === 'percent') {
        av = Number(av); bv = Number(bv);
      } else if (col.type === 'date') {
        av = new Date(av).getTime() || 0;
        bv = new Date(bv).getTime() || 0;
      } else {
        av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      }
      if (av < bv) return perfSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return perfSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  bodyEl.innerHTML = rows.map(c => `
    <tr>
      ${config.tableColumns.map(col => {
        let val = c[col.key];
        if (col.type === 'percent') val = formatPct(val);
        else if (col.type === 'number') val = Number(val).toLocaleString();
        const cls = col.key === 'name' ? ' class="perf-cell-name"' : '';
        return `<td${cls}>${escapeHtml(String(val))}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

function renderPerfQuadrantLegend(config) {
  const el = document.getElementById('perf-quadrant-legend');
  const q = config.quadrants;
  el.innerHTML = ['hh', 'hl', 'lh', 'll'].map(key => `
    <div class="perf-quadrant-item">
      <div class="perf-quadrant-item-title"><span class="perf-quadrant-swatch" style="background:${PERF_QUADRANT_COLORS[key]}"></span>${escapeHtml(q[key].title)}</div>
      <div class="perf-quadrant-item-desc">${escapeHtml(q[key].desc)}</div>
    </div>
  `).join('');
}

function drawPerfQuadrantLabel(ctx, text, color, anchorX, y, anchorSide, baseline) {
  const swatchSize = 8;
  const gap = 5;
  ctx.font = '600 11px Inter, sans-serif';
  const textWidth = ctx.measureText(text).width;
  const groupWidth = swatchSize + gap + textWidth;
  const groupLeft = anchorSide === 'right' ? anchorX - groupWidth : anchorX;
  const swatchY = baseline === 'top' ? y : y - swatchSize;

  ctx.fillStyle = color;
  ctx.fillRect(groupLeft, swatchY, swatchSize, swatchSize);

  ctx.fillStyle = 'rgba(204, 204, 204, 0.6)';
  ctx.textAlign = 'left';
  ctx.textBaseline = baseline;
  ctx.fillText(text, groupLeft + swatchSize + gap, y);
}

const perfQuadrantPlugin = {
  id: 'perfQuadrantOverlay',
  afterDraw(chart) {
    const opts = chart.options.plugins.perfQuadrantOverlay;
    if (!opts) return;
    const { ctx, chartArea, scales } = chart;
    const xPix = scales.x.getPixelForValue(opts.meanX);
    const yPix = scales.y.getPixelForValue(opts.meanY);

    ctx.save();
    ctx.strokeStyle = 'rgba(204, 204, 204, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xPix, chartArea.top);
    ctx.lineTo(xPix, chartArea.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPix);
    ctx.lineTo(chartArea.right, yPix);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const pad = 10;
    drawPerfQuadrantLabel(ctx, opts.labels.hh, PERF_QUADRANT_COLORS.hh, chartArea.right - pad, chartArea.top + pad, 'right', 'top');
    drawPerfQuadrantLabel(ctx, opts.labels.lh, PERF_QUADRANT_COLORS.lh, chartArea.left + pad, chartArea.top + pad, 'left', 'top');
    drawPerfQuadrantLabel(ctx, opts.labels.hl, PERF_QUADRANT_COLORS.hl, chartArea.right - pad, chartArea.bottom - pad, 'right', 'bottom');
    drawPerfQuadrantLabel(ctx, opts.labels.ll, PERF_QUADRANT_COLORS.ll, chartArea.left + pad, chartArea.bottom - pad, 'left', 'bottom');
    ctx.restore();
  }
};

function renderPerfChart(config) {
  const canvas = document.getElementById('perf-chart');
  if (perfChart) {
    perfChart.destroy();
    perfChart = null;
  }
  if (typeof Chart === 'undefined') return;

  const points = perfState.campaigns.map(c => ({
    x: c.x, y: c.y, name: c.name, hook: c.hook
  }));

  const scores = computePerfCompositeScores(perfState.campaigns, perfState.meanX, perfState.meanY);
  const radii = scores.map(perfScoreToRadius);
  const hoverRadii = radii.map(r => r + 2);

  document.getElementById('perf-chart-title').textContent = `${config.xLabel} vs. ${config.yLabel}`;

  perfChart = new Chart(canvas.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [{
        label: config.label,
        data: points,
        backgroundColor: PERF_DOT_COLOR,
        borderColor: '#211e1b',
        borderWidth: 1,
        radius: radii,
        hoverRadius: hoverRadii,
        hoverBorderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: config.xLabel, color: '#cccccc', font: { family: 'Inter', size: 12, weight: '600' } },
          ticks: { color: '#cccccc', callback: pctToFixed0 },
          grid: { color: '#3d3730' },
          border: { color: '#3d3730' }
        },
        y: {
          title: { display: true, text: config.yLabel, color: '#cccccc', font: { family: 'Inter', size: 12, weight: '600' } },
          ticks: { color: '#cccccc', callback: pctToFixed0 },
          grid: { color: '#3d3730' },
          border: { color: '#3d3730' }
        }
      },
      plugins: {
        legend: { display: false },
        perfQuadrantOverlay: {
          meanX: perfState.meanX,
          meanY: perfState.meanY,
          labels: config.quadrantShort
        },
        tooltip: {
          backgroundColor: '#211e1b',
          borderColor: '#3d3730',
          borderWidth: 1,
          padding: 12,
          titleColor: '#ffffff',
          titleFont: { family: 'Inter', weight: '700' },
          bodyColor: '#cccccc',
          bodyFont: { family: 'Inter' },
          callbacks: {
            title: (items) => items[0].raw.name,
            label: (item) => [
              `${config.hookLabel}: ${item.raw.hook}`,
              `${config.xLabel}: ${formatPct(item.raw.x)}`,
              `${config.yLabel}: ${formatPct(item.raw.y)}`
            ]
          }
        }
      }
    },
    plugins: [perfQuadrantPlugin]
  });
}

function loadPerfData(campaigns, meanX, meanY) {
  const config = PERF_CONFIG[perfPlatform];
  perfState = { campaigns, meanX, meanY };
  perfSort = { key: null, dir: 'asc' };
  perfLastAnalysis = null;

  document.getElementById('perf-empty').hidden = true;
  document.getElementById('perf-upload-error').hidden = true;
  document.getElementById('perf-chart-section').hidden = false;

  const exportBtn = document.getElementById('perf-export');
  exportBtn.disabled = true;

  const analysisResults = document.getElementById('perf-analysis-results');
  const analysisError = document.getElementById('perf-analysis-error');
  analysisResults.hidden = true;
  analysisResults.innerHTML = '';
  analysisError.hidden = true;

  renderPerfChart(config);
  renderPerfQuadrantLegend(config);
  renderPerfTableHead(config);
  renderPerfTableBody(config);

  runPerfAnalysis(config);
}

async function runPerfAnalysis(config) {
  const statusEl = document.getElementById('perf-status');
  const errorEl = document.getElementById('perf-analysis-error');
  const resultsEl = document.getElementById('perf-analysis-results');
  const exportBtn = document.getElementById('perf-export');

  statusEl.hidden = false;
  errorEl.hidden = true;
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  exportBtn.disabled = true;

  try {
    const response = await fetch(PERF_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: perfPlatform,
        xLabel: config.xLabel,
        yLabel: config.yLabel,
        campaigns: perfState.campaigns.map(c => ({ name: c.name, hook: c.hook, x: c.x, y: c.y }))
      })
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.summary !== 'string' || !data.best || !data.worst) {
      throw new Error('Unexpected response format');
    }

    perfLastAnalysis = data;
    renderPerfAnalysis(data);
    exportBtn.disabled = false;
  } catch (err) {
    perfLastAnalysis = null;
    errorEl.innerHTML = '';
    errorEl.append("Something went wrong generating this analysis. Please try again in a moment. ");
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'perf-retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => runPerfAnalysis(config));
    errorEl.appendChild(retryBtn);
    errorEl.hidden = false;
  } finally {
    statusEl.hidden = true;
  }
}

function renderPerfAnalysis(analysis) {
  const resultsEl = document.getElementById('perf-analysis-results');
  resultsEl.innerHTML = `
    <p class="perf-insights-summary">${escapeHtml(analysis.summary)}</p>
    <div class="perf-quadrant-legend">
      <div class="perf-quadrant-item">
        <div class="perf-quadrant-item-title">Best Performing</div>
        <div class="perf-quadrant-item-desc"><strong>${escapeHtml(analysis.best.name)}</strong> — ${escapeHtml(analysis.best.explanation || '')}</div>
      </div>
      <div class="perf-quadrant-item">
        <div class="perf-quadrant-item-title">Worst Performing</div>
        <div class="perf-quadrant-item-desc"><strong>${escapeHtml(analysis.worst.name)}</strong> — ${escapeHtml(analysis.worst.explanation || '')}</div>
      </div>
    </div>
  `;
  resultsEl.hidden = false;
}

function buildPerfRtfTableRow(cells, bold) {
  return cells.map(c => bold ? `{\\b ${escapeRtf(String(c))}}\\cell` : `${escapeRtf(String(c))}\\cell`).join(' ');
}

function buildPerfRtf(config) {
  const headers = config.tableColumns.map(c => c.label);
  const colWidth = Math.floor(11000 / headers.length);
  const cellx = headers.map((_, i) => (i + 1) * colWidth).join('\\cellx');

  const rows = perfState.campaigns.map(c => config.tableColumns.map(col => {
    let val = c[col.key];
    if (col.type === 'percent') val = formatPct(val);
    else if (col.type === 'number') val = Number(val).toLocaleString();
    return val;
  }));

  const lines = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}}',
    '\\viewkind4\\uc1\\f0\\fs24',
    `\\pard\\sa200\\b\\fs32 ${escapeRtf(config.label + ' Performance Analysis')}\\b0\\fs24\\par`
  ];

  if (perfLastAnalysis) {
    lines.push(`\\pard\\sa120\\sb200\\b\\fs28 Summary\\b0\\fs24\\par`);
    lines.push(`\\pard\\sa200 ${escapeRtf(perfLastAnalysis.summary)}\\par`);

    lines.push(`\\pard\\sa120\\sb200\\b\\fs28 Best Performing\\b0\\fs24\\par`);
    lines.push(`\\pard\\sa200 {\\b ${escapeRtf(perfLastAnalysis.best.name)}} - ${escapeRtf(perfLastAnalysis.best.explanation || '')}\\par`);

    lines.push(`\\pard\\sa120\\sb200\\b\\fs28 Worst Performing\\b0\\fs24\\par`);
    lines.push(`\\pard\\sa200 {\\b ${escapeRtf(perfLastAnalysis.worst.name)}} - ${escapeRtf(perfLastAnalysis.worst.explanation || '')}\\par`);
  }

  lines.push(`\\pard\\sa120\\sb200\\b\\fs28 Full Campaign Data\\b0\\fs24\\par`);
  lines.push(`\\trowd\\trgaph60\\trleft0\\cellx${cellx}`);
  lines.push(`\\intbl ${buildPerfRtfTableRow(headers, true)}`);
  lines.push('\\row');
  rows.forEach(row => {
    lines.push(`\\trowd\\trgaph60\\trleft0\\cellx${cellx}`);
    lines.push(`\\intbl ${buildPerfRtfTableRow(row, false)}`);
    lines.push('\\row');
  });

  lines.push('}');
  return lines.join('\n');
}

function showPerfUploadError(message) {
  const el = document.getElementById('perf-upload-error');
  el.textContent = message;
  el.hidden = false;
}

function setPerfPlatform(platform) {
  perfPlatform = platform;
  document.getElementById('perf-platform-email').classList.toggle('active', platform === 'email');
  document.getElementById('perf-platform-email').setAttribute('aria-pressed', platform === 'email' ? 'true' : 'false');
  document.getElementById('perf-platform-linkedin').classList.toggle('active', platform === 'linkedin');
  document.getElementById('perf-platform-linkedin').setAttribute('aria-pressed', platform === 'linkedin' ? 'true' : 'false');

  document.getElementById('perf-upload-error').hidden = true;
  document.getElementById('perf-empty').hidden = false;
  document.getElementById('perf-chart-section').hidden = true;
  document.getElementById('perf-file-input').value = '';
  perfState = null;
  if (perfChart) {
    perfChart.destroy();
    perfChart = null;
  }
}

const perfPanel = document.getElementById('panel-performance-analyzer');
if (perfPanel) {
  document.getElementById('perf-platform-email').addEventListener('click', () => setPerfPlatform('email'));
  document.getElementById('perf-platform-linkedin').addEventListener('click', () => setPerfPlatform('linkedin'));

  document.getElementById('perf-load-sample').addEventListener('click', () => {
    const config = PERF_CONFIG[perfPlatform];
    const { campaigns, meanX, meanY } = validateAndBuildCampaigns(config.sampleData, config.requiredColumns, config);
    loadPerfData(campaigns, meanX, meanY);
  });

  document.getElementById('perf-download-sample').addEventListener('click', () => {
    if (typeof Papa === 'undefined') {
      showPerfUploadError('The CSV library failed to load. Please refresh the page and try again.');
      return;
    }
    const config = PERF_CONFIG[perfPlatform];
    const csv = Papa.unparse(config.sampleData, { columns: config.requiredColumns });
    downloadBlob(`${perfPlatform}-sample-campaigns.csv`, csv, 'text/csv');
  });

  document.getElementById('perf-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const config = PERF_CONFIG[perfPlatform];

    document.getElementById('perf-upload-error').hidden = true;

    if (typeof Papa === 'undefined') {
      showPerfUploadError('The CSV library failed to load. Please refresh the page and try again.');
      e.target.value = '';
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (results.errors && results.errors.length > 0) {
            const first = results.errors[0];
            throw new Error(`Could not parse CSV: ${first.message}${typeof first.row === 'number' ? ` (row ${first.row + 2})` : ''}.`);
          }
          const { campaigns, meanX, meanY } = validateAndBuildCampaigns(results.data, results.meta.fields || [], config);
          loadPerfData(campaigns, meanX, meanY);
        } catch (err) {
          showPerfUploadError(err.message);
          document.getElementById('perf-empty').hidden = false;
          document.getElementById('perf-chart-section').hidden = true;
        }
      },
      error: (err) => {
        showPerfUploadError(`Could not read the file: ${err.message}`);
      }
    });

    e.target.value = '';
  });

  document.getElementById('perf-export').addEventListener('click', () => {
    if (!perfState) return;
    const config = PERF_CONFIG[perfPlatform];
    downloadBlob(`${perfPlatform}-performance-analysis.rtf`, buildPerfRtf(config), 'application/rtf');
  });
}
