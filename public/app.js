const districtSelect = document.querySelector('#district-select');
const statusText = document.querySelector('#status-text');
const updatedAt = document.querySelector('#updated-at');
const emptyState = document.querySelector('#empty-state');
const monthlyChart = document.querySelector('#monthly-chart');
const yearlyChart = document.querySelector('#yearly-chart');
const kpiFields = {
  count: document.querySelector('#transaction-count'),
  deposit: document.querySelector('#median-deposit'),
  yoy: document.querySelector('#yoy-change'),
  yoyCaption: document.querySelector('#yoy-caption'),
  perSqm: document.querySelector('#per-sqm'),
};

const moneyInEok = (manwon) => manwon == null ? '자료 없음' : `${(manwon / 10000).toFixed(1)}억`;
const formatNumber = (value) => new Intl.NumberFormat('ko-KR').format(value ?? 0);

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    throw new Error(body?.error?.message || '데이터를 불러오지 못했습니다.');
  }
  return body;
}

const API_PAGE_SIZE = 1000;
const PAGE_FETCH_CONCURRENCY = 4;

async function loadDistrictRecords(district) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];
  statusText.textContent = '연도별 거래 자료의 양을 확인하고 있습니다.';

  const firstPages = await Promise.all(years.map((year) =>
    getJson(`/api/records?district=${encodeURIComponent(district)}&year=${year}&start=1`)
  ));
  const records = firstPages.flatMap((page) => page.records || []);
  const pending = [];
  for (const page of firstPages) {
    for (let start = API_PAGE_SIZE + 1; start <= page.total; start += API_PAGE_SIZE) {
      pending.push({ year: page.year, start });
    }
  }

  const totalPages = firstPages.length + pending.length;
  let completed = firstPages.length;
  statusText.textContent = `${district} 아파트 전세 자료 수집 중 · ${completed}/${totalPages} 페이지`;

  for (let index = 0; index < pending.length; index += PAGE_FETCH_CONCURRENCY) {
    const batch = pending.slice(index, index + PAGE_FETCH_CONCURRENCY);
    const pages = await Promise.all(batch.map(({ year, start }) =>
      getJson(`/api/records?district=${encodeURIComponent(district)}&year=${year}&start=${start}`)
    ));
    for (const page of pages) records.push(...(page.records || []));
    completed += pages.length;
    statusText.textContent = `${district} 아파트 전세 자료 수집 중 · ${completed}/${totalPages} 페이지`;
  }

  return records;
}

function setLoading(isLoading) {
  document.body.classList.toggle('is-loading', isLoading);
  districtSelect.disabled = isLoading;
  if (isLoading) {
    statusText.textContent = '선택한 자치구의 거래 자료를 불러오는 중입니다.';
    emptyState.hidden = true;
    monthlyChart.innerHTML = '<div class="empty-chart">차트를 준비하고 있습니다…</div>';
    yearlyChart.innerHTML = '<div class="empty-chart">차트를 준비하고 있습니다…</div>';
    Object.values(kpiFields).forEach((node) => { node.textContent = '—'; });
  }
}

function showError(message) {
  statusText.textContent = message;
  updatedAt.textContent = '';
  monthlyChart.innerHTML = '<div class="empty-chart">데이터를 표시할 수 없습니다.</div>';
  yearlyChart.innerHTML = '<div class="empty-chart">데이터를 표시할 수 없습니다.</div>';
  Object.values(kpiFields).forEach((node) => { node.textContent = '—'; });
}

function renderLineChart(target, series) {
  if (!series.length) {
    target.innerHTML = '<div class="empty-chart">표시할 월별 자료가 없습니다.</div>';
    return;
  }
  const width = 720;
  const height = 250;
  const left = 48;
  const right = 12;
  const top = 13;
  const bottom = 35;
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
    ? `<text class="axis-label" x="${point.x}" y="${height - 7}" text-anchor="middle">${point.month}</text>` : '').join('');
  const dots = points.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5"><title>${point.month}: ${point.value.toFixed(1)}억원</title></circle>`).join('');
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="월별 아파트 전세 보증금 중앙값">
    <defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#436ff0" stop-opacity=".16"/><stop offset="100%" stop-color="#436ff0" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="chart-area-fill" d="${area}"/><path class="chart-line" d="${path}"/>${dots}${labels}</svg>`;
}

