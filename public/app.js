const formatNumber = (value) => new Intl.NumberFormat('ko-KR').format(value ?? 0);
const moneyInEok = (manwon) => manwon == null ? '자료 없음' : `${(manwon / 10000).toFixed(1)}억`;
const navItems = [...document.querySelectorAll('[data-view]')];
const viewPanels = [...document.querySelectorAll('.view-panel')];
const districtSelect = document.querySelector('#district-select');
let dashboardData = null;

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('사전 집계 자료를 읽지 못했습니다.');
  }
  if (!response.ok) throw new Error(body?.error?.message || '자료를 불러오지 못했습니다.');
  return body;
}

function setView(view) {
  const isAnalysis = view === 'analysis';
  viewPanels.forEach((panel) => {
    const active = panel.id === `view-${view}`;
    panel.hidden = !active;
    panel.classList.toggle('is-visible', active);
  });
  navItems.forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelector('#topbar-title').textContent = isAnalysis ? 'Analysis' : 'Dashboard';
  districtSelect.closest('.district-control').classList.toggle('is-hidden', !isAnalysis);
  closeSidebar();
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  document.querySelector('#sidebar-toggle').setAttribute('aria-expanded', 'false');
}

function renderLineChart(target, series) {
  if (!series?.length) {
    target.innerHTML = '<div class="empty-chart">표시할 월별 자료가 없습니다.</div>';
    return;
  }
  const width = 760;
  const height = 270;
  const left = 52;
  const right = 16;
  const top = 18;
  const bottom = 39;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = series.map((point) => point.median_deposit_manwon / 10000);
  const max = Math.max(...values, 1) * 1.12;
  const points = values.map((value, index) => ({
    x: left + (series.length === 1 ? chartWidth / 2 : (index / (series.length - 1)) * chartWidth),
    y: top + chartHeight - (value / max) * chartHeight,
    value,
    month: series[index].month,
  }));
  const grid = [0, 1, 2, 3].map((step) => {
    const y = top + (chartHeight / 3) * step;
    const label = (max * (1 - step / 3)).toFixed(0);
    return `<line class="grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="axis-label" x="${left - 9}" y="${y + 3}" text-anchor="end">${label}</text>`;
  }).join('');
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = `${path} L${points.at(-1).x},${top + chartHeight} L${points[0].x},${top + chartHeight} Z`;
  const labelIndexes = new Set([0, Math.floor((series.length - 1) / 3), Math.floor(2 * (series.length - 1) / 3), series.length - 1]);
  const labels = points.map((point, index) => labelIndexes.has(index)
    ? `<text class="axis-label" x="${point.x}" y="${height - 8}" text-anchor="middle">${point.month}</text>` : '').join('');
  const dots = points.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5"><title>${point.month}: ${point.value.toFixed(1)}억원</title></circle>`).join('');
  const gradientId = `${target.id}-area-fill`;
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="월별 아파트 전세 보증금 중앙값">
    <defs><linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#4ba99b" stop-opacity=".2"/><stop offset="100%" stop-color="#4ba99b" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="chart-area-fill" fill="url(#${gradientId})" d="${area}"/><path class="chart-line" d="${path}"/>${dots}${labels}</svg>`;
}

function renderBarChart(target, series) {
  if (!series?.length) {
    target.innerHTML = '<div class="empty-chart">표시할 연도별 자료가 없습니다.</div>';
    return;
  }
  const width = 430;
  const height = 270;
  const left = 22;
  const right = 14;
  const top = 24;
  const bottom = 42;
  const chartHeight = height - top - bottom;
  const max = Math.max(...series.map((item) => item.count), 1) * 1.18;
  const slot = (width - left - right) / series.length;
  const bars = series.map((item, index) => {
    const barHeight = (item.count / max) * chartHeight;
    const x = left + slot * index + slot * .22;
    const y = top + chartHeight - barHeight;
    const barWidth = slot * .56;
    const label = `<text class="bar-value" x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle">${formatNumber(item.count)}</text>`;
    return `<rect class="bar ${index === series.length - 1 ? 'bar-latest' : ''}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"/>${label}<text class="axis-label" x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle">${item.year}</text>`;
  }).join('');
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="연도별 거래 건수">${bars}</svg>`;
}

function formatYearChange(summary) {
  if (summary.deposit_yoy_percent == null) return '자료 부족';
  return `${summary.deposit_yoy_percent > 0 ? '+' : ''}${summary.deposit_yoy_percent.toFixed(1)}%`;
}

function renderSummary(summary, prefix = '') {
  const years = summary.period?.contract_years || [];
  const hasData = summary.transaction_count > 0;
  const fields = {
    count: document.querySelector(`#${prefix}transaction-count`),
    median: document.querySelector(`#${prefix}median-deposit`),
    yoy: document.querySelector(`#${prefix}yoy-change`),
    yoyCaption: document.querySelector(`#${prefix}yoy-caption`),
    perSqm: document.querySelector(`#${prefix}per-sqm`),
  };
  if (fields.count) fields.count.textContent = formatNumber(summary.transaction_count);
  if (fields.median) fields.median.textContent = moneyInEok(summary.median_deposit_manwon);
  if (fields.yoy) fields.yoy.textContent = formatYearChange(summary);
  if (fields.yoyCaption) fields.yoyCaption.textContent = years.length >= 2
    ? `${years.at(-1)}년 vs ${years.at(-2)}년 · 연도 누적 중앙값`
    : '비교할 이전 연도 자료가 없습니다.';
  if (fields.perSqm) fields.perSqm.textContent = summary.median_deposit_per_sqm == null
    ? '자료 없음' : formatNumber(Math.round(summary.median_deposit_per_sqm));
}

