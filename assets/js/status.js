// Small enhancements; the page works without JavaScript.
(() => {
  const tip = document.querySelector('.tip');
  const showTip = (text, x, y) => {
    tip.textContent = text;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.hidden = false;
  };
  const hideTip = () => { tip.hidden = true; };

  // Mobile nav toggle (no Bootstrap JS loaded, same as nrec.no).
  const toggler = document.querySelector('.navbar-toggler');
  toggler?.addEventListener('click', () => {
    const open = document.getElementById('nav').classList.toggle('show');
    toggler.setAttribute('aria-expanded', String(open));
  });

  // Tooltips on the daily uptime bars.
  document.querySelectorAll('.uptime .bar').forEach((bar) => {
    bar.addEventListener('mouseenter', () => {
      const r = bar.getBoundingClientRect();
      showTip(bar.dataset.tip, r.left + r.width / 2, r.top);
    });
    bar.addEventListener('mouseleave', hideTip);
  });

  // Hover readout on sparklines: nearest point under the pointer.
  const num = new Intl.NumberFormat('en-GB');
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.querySelectorAll('.spark').forEach((el) => {
    const series = JSON.parse(el.dataset.series);
    const vals = series.map((p) => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const dot = el.querySelector('.spark-hover');
    const cursor = el.querySelector('.spark-cursor');
    const H = 48, pad = 5;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const i = Math.round(f * (series.length - 1));
      const xf = i / (series.length - 1 || 1);
      const yf = (H - pad - ((vals[i] - min) / (max - min || 1)) * (H - 2 * pad)) / H;
      el.classList.add('active');
      dot.style.left = `${xf * 100}%`;
      dot.style.top = `${yf * 100}%`;
      cursor.setAttribute('x1', xf * 240);
      cursor.setAttribute('x2', xf * 240);
      showTip(`${day.format(new Date(series[i][0]))}: ${num.format(vals[i])}`, r.left + xf * r.width, r.top + yf * r.height);
    });
    el.addEventListener('pointerleave', () => { el.classList.remove('active'); hideTip(); });
  });

  // Relative "last checked" time and a warning if the checks have stopped.
  const updated = document.body.dataset.checksUpdated;
  const staleMin = Number(document.body.dataset.staleMinutes || 45);
  if (updated) {
    const ageMin = (Date.now() - Date.parse(updated)) / 6e4;
    const ago = document.querySelector('.js-ago');
    if (ago) {
      const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
      ago.textContent = ageMin < 60
        ? rtf.format(-Math.round(ageMin), 'minute')
        : ageMin < 48 * 60 ? rtf.format(-Math.round(ageMin / 60), 'hour') : rtf.format(-Math.round(ageMin / 1440), 'day');
      ago.title = new Date(updated).toLocaleString('en-GB');
    }
    if (ageMin > staleMin) document.querySelector('.stale-warning').hidden = false;
  }
})();
