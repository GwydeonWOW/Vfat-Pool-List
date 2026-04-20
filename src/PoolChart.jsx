import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { getTokenPriceHistory, getExoticToken, TIMEFRAMES, CHAINS, MAJOR_TOKENS } from './api';

export default function PoolChart({ pool }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [timeframe, setTimeframe] = useState('week');
  const [priceData, setPriceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartError, setChartError] = useState(false);

  const exoticToken = getExoticToken(pool);

  const spanMap = { hour: 1, day: 24, week: 168 };

  // Fetch price data from DeFiLlama
  useEffect(() => {
    if (!exoticToken?.address) {
      setLoading(false);
      setChartError(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setChartError(false);

    getTokenPriceHistory(pool.chainId, exoticToken.address, spanMap[timeframe])
      .then((data) => {
        if (!cancelled) {
          setPriceData(data);
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
  }, [pool.chainId, exoticToken?.address, timeframe]);

  // Create / update chart
  useEffect(() => {
    if (!containerRef.current || !priceData || priceData.length < 2) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth;

    try {
      const chart = createChart(container, {
        width,
        height: 300,
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

      // Find the first price for color calculation
      const firstPrice = priceData[0]?.price || 0;
      const lastPrice = priceData[priceData.length - 1]?.price || 0;
      const lineColor = lastPrice >= firstPrice ? '#3fb950' : '#f85149';

      // Determine decimal precision based on price magnitude
      const samplePrice = priceData[Math.floor(priceData.length / 2)]?.price || lastPrice;
      let priceFormat;
      if (samplePrice < 0.0001) priceFormat = { type: 'price', precision: 10, minMove: 0.0000000001 };
      else if (samplePrice < 0.01) priceFormat = { type: 'price', precision: 8, minMove: 0.00000001 };
      else if (samplePrice < 1) priceFormat = { type: 'price', precision: 6, minMove: 0.000001 };
      else priceFormat = { type: 'price', precision: 4, minMove: 0.0001 };

      const lineSeries = chart.addLineSeries({
        color: lineColor,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat,
      });

      const formattedData = priceData
        .filter((p) => p.time && Number.isFinite(p.price) && p.price > 0)
        .map((p) => ({ time: p.time, value: p.price }));

      if (formattedData.length < 2) return;

      lineSeries.setData(formattedData);
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
    } catch (err) {
      console.error('Chart render error:', err);
      setChartError(true);
    }
  }, [priceData]);

  const chainName = CHAINS[pool.chainId]?.name || `Chain ${pool.chainId}`;

  // Calculate price change
  let priceChange = null;
  if (priceData && priceData.length >= 2) {
    const first = priceData[0].price;
    const last = priceData[priceData.length - 1].price;
    if (first > 0) {
      priceChange = ((last - first) / first * 100).toFixed(2);
    }
  }

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-meta">
          <span>
            <span className="label">Token:</span>{' '}
            <strong>{exoticToken?.symbol || '?'}</strong>
            {priceData?.length > 0 && (
              <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 13 }}>
                ${priceData[priceData.length - 1].price < 0.0001
                  ? priceData[priceData.length - 1].price.toExponential(4)
                  : priceData[priceData.length - 1].price < 0.01
                    ? priceData[priceData.length - 1].price.toFixed(8)
                    : priceData[priceData.length - 1].price < 1
                      ? priceData[priceData.length - 1].price.toFixed(6)
                      : priceData[priceData.length - 1].price.toFixed(4)}
              </span>
            )}
            {priceChange != null && (
              <span
                className={parseFloat(priceChange) >= 0 ? 'positive' : 'negative'}
                style={{ marginLeft: 8, fontSize: 13 }}
              >
                {parseFloat(priceChange) >= 0 ? '+' : ''}{priceChange}%
              </span>
            )}
          </span>
          <span><span className="label">Chain:</span> {chainName}</span>
          <span><span className="label">Protocol:</span> {pool.protocol}</span>
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
        <div className="chart-loading">Loading price data...</div>
      ) : chartError || !priceData || priceData.length < 2 ? (
        <div className="chart-loading">
          No price data available for {exoticToken?.symbol || 'this token'}
        </div>
      ) : (
        <div className="chart-wrapper" ref={containerRef} />
      )}
    </div>
  );
}
