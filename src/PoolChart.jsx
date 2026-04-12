import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { getOHLCV, TIMEFRAMES, CHAINS } from './api';

export default function PoolChart({ pool }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [timeframe, setTimeframe] = useState('hour');
  const [ohlcvData, setOhlcvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartError, setChartError] = useState(false);

  const geckoNetworkId = CHAINS[pool.chainId]?.geckoNetworkId;

  // Fetch OHLCV data from GeckoTerminal
  useEffect(() => {
    if (!geckoNetworkId || !pool.poolAddr) {
      setLoading(false);
      setChartError(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setChartError(false);

    getOHLCV(geckoNetworkId, pool.poolAddr, timeframe)
      .then((data) => {
        if (!cancelled) {
          setOhlcvData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setChartError(true);
        }
      });

    return () => { cancelled = true; };
  }, [geckoNetworkId, pool.poolAddr, timeframe]);

  // Create / update chart
  useEffect(() => {
    if (!containerRef.current || !ohlcvData || ohlcvData.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth;

    const chart = createChart(container, {
      width,
      height: 350,
      layout: {
        background: { color: '#161b22' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#30363d',
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#58a6ff',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const candles = [];
    const volumes = [];

    for (const [time, open, high, low, close, volume] of ohlcvData) {
      if (!time || open == null || high == null || low == null || close == null) continue;
      candles.push({ time, open, high, low, close });
      volumes.push({
        time,
        value: volume || 0,
        color: close >= open ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)',
      });
    }

    candleSeries.setData(candles);
    volumeSeries.setData(volumes);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w } = entry.contentRect;
        chart.applyOptions({ width: w });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [ohlcvData]);

  const chainName = CHAINS[pool.chainId]?.name || `Chain ${pool.chainId}`;

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-meta">
          <span>
            <span className="label">Pool:</span>{' '}
            <code>{pool.poolAddr?.slice(0, 8)}...{pool.poolAddr?.slice(-6)}</code>
          </span>
          <span><span className="label">Chain:</span> {chainName}</span>
          <span><span className="label">Protocol:</span> {pool.protocol}</span>
          {pool.rewardTokens !== '(fees only)' && (
            <span><span className="label">Rewards:</span> {pool.rewardTokens}</span>
          )}
        </div>
        <div className="timeframe-buttons">
          {Object.entries(TIMEFRAMES).map(([key, label]) => (
            <button
              key={key}
              className={timeframe === key ? 'active' : ''}
              onClick={() => setTimeframe(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="chart-loading">Loading chart from GeckoTerminal...</div>
      ) : chartError || !ohlcvData || ohlcvData.length === 0 ? (
        <div className="chart-loading">
          Chart data not available for this pool on GeckoTerminal
          <br />
          <small style={{ color: 'var(--text-muted)' }}>
            Try viewing on{' '}
            <a href={`https://vfat.io/yield`} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
              vfat.io
            </a>
          </small>
        </div>
      ) : (
        <div className="chart-wrapper" ref={containerRef} />
      )}
    </div>
  );
}
