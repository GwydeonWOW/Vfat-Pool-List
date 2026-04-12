import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { getOHLCV, TIMEFRAMES } from './api';

const TF_LABELS = {
  minute: '1m',
  hour: '1h',
  day: '1d',
};

export default function PoolChart({ pool, networkId }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const [timeframe, setTimeframe] = useState('hour');
  const [ohlcvData, setOhlcvData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch OHLCV data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOHLCV(networkId, pool.address, timeframe)
      .then((data) => {
        if (!cancelled) {
          setOhlcvData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [networkId, pool.address, timeframe]);

  // Create / update chart
  useEffect(() => {
    if (!containerRef.current || !ohlcvData || ohlcvData.length === 0) return;

    // Clean up previous chart
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

    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      color: '#58a6ff',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeriesRef.current = volumeSeries;

    // Transform OHLCV data
    const candles = [];
    const volumes = [];

    for (const [time, open, high, low, close, volume] of ohlcvData) {
      if (!time || !close) continue;
      const t = time;
      candles.push({ time: t, open, high, low, close });
      volumes.push({
        time: t,
        value: volume || 0,
        color: close >= open ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)',
      });
    }

    candleSeries.setData(candles);
    volumeSeries.setData(volumes);
    chart.timeScale().fitContent();

    // Resize observer
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

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-meta">
          <span><span className="label">Address:</span> {pool.address?.slice(0, 10)}...{pool.address?.slice(-8)}</span>
          {pool.poolCreatedAt && (
            <span><span className="label">Created:</span> {new Date(pool.poolCreatedAt).toLocaleDateString()}</span>
          )}
          <span><span className="label">MCap:</span> {formatUsd(pool.marketCapUsd)}</span>
        </div>
        <div className="timeframe-buttons">
          {Object.entries(TF_LABELS).map(([key, label]) => (
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
        <div className="chart-loading">Loading chart data...</div>
      ) : !ohlcvData || ohlcvData.length === 0 ? (
        <div className="chart-loading">No chart data available</div>
      ) : (
        <div className="chart-wrapper" ref={containerRef} />
      )}
    </div>
  );
}

function formatUsd(num) {
  if (!num || num === 0) return '-';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}
