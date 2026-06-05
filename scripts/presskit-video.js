(function pressKitVideo(){
  const video = document.querySelector('[data-presskit-video]');
  if (!video) return;

  const appId = video.dataset.appId || '4166900';
  const title = document.querySelector('[data-trailer-name]');
  const fallbackLink = document.querySelector('[data-video-fallback]');

  function showFallback(){
    if (fallbackLink) {
      fallbackLink.hidden = false;
    }
  }

  fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`)
    .then((response) => response.json())
    .then((payload) => {
      const movie = payload[appId] && payload[appId].data && payload[appId].data.movies
        ? payload[appId].data.movies[0]
        : null;
      if (!movie) {
        throw new Error('Trailer metadata unavailable');
      }

      if (title && movie.name) {
        title.textContent = movie.name;
      }

      if (fallbackLink && movie.highlight) {
        fallbackLink.href = `https://store.steampowered.com/app/${appId}/Drunken_Hog/`;
      }

      const hlsSource = movie.hls_h264;
      if (!hlsSource) {
        throw new Error('HLS trailer URL unavailable');
      }

      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        hls.loadSource(hlsSource);
        hls.attachMedia(video);
        return;
      }

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsSource;
        return;
      }

      showFallback();
    })
    .catch(() => {
      showFallback();
    });
})();