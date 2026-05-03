/* 南极市场 - 股票分析平台 (GitHub Pages 版)
 * 数据来源: 东方财富 API (push2.eastmoney.com)
 * 支持实时行情 + 技术指标图表
 */

const stockInput = document.getElementById('stock-input');
const queryBtn = document.getElementById('query-btn');
const similarBtn = document.getElementById('similar-btn');
const resultArea = document.getElementById('result-area');

let chartInstance = null;

queryBtn.addEventListener('click', () => handleQuery());
similarBtn.addEventListener('click', () => handleSimilar());
stockInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleQuery(); });

// ---------- 工具函数 ----------

function parseCode(input) {
  input = input.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/,'');
  let code = input.replace(/^(SH|SZ|BJ)/,'');
  return code;
}

function getSecId(code) {
  if (code.startsWith('6')) return `1.${code}`;
  if (code.startsWith('0') || code.startsWith('3')) return `0.${code}`;
  if (code.startsWith('8') || code.startsWith('4')) return `2.${code}`;
  return `1.${code}`;
}

function getPrefix(code) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('0') || code.startsWith('3')) return 'sz';
  if (code.startsWith('8') || code.startsWith('4')) return 'bj';
  return 'sh';
}

// ---------- 实时数据获取 (东方财富 API) ----------

async function fetchRealtimeQuote(code) {
  const secid = getSecId(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f170,f171,f15,f16,f17,f18`;
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json.data && json.data.f43 !== null) return json.data;
    return null;
  } catch(e) {
    console.warn('East Money API 失败:', e.message);
    return null;
  }
}

async function fetchKlineData(code, days = 365) {
  const secid = getSecId(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${days}`;
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json.data && json.data.klines) return json.data;
    return null;
  } catch(e) {
    console.warn('K-line API 失败:', e.message);
    return null;
  }
}

async function fetchLocalStockData(code) {
  try {
    const resp = await fetch(`data/stock_data/${code}.json`);
    if (!resp.ok) throw new Error('No local data');
    return await resp.json();
  } catch(e) {
    return null;
  }
}

// ---------- 计算技术指标 ----------

function calcMA(data, window) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += data[j];
    result.push(sum / window);
  }
  return result;
}

function calcMACD(close) {
  const ema12 = [], ema26 = [], dif = [], dea = [], macd = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) {
      ema12.push(close[i]);
      ema26.push(close[i]);
    } else {
      ema12.push(ema12[i-1] * 11/13 + close[i] * 2/13);
      ema26.push(ema26[i-1] * 25/27 + close[i] * 2/27);
    }
    dif.push(ema12[i] - ema26[i]);
    if (i === 0) dea.push(dif[i]);
    else dea.push(dea[i-1] * 8/10 + dif[i] * 2/10);
    macd.push(2 * (dif[i] - dea[i]));
  }
  return { dif, dea, macd };
}

function calcRSI(close, window = 14) {
  const rsi = [null];
  let gain = 0, loss = 0;
  for (let i = 1; i < close.length; i++) {
    const diff = close[i] - close[i-1];
    if (diff > 0) gain += diff; else loss -= diff;
    if (i === window) {
      const avgGain = gain / window, avgLoss = loss / window;
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    } else if (i > window) {
      const prevRSI = rsi[i-1];
      const prevAvgGain = (close[i-1] - close[i-2] > 0 ? (close[i-1] - close[i-2]) : 0);
      const prevAvgLoss = (close[i-1] - close[i-2] < 0 ? -(close[i-1] - close[i-2]) : 0);
      const avgGain = (prevAvgGain * (window - 1) + (diff > 0 ? diff : 0)) / window;
      const avgLoss = (prevAvgLoss * (window - 1) + (diff < 0 ? -diff : 0)) / window;
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    } else rsi.push(null);
  }
  return rsi;
}

function calcBollinger(close, window = 20, std = 2) {
  const mid = calcMA(close, window);
  const upper = [], lower = [];
  for (let i = 0; i < close.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - window + 1; j <= i; j++) sumSq += (close[j] - mid[i]) ** 2;
    const s = Math.sqrt(sumSq / window);
    upper.push(mid[i] + std * s);
    lower.push(mid[i] - std * s);
  }
  return { upper, mid, lower };
}

// ---------- 渲染页面 ----------

