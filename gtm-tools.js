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

// ICP Research
const ICP_API_URL = 'https://dave-gtm-api.vercel.app/api/research';
const ICP_SECTION_HEADERS = [
  'Company Overview',
  'Buyer Persona',
  'Top Pain Points',
  'Outreach Angle',
  'Marketing Channel Fit',
  'Competitive Landscape'
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
  const headerRegex = new RegExp(`(?:^|\\n)\\s*#{0,3}\\s*\\**\\s*(${escapedHeaders.join('|')})\\s*\\**\\s*:?[ \\t]*`, 'gi');
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
