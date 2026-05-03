#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import tushare as ts
import pandas as pd
import numpy as np
import os, json, time
from datetime import datetime, timedelta
from scipy.spatial.distance import cdist

TOKEN = 'def19b67637cf5ab54a05591d7d1a8af984539fbf314ac10daacd9ca'          # 替换为你的 Tushare Token
DATA_DIR = 'data'
STOCK_DATA_DIR = os.path.join(DATA_DIR, 'stock_data')
SIMILAR_DIR = os.path.join(DATA_DIR, 'similar')
START_DATE = (datetime.now() - timedelta(days=3*365)).strftime('%Y%m%d')
END_DATE = datetime.now().strftime('%Y%m%d')

ts.set_token(TOKEN)
pro = ts.pro_api()

def calc_macd(close, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    macd = 2 * (dif - dea)
    return pd.DataFrame({'DIF': dif, 'DEA': dea, 'MACD': macd})

def calc_rsi(close, window=14):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window).mean()
    avg_loss = loss.rolling(window).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calc_bollinger(close, window=20, num_std=2):
    ma = close.rolling(window).mean()
    std = close.rolling(window).std()
    upper = ma + num_std * std
    lower = ma - num_std * std
    return ma, upper, lower

def calc_momentum(close, period):
    return (close / close.shift(period) - 1).fillna(0)

def calc_reverse(close, period):
    return -calc_momentum(close, period)

def calc_vol_price_factor(vol, amount, window=5):
    vol_ratio = vol / vol.rolling(window).mean()
    return vol_ratio, amount

def calc_kline_pattern(df):
    body = abs(df['close'] - df['open'])
    upper_shadow = df['high'] - df[['open', 'close']].max(axis=1)
    lower_shadow = df[['open', 'close']].min(axis=1) - df['low']
    pattern_score = (lower_shadow - upper_shadow) / (df['high'] - df['low'] + 1e-6)
    return pattern_score

def calc_capital_flow(df, window=5):
    obv = (df['vol'] * ((df['close'] > df['close'].shift(1)).astype(int) * 2 - 1)).cumsum()
    return obv.pct_change(window)

def calc_rolling_factor(close, window=20):
    return close.pct_change().rolling(window).std()

# 获取全市场股票列表
print("获取全市场股票列表...")
stocks = pro.stock_basic(exchange='', list_status='L', fields='ts_code,symbol,name,list_date')
print(f"共 {len(stocks)} 只股票")

stock_list = stocks[['ts_code', 'name']].to_dict(orient='records')
os.makedirs(DATA_DIR, exist_ok=True)
with open(os.path.join(DATA_DIR, 'stock_list.json'), 'w', encoding='utf-8') as f:
    json.dump(stock_list, f, ensure_ascii=False)

os.makedirs(STOCK_DATA_DIR, exist_ok=True)
os.makedirs(SIMILAR_DIR, exist_ok=True)

feature_cols = ['momentum_5d', 'momentum_20d', 'reverse_1d', 'reverse_5d',
                'vol_ratio', 'capital_flow', 'rsi_14', 'boll_position']
latest_features = []
codes_for_sim = []

print("开始处理股票数据...")
for idx, row in stocks.head(1).iterrows():   # 先测试3只，成功后去掉 head(3)
    code = row['ts_code']
    try:
        df = pro.daily(ts_code=code, start_date=START_DATE, end_date=END_DATE, adj='qfq')
        if df.empty:
            continue
        df = df.sort_values('trade_date').reset_index(drop=True)
        df['trade_date'] = pd.to_datetime(df['trade_date'], format='%Y%m%d')

        # 注意字段：vol 和 amount 是 Tushare 原始字段
        df = df[['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']].copy()

        # 计算技术指标
        df['MA5'] = df['close'].rolling(5).mean()
        df['MA20'] = df['close'].rolling(20).mean()
        df['BOLL_MID'], df['BOLL_UP'], df['BOLL_DN'] = calc_bollinger(df['close'])
        df['boll_position'] = (df['close'] - df['BOLL_MID']) / (df['BOLL_UP'] - df['BOLL_DN'] + 1e-6)

        macd_df = calc_macd(df['close'])
        df = pd.concat([df, macd_df], axis=1)
        df['MACD_golden'] = ((df['DIF'] > df['DEA']) & (df['DIF'].shift(1) <= df['DEA'].shift(1)))
        df['MACD_dead'] = ((df['DIF'] < df['DEA']) & (df['DIF'].shift(1) >= df['DEA'].shift(1)))

        df['RSI14'] = calc_rsi(df['close'], 14)
        df['RSI6'] = calc_rsi(df['close'], 6)
        df['RSI_overbought'] = df['RSI14'] > 70
        df['RSI_oversold'] = df['RSI14'] < 30

        df['momentum_5d'] = calc_momentum(df['close'], 5)
        df['momentum_20d'] = calc_momentum(df['close'], 20)
        df['reverse_1d'] = calc_reverse(df['close'], 1)
        df['reverse_5d'] = calc_reverse(df['close'], 5)

        df['vol_ratio'], df['amount'] = calc_vol_price_factor(df['vol'], df['amount'])

        df['kline_pattern'] = calc_kline_pattern(df)
        df['capital_flow'] = calc_capital_flow(df)
        df['rolling_vol'] = calc_rolling_factor(df['close'], 20)

        df = df.ffill().bfill()

        df['trade_date'] = df['trade_date'].dt.strftime('%Y-%m-%d')
        stock_data = df.to_dict(orient='records')

        with open(os.path.join(STOCK_DATA_DIR, f'{code}.json'), 'w', encoding='utf-8') as f:
            json.dump(stock_data, f, ensure_ascii=False)

        # 提取最新特征
        last = df.iloc[-1]
        feat = [last.get('momentum_5d', 0), last.get('momentum_20d', 0),
                last.get('reverse_1d', 0), last.get('reverse_5d', 0),
                last.get('vol_ratio', 0), last.get('capital_flow', 0) if pd.notna(last.get('capital_flow')) else 0,
                last.get('RSI14', 50), last.get('boll_position', 0)]
        latest_features.append(feat)
        codes_for_sim.append(code)

        print(f"完成 {code} ({row['name']})")
    except Exception as e:
        print(f"处理 {code} 失败: {e}")
        continue
    time.sleep(0.15)

# 相似度计算
print("计算股票相似度...")
if latest_features:
    features_array = np.array(latest_features)
    feat_mean = np.nanmean(features_array, axis=0)
    feat_std = np.nanstd(features_array, axis=0)
    feat_std[feat_std == 0] = 1
    norm_features = (features_array - feat_mean) / feat_std
    distances = cdist(norm_features, norm_features, metric='euclidean')

    for i, code in enumerate(codes_for_sim):
        dist_row = distances[i]
        dist_row[i] = np.inf
        top3_idx = np.argsort(dist_row)[:3]
        similar_codes = [codes_for_sim[j] for j in top3_idx]
        with open(os.path.join(SIMILAR_DIR, f'{code}.json'), 'w', encoding='utf-8') as f:
            json.dump({'similar': similar_codes}, f, ensure_ascii=False)

print("数据更新完毕！")