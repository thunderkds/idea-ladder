// The browser twin of src/review/scheduler.ts: the same ts-fsrs library (served at /assets/vendor/ts-fsrs.js),
// the same parameters (fuzz off), the same state shape. The server stays the source of truth.
(function (root) {
  var F = root.FSRS;
  if (!F) return;
  var scheduler = F.fsrs(F.generatorParameters({ enable_fuzz: false }));

  function toCard(s) {
    var card = {
      due: new Date(s.due),
      stability: s.stability,
      difficulty: s.difficulty,
      elapsed_days: s.elapsedDays,
      scheduled_days: s.scheduledDays,
      learning_steps: s.learningSteps,
      reps: s.reps,
      lapses: s.lapses,
      state: s.state,
    };
    if (s.lastReview) card.last_review = new Date(s.lastReview);
    return card;
  }

  function fromCard(c) {
    return {
      due: c.due.toISOString(),
      stability: c.stability,
      difficulty: c.difficulty,
      elapsedDays: c.elapsed_days,
      scheduledDays: c.scheduled_days,
      learningSteps: c.learning_steps,
      reps: c.reps,
      lapses: c.lapses,
      state: c.state,
      lastReview: c.last_review ? c.last_review.toISOString() : null,
    };
  }

  root.ILScheduler = {
    initialState: function (now) {
      return fromCard(F.createEmptyCard(now));
    },
    // state: null for a card the learner has not rated yet. now: a Date. Returns the JSON form of the next state.
    scheduleNext: function (state, rating, now) {
      var start = state ? toCard(state) : F.createEmptyCard(now);
      return fromCard(scheduler.next(start, now, rating).card);
    },
  };
})(globalThis);
