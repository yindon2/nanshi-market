# 南极市场 - 股票分析平台

基于东方财富实时API的股票分析平台，可部署至GitHub Pages。

## 功能
- 实时股票行情查询（实时数据）
- K线图、MACD、RSI、布林带技术分析
- 相似股票推荐
- 预生成离线数据支持

## 部署
```bash
git remote add origin https://github.com/yindon2/nanshi-market.git
git add .
git commit -m "init nanshi-market"
git push -u origin main
```

然后在 GitHub 仓库 Settings → Pages 中启用，选择 main 分支。

## 数据更新
运行 `python update_data.py` 可预生成股票数据文件至 `data/` 目录。