function renderDistrictRanking(districts) {
  const body = document.querySelector('#district-ranking');
  const rows = Object.values(districts).sort((a, b) => (b.median_deposit_manwon || 0) - (a.median_deposit_manwon || 0));
  body.replaceChildren();
  rows.forEach((district, index) => {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'district-name';
    name.innerHTML = `<span class="rank-number">${String(index + 1).padStart(2, '0')}</span>`;
    const nameLabel = document.createElement('span');
    nameLabel.textContent = district.district;
    name.append(nameLabel);
    const deposit = document.createElement('td');
    deposit.className = 'table-number';
    deposit.textContent = moneyInEok(district.median_deposit_manwon);
    const count = document.createElement('td');
    count.className = 'table-number muted-number';
    count.textContent = formatNumber(district.transaction_count);
    const change = document.createElement('td');
    change.className = `table-number ${district.deposit_yoy_percent > 0 ? 'change-up' : district.deposit_yoy_percent < 0 ? 'change-down' : ''}`;
    change.textContent = formatYearChange(district);
    row.append(name, deposit, count, change);
    body.append(row);
  });
}

function renderDashboard(data) {
  const summary = data.seoul;
  document.querySelector('#city-count').textContent = formatNumber(summary.transaction_count);
  document.querySelector('#city-median').textContent = moneyInEok(summary.median_deposit_manwon);
  document.querySelector('#city-yoy').textContent = formatYearChange(summary);
  document.querySelector('#city-per-sqm').textContent = summary.median_deposit_per_sqm == null
    ? '자료 없음' : formatNumber(Math.round(summary.median_deposit_per_sqm));
  const cityYears = summary.period?.contract_years || [];
  document.querySelector('#city-yoy-caption').textContent = cityYears.length >= 2
    ? `${cityYears.at(-1)}년 vs ${cityYears.at(-2)}년 · 연도 누적 중앙값`
    : '비교할 이전 연도 자료가 없습니다.';
  renderLineChart(document.querySelector('#city-monthly-chart'), summary.monthly_median_deposit || []);
  renderBarChart(document.querySelector('#city-yearly-chart'), summary.yearly_transaction_count || []);
  renderDistrictRanking(data.districts || {});
  const years = summary.period?.contract_years || data.years || [];
  document.querySelector('#dashboard-period').textContent = years.length
    ? `${years[0]} — ${years.at(-1)}`
    : '최근 3년';
  const first = summary.period?.start?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  const last = summary.period?.end?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  document.querySelector('#dashboard-status').textContent = first && last
    ? `서울 전체 · 계약 자료 기간 ${first} — ${last}`
    : '서울 전체 아파트 전세 계약 자료';
  const generated = data.generated_at ? new Date(data.generated_at) : null;
  const formatted = generated && !Number.isNaN(generated.valueOf())
    ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(generated)
    : '확인 불가';
  document.querySelector('#updated-at').textContent = `자료 갱신 ${formatted}`;
  document.querySelector('#city-data-date').textContent = `자료 갱신일 · ${formatted}`;
  document.querySelector('#sidebar-period').textContent = years.length
    ? `${years[0]} — ${years.at(-1)} 계약 자료`
    : '최근 3년 계약 자료';
}

function renderAnalysis(districtName) {
  const summary = dashboardData?.districts?.[districtName];
  if (!summary) return;
  renderSummary(summary);
  renderLineChart(document.querySelector('#monthly-chart'), summary.monthly_median_deposit || []);
  renderBarChart(document.querySelector('#yearly-chart'), summary.yearly_transaction_count || []);
  const first = summary.period?.start?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  const last = summary.period?.end?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  document.querySelector('#analysis-status').textContent = first && last
    ? `${districtName} · 계약 자료 기간 ${first} — ${last}`
    : `${districtName} · 조회 결과 거래 자료 없음`;
}

function showError(message) {
  document.querySelector('#dashboard-status').textContent = message;
  document.querySelector('#analysis-status').textContent = message;
  document.querySelector('#district-ranking').innerHTML = `<tr><td colspan="4" class="table-empty">${message}</td></tr>`;
}

function bindNavigation() {
  navItems.forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));
  document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goView)));
  districtSelect.addEventListener('change', () => renderAnalysis(districtSelect.value));
  document.querySelector('#sidebar-toggle').addEventListener('click', (event) => {
    const opened = document.body.classList.toggle('sidebar-open');
    event.currentTarget.setAttribute('aria-expanded', String(opened));
  });
  document.querySelector('#sidebar-backdrop').addEventListener('click', closeSidebar);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });
}

async function startApp() {
  bindNavigation();
  try {
    dashboardData = await getJson('/data/dashboard-summary.json');
    if (!dashboardData.seoul) throw new Error('서울 전체 사전 집계 자료가 없습니다. 최신 데이터를 다시 생성해 주세요.');
    const districts = Object.keys(dashboardData.districts || {});
    if (!districts.length) throw new Error('자치구 사전 집계 자료가 없습니다.');
    districtSelect.replaceChildren(...districts.map((district) => {
      const option = document.createElement('option');
      option.value = district;
      option.textContent = district;
      return option;
    }));
    districtSelect.disabled = false;
    const initial = new URLSearchParams(window.location.search).get('district');
    districtSelect.value = districts.includes(initial) ? initial : '마포구';
    renderDashboard(dashboardData);
    renderAnalysis(districtSelect.value);
    setView('dashboard');
  } catch (error) {
    showError(error.message || '사전 집계 자료를 불러오지 못했습니다.');
  }
}

startApp();
