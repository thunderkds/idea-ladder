// Polls the job every 2 seconds and reloads the page when the status changes.
// The server renders no script once the status is final, so polling stops there.
(function () {
  var script = document.querySelector('script[data-job-id]');
  if (!script) return;
  var jobId = script.dataset.jobId;
  var shown = script.dataset.status;

  function tick() {
    fetch('/api/jobs/' + encodeURIComponent(jobId), { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (job) {
        if (job && job.status !== shown) location.reload();
        else setTimeout(tick, 2000);
      })
      .catch(function () { setTimeout(tick, 2000); });
  }
  setTimeout(tick, 2000);
})();