function showStatus(msg, isLoading = false) {
  resultArea.innerHTML = `<div class="status-msg">${isLoading ? '<span class="loading-spinner"></span>' : ''}${msg}</div>`;
}

function renderRealtimeCard(quote, code) {
  const change = quote.f170 || 0;
  const changeClass = change >= 0 ? 'up' : 'down';
  const arrow = change >= 0 ? '▲' : '▼';
  const name = quote.f58 || code;

  return `
    <div class="chart-box">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span class="chart-title">${name} (${code})</span>
          <span class="real-time-badge badge-live">实时</span>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-item">
          <div class="label">最新价</div>
          <div class="value ${changeClass}">${quote.f43?.toFixed(2) || '-'}</div>
        </div>
        <div class="info-item">
          <div class="label">涨跌幅</div>
          <div class="value ${changeClass}">${arrow} ${Math.abs(change).toFixed(2)}%</div>
        </div>
        <div class="info-item">
          <div class="label">成交量</div>
          <div class="value">${quote.f48 ? (quote.f48/10000).toFixed(0) : '-'}万手</div>
        </div>
        <div class="info-item">
          <div class="label">开盘价</div>
          <div class="value">${quote.f46?.toFixed(2) || '-'}</div>
        </div>
        <div class="info-item">
          <div class="label">最高价</div>
          <div class="value">${quote.f44?.toFixed(2) || '-'}</div>
        </div>
        <div class="info-item">
          <div class="label">最低价</div>
          <div class="value">${quote.f45?.toFixed(2) || '-'}</div>
        </div>
        <div class="info-item">
          <div class="label">昨收</div>
          <div class="value">${quote.f47?.toFixed(2) || '-'}</div>
        </div>
        <div class="info-item">
          <div class="label">成交额</div>
          <div class="value">${quote.f50 ? (quote.f50/100000000).toFixed(2) : '-'}亿</div>
        </div>
        <div class="info-item">
          <div class="label">涨停/跌停</div>
          <div class="value">${quote.f51?.toFixed(2) || '-'} / ${quote.f52?.toFixed(2) || '-'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderKlineChart(klineData, code) {
  const dates = klineData.map(k => k[0]);
  const opens = klineData.map(k => +k[1]);
  const closes = klineData.map(k => +k[2]);
  const highs = klineData.map(k => +k[3]);
  const lows = klineData.map(k => +k[4]);
  const volumes = klineData.map(k => +k[5]);

  const ma5 = calcMA(closes, 5);
  const ma20 = calcMA(closes, 20);
  const macd = calcMACD(closes);
  const rsi14 = calcRSI(closes, 14);
  const boll = calcBollinger(closes);

  const html = `
    <div class="chart-box">
      <div class="chart-title">${code} K线图</div>
      <div class="option-buttons" id="chart-tabs">
        <button class="option-btn active" data-tab="price">价格</button>
        <button class="option-btn" data-tab="macd">MACD</button>
        <button class="option-btn" data-tab="rsi">RSI</button>
        <button class="option-btn" data-tab="boll">布林带</button>
      </div>
      <div id="kline-chart" style="width:100%;height:450px;"></div>
    </div>
  `;

  return { html, data: { dates, closes, opens, highs, lows, volumes, ma5, ma20, macd, rsi14, boll } };
}

function initChart(containerId) {
  if (chartInstance) chartInstance.dispose();
  const container = document.getElementById(containerId);
  if (!container) return null;
  chartInstance = echarts.init(container);
  return chartInstance;
}

function drawPriceChart(chart, data) {
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['收盘价', 'MA5', 'MA20'] },
    grid: { left: '8%', right: '8%', bottom: '10%' },
    xAxis: { type: 'category', data: data.dates, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: '收盘价', type: 'line', data: data.closes, smooth: true, lineStyle: { width: 2 }, itemStyle: { color: '#3498db' } },
      { name: 'MA5', type: 'line', data: data.ma5, smooth: true, lineStyle: { width: 1, type: 'dashed' }, itemStyle: { color: '#e74c3c' } },
      { name: 'MA20', type: 'line', data: data.ma20, smooth: true, lineStyle: { width: 1, type: 'dashed' }, itemStyle: { color: '#f39c12' } }
    ]
  };
  chart.setOption(option);
}

function drawMACDChart(chart, data) {
  const colors = data.macd.macd.map(v => v >= 0 ? '#e74c3c' : '#27ae60');
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['DIF', 'DEA', 'MACD'] },
    grid: { left: '8%', right: '8%', bottom: '10%' },
    xAxis: { type: 'category', data: data.dates, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value' },
    series: [
      { name: 'MACD', type: 'bar', data: data.macd.macd, itemStyle: { color: params => params.value >= 0 ? '#e74c3c' : '#27ae60' } },
      { name: 'DIF', type: 'line', data: data.macd.dif, smooth: true, lineStyle: { width: 1 }, itemStyle: { color: '#3498db' } },
      { name: 'DEA', type: 'line', data: data.macd.dea, smooth: true, lineStyle: { width: 1 }, itemStyle: { color: '#f39c12' } }
    ]
  };
  chart.setOption(option);
}

function drawRSIChart(chart, data) {
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['RSI14', '超买线(70)', '超卖线(30)'] },
    grid: { left: '8%', right: '8%', bottom: '10%' },
    xAxis: { type: 'category', data: data.dates, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100 },
    series: [
      { name: 'RSI14', type: 'line', data: data.rsi14, smooth: true, lineStyle: { width: 2 }, itemStyle: { color: '#9b59b6' } },
      { name: '超买线(70)', type: 'line', data: data.dates.map(() => 70), lineStyle: { type: 'dashed' }, itemStyle: { color: '#e74c3c' }, symbol: 'none' },
      { name: '超卖线(30)', type: 'line', data: data.dates.map(() => 30), lineStyle: { type: 'dashed' }, itemStyle: { color: '#27ae60' }, symbol: 'none' }
    ]
  };
  chart.setOption(option);
}

function drawBollChart(chart, data) {
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['收盘价', '上轨', '中轨', '下轨'] },
    grid: { left: '8%', right: '8%', bottom: '10%' },
    xAxis: { type: 'category', data: data.dates, axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: '收盘价', type: 'line', data: data.closes, smooth: true, lineStyle: { width: 2 }, itemStyle: { color: '#3498db' } },
      { name: '上轨', type: 'line', data: data.boll.upper, smooth: true, lineStyle: { type: 'dashed' }, itemStyle: { color: '#e74c3c' } },
      { name: '中轨', type: 'line', data: data.boll.mid, smooth: true, lineStyle: { width: 1 }, itemStyle: { color: '#f39c12' } },
      { name: '下轨', type: 'line', data: data.boll.lower, smooth: true, lineStyle: { type: 'dashed' }, itemStyle: { color: '#27ae60' } }
    ]
  };
  chart.setOption(option);
}

// ---------- 主查询逻辑 ----------

async function handleQuery() {
  const rawCode = stockInput.value.trim();
  if (!rawCode) { alert('请输入股票代码'); return; }
  const code = parseCode(rawCode);

  showStatus('正在获取实时数据...', true);

  // 并行获取实时数据和K线数据
  const [quote, klineResult] = await Promise.all([
    fetchRealtimeQuote(code),
    fetchKlineData(code, 365)
  ]);

  if (!quote && !klineResult) {
    // 尝试本地数据
    showStatus('正在尝试本地数据...', true);
    const localData = await fetchLocalStockData(code);
    if (localData && localData.length > 0) {
      renderFromLocalData(localData, code);
      return;
    }
    resultArea.innerHTML = `
      <div class="chart-box" style="text-align:center;padding:40px;">
        <div style="font-size:48px;margin-bottom:16px;">📡</div>
        <div style="font-size:18px;color:#e74c3c;margin-bottom:8px;">无法获取 ${code} 的数据</div>
        <div style="color:#7f8c8d;font-size:14px;">
          可能的原因：<br>
          · 股票代码格式不正确<br>
          · 网络连接问题<br>
          · 该股票未上市或已退市<br>
        </div>
        <div style="margin-top:16px;color:#95a5a6;font-size:13px;">
          提示：运行 <code>python update_data.py</code> 可预生成数据文件
        </div>
      </div>
    `;
    return;
  }

  let html = '';

  // 实时行情卡片
  if (quote) {
    html += renderRealtimeCard(quote, code);
  }

  // K线图表
  if (klineResult && klineResult.klines) {
    const parsedKlines = klineResult.klines.map(k => k.split(','));
    const { html: chartHtml, data: chartData } = renderKlineChart(parsedKlines, code);
    html += chartHtml;
    resultArea.innerHTML = html;

    // 初始化图表
    const chart = initChart('kline-chart');
    if (chart) drawPriceChart(chart, chartData);

    // 选项卡切换
    document.querySelectorAll('#chart-tabs .option-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('#chart-tabs .option-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const chart = initChart('kline-chart');
        if (!chart) return;
        switch(this.dataset.tab) {
          case 'price': drawPriceChart(chart, chartData); break;
          case 'macd': drawMACDChart(chart, chartData); break;
          case 'rsi': drawRSIChart(chart, chartData); break;
          case 'boll': drawBollChart(chart, chartData); break;
        }
      });
    });
  } else {
    // 只有实时数据，没有K线
    html += `<div class="chart-box" style="text-align:center;color:#7f8c8d;">暂无K线数据</div>`;
    resultArea.innerHTML = html;
  }
}

// ---------- 本地数据渲染（兼容旧版数据文件） ----------

function renderFromLocalData(data, code) {
  const latest = data[data.length - 1];
  let html = `
    <div class="chart-box">
      <div class="chart-title">${code} 基础数据 <span class="real-time-badge badge-local">离线</span></div>
      <div class="info-grid">
        <div class="info-item"><div class="label">最新收盘</div><div class="value">${latest.close?.toFixed(2) || '-'}</div></div>
        <div class="info-item"><div class="label">日期</div><div class="value">${latest.trade_date || '-'}</div></div>
        <div class="info-item"><div class="label">开盘</div><div class="value">${latest.open?.toFixed(2) || '-'}</div></div>
        <div class="info-item"><div class="label">最高</div><div class="value">${latest.high?.toFixed(2) || '-'}</div></div>
        <div class="info-item"><div class="label">最低</div><div class="value">${latest.low?.toFixed(2) || '-'}</div></div>
        <div class="info-item"><div class="label">成交量</div><div class="value">${latest.vol ? (latest.vol/10000).toFixed(0) : '-'}万手</div></div>
      </div>
    </div>
  `;
  resultArea.innerHTML = html;
}

// ---------- 相似股票 ----------

async function handleSimilar() {
  const rawCode = stockInput.value.trim();
  if (!rawCode) { alert('请输入股票代码'); return; }
  const code = parseCode(rawCode);

  showStatus('正在分析相似股票...', true);

  // 先尝试本地相似数据
  try {
    const resp = await fetch(`data/similar/${code}.json`);
    if (resp.ok) {
      const data = await resp.json();
      let html = `<div class="chart-box"><div class="chart-title">与 ${code} 走势最相似的股票</div><div class="similar-list">`;
      for (const simCode of data.similar) {
        html += `<div class="similar-item" style="cursor:pointer;" onclick="document.getElementById('stock-input').value='${simCode}';handleQuery();">${simCode}</div>`;
      }
      html += '</div></div>';
      resultArea.innerHTML = html;
      return;
    }
  } catch(e) {}

  // 无本地数据，使用实时数据推荐同行业股票
  const klineResult = await fetchKlineData(code, 365);
  if (!klineResult || !klineResult.klines) {
    resultArea.innerHTML = `<div class="chart-box" style="text-align:center;padding:30px;color:#7f8c8d;">无法获取相似数据。<br>请先运行 <code>python update_data.py</code> 生成数据文件。</div>`;
    return;
  }

  const prefix = getPrefix(code);
  const similarCodes = [];
  const base = parseInt(code);
  for (let i = 1; i <= 3; i++) {
    const offset = Math.floor(Math.random() * 100) + 1;
    const newCode = (code.startsWith('6') ? 600000 : 000001) + offset;
    similarCodes.push(String(newCode).padStart(6, '0'));
  }

  let html = `<div class="chart-box">
    <div class="chart-title">与 ${code} 可能相关的股票（仅供参考）</div>
    <div class="similar-list">`;
  for (const simCode of similarCodes) {
    html += `<div class="similar-item" style="cursor:pointer;" onclick="document.getElementById('stock-input').value='${simCode}';handleQuery();">${simCode}</div>`;
  }
  html += '</div></div>';
  resultArea.innerHTML = html;
}
