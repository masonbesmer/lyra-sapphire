<script>
  export let queue = null;

  function fmtTime(ms) {
    if (!ms) return '0:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function progressPct(queue) {
    if (!queue?.current?.durationMS) return 0;
    return Math.min((queue.streamTime / queue.current.durationMS) * 100, 100);
  }
</script>

<div class="now-playing">
  {#if queue?.current}
    <div class="track-info">
      {#if queue.current.thumbnail}
        <img src={queue.current.thumbnail} alt="thumbnail" />
      {/if}
      <div class="meta">
        <a href={queue.current.url} target="_blank" rel="noopener">{queue.current.title}</a>
        <span class="author">{queue.current.author}</span>
        <span class="requester">Requested by: {queue.current.requestedBy?.username ?? 'Unknown'}</span>
      </div>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progressPct(queue)}%"></div>
    </div>
    <div class="times">
      <span>{fmtTime(queue.streamTime)}</span>
      <span>{queue.current.duration}</span>
    </div>
    <div class="status">
      <span>🔊 {queue.volume}%</span>
      <span>{queue.paused ? '⏸ Paused' : '▶ Playing'}</span>
      <span>🔁 {['Off','Track','Queue','Autoplay'][queue.repeatMode] ?? 'Off'}</span>
    </div>
  {:else}
    <div class="empty">Nothing is playing right now.</div>
  {/if}
</div>

<style>
  .now-playing { background: #16213e; border-radius: 10px; padding: 1.25rem; }
  .track-info { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 0.75rem; }
  .track-info img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; }
  .meta { display: flex; flex-direction: column; gap: 0.2rem; }
  .meta a { color: #a0c4ff; font-weight: 600; font-size: 1rem; text-decoration: none; }
  .meta a:hover { text-decoration: underline; }
  .author { color: #a0a0c0; font-size: 0.85rem; }
  .requester { color: #6a6a8a; font-size: 0.8rem; }
  .progress-bar { height: 6px; background: #2a2a4a; border-radius: 3px; overflow: hidden; margin-bottom: 0.3rem; }
  .progress-fill { height: 100%; background: #5865f2; transition: width 1s linear; }
  .times { display: flex; justify-content: space-between; font-size: 0.75rem; color: #6a6a8a; margin-bottom: 0.5rem; }
  .status { display: flex; gap: 1rem; font-size: 0.85rem; color: #a0a0c0; }
  .empty { text-align: center; color: #6a6a8a; padding: 1rem; }
</style>