function renderBarChart(target, series) {
  if (!series.length) {
    target.innerHTML = '<div class="empty-chart">표시할 연도별 자료가 없습니다.</div>';
    return;
  }
  const width = 390;
  const height = 250;
  const left = 25;
  const right = 12;
  const top = 20;
  const bottom = 38;
  const chartHeight = height - top - bottom;
  const max = Math.max(...series.map((item) => item.count), 1) * 1.18;
  const slot = (width - left - right) / series.length;
  const bars = series.map((item, index) => {
    const barHeight = (item.count / max) * chartHeight;
    const x = left + slot * index + slot * .22;
    const y = top + chartHeight - barHeight;
    const barWidth = slot * .56;
    const className = index === series.length - 1 ? 'bar bar-last' : 'bar';
    return `<rect class="${className}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"/><text class="bar-value" x="${x + barWidth / 2}" y="${y - 7}" text-anchor="middle">${formatNumber(item.count)}</text><text class="axis-label" x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle">${item.year}</text>`;
  }).join('');
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="연도별 거래 건수">${bars}</svg>`;
}

function renderSummary(summary) {
  const years = summary.period.contract_years || [];
  const hasData = summary.transaction_count > 0;
  emptyState.hidden = hasData;
  kpiFields.count.textContent = hasData ? formatNumber(summary.transaction_count) : '0';
  kpiFields.deposit.textContent = moneyInEok(summary.median_deposit_manwon);
  kpiFields.yoy.textContent = summary.deposit_yoy_percent == null ? '자료 부족' : `${summary.deposit_yoy_percent > 0 ? '+' : ''}${summary.deposit_yoy_percent.toFixed(1)}%`;
  kpiFields.yoyCaption.textContent = years.length >= 2 ? `${years.at(-1)}년 vs ${years.at(-2)}년 중앙값` : '비교할 이전 연도 자료가 없습니다.';
  kpiFields.perSqm.textContent = summary.median_deposit_per_sqm == null ? '자료 없음' : formatNumber(Math.round(summary.median_deposit_per_sqm));
  renderLineChart(monthlyChart, summary.monthly_median_deposit || []);
  renderBarChart(yearlyChart, summary.yearly_transaction_count || []);
  const first = summary.period.start?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  const last = summary.period.end?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
  statusText.textContent = hasData ? `${summary.district} · 자료 기간 ${first} — ${last}` : `${summary.district} · 조회 결과 거래 자료 없음`;
  updatedAt.textContent = `조회 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
}

async function loadDistrict(district) {
  setLoading(true);
  try {
    const records = await loadDistrictRecords(district);
    statusText.textContent = `${district} 자료 ${formatNumber(records.length)}건을 분석하고 있습니다.`;
    const summary = await getJson('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ district, records }),
    });
    renderSummary(summary);
  } catch (error) {
    showError(error.message || '데이터를 불러오지 못했습니다.');
  } finally {
    document.body.classList.remove('is-loading');
    districtSelect.disabled = false;
  }
}

async function startApp() {
  try {
    const { districts } = await getJson('/api/districts');
    districtSelect.replaceChildren(...districts.map((district) => {
      const option = document.createElement('option');
      option.value = district;
      option.textContent = district;
      return option;
    }));
    districtSelect.disabled = false;
    districtSelect.addEventListener('change', () => loadDistrict(districtSelect.value));
    const initial = new URLSearchParams(window.location.search).get('district');
    const district = districts.includes(initial) ? initial : '마포구';
    districtSelect.value = district;
    await loadDistrict(district);
  } catch (error) {
    districtSelect.disabled = true;
    showError(error.message || '자치구 목록을 불러오지 못했습니다.');
  }
}

startApp();

