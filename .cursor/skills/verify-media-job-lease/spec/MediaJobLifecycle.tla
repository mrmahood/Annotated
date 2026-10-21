------------------------------ MODULE MediaJobLifecycle ------------------------------
\* Dispatcher, lease, and retry for one hosted-media job.
\*
\* Each action is one indivisible step of the code on this branch.
\* Names match that code. This file is the model, not product code.
\*
\*   Dispatch            list_annotation_media_dispatch_candidates
\*                       + runDispatchCycle launching one worker
\*   ClaimSuccess/Miss   claim_annotation_media_processing
\*                       (FOR UPDATE recheck; Miss returns no row)
\*   StageDerivative     stage_annotation_media_derivative
\*   ConfirmRawDeleted   confirm_annotation_media_raw_deleted
\*   Publish             publish_annotation_media_playable
\*   StageTranscript     stage_annotation_media_transcript
\*   Finalize            finalize_annotation_media_ready
\*   FailRetryable       release_annotation_media_processing_attempt
\*   FailTerminal        that release for unsafe_geometry, capture_changed,
\*                       or player_not_visible before the excerpt is playable
\*   Crash               worker timeout process.exit(124) or a killed process,
\*                       with no successful release
\*   Expire              lease_expires_at passes
\*   Reconcile           reconcile_annotation_media_processing
\*   WakeOk / WakeFail   wakeDispatcherAt after a retryable release
\*   BecomeDue           next_attempt_at arrives for a later dispatcher run
\*
\* progress:
\*   0 probing, 1 raw_cleanup, 2 raw deleted and not yet published,
\*   3 published and needs a transcript, 4 transcript staged,
\*   5 finalized (lease cleared).
\* Publication is progress >= 3. The transcript does not gate it.

EXTENDS Integers, FiniteSets

CONSTANTS
  Workers, Jobs, Nil, MaxAttempts,
  CheckLease, IncrementAttempt, ExpireWhileRunning

ASSUME
  /\ Nil \notin Workers \cup Jobs
  /\ Workers \cap Jobs = {}
  /\ MaxAttempts \in Nat /\ MaxAttempts >= 1
  /\ CheckLease \in BOOLEAN
  /\ IncrementAttempt \in BOOLEAN
  /\ ExpireWhileRunning \in BOOLEAN

VARIABLES
  status,    \* job -> "queued" | "waiting" | "leased" | "failed" | "ready"
  attempt,   \* job -> 0..MaxAttempts+1
  expired,   \* job -> lease_expires_at has passed
  holder,    \* job -> worker that owns lease_token, or Nil
  wake,      \* job -> a retryable release asked the worker to wake the dispatcher
  progress,  \* job -> 0..5
  phase,     \* worker -> "idle" | "starting" | "running"
  assigned,  \* worker -> job or Nil
  pulse      \* flips only after every job is done, so a finished state is not a deadlock

vars == <<status, attempt, expired, holder, wake, progress, phase, assigned, pulse>>

Done(j) == progress[j] >= 3 \/ status[j] = "failed"

TypeOK ==
  /\ status \in [Jobs -> {"queued", "waiting", "leased", "failed", "ready"}]
  /\ attempt \in [Jobs -> 0..(MaxAttempts + 1)]
  /\ expired \in [Jobs -> BOOLEAN]
  /\ holder \in [Jobs -> Workers \cup {Nil}]
  /\ wake \in [Jobs -> BOOLEAN]
  /\ progress \in [Jobs -> 0..5]
  /\ phase \in [Workers -> {"idle", "starting", "running"}]
  /\ assigned \in [Workers -> Jobs \cup {Nil}]
  /\ pulse \in BOOLEAN
  /\ \A w \in Workers: (phase[w] = "idle") <=> (assigned[w] = Nil)

\* The list RPC. It always applies the lease and attempt filters.
\* A queued row has no lease. A leased row is listed only after expiry.
Listed(j) ==
  /\ progress[j] < 5
  /\ attempt[j] < MaxAttempts
  /\ \/ /\ status[j] = "queued"
        /\ holder[j] = Nil
     \/ /\ status[j] = "leased"
        /\ expired[j]

\* The claim RPC's recheck. CheckLease FALSE is the mutant that skips
\* `lease_token IS NULL OR lease_expires_at <= now()`.
ClaimWouldSucceed(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "starting"
  /\ j \in Jobs
  /\ progress[j] < 5
  /\ status[j] \in {"queued", "leased"}
  /\ attempt[j] < MaxAttempts
  /\ \/ ~CheckLease
     \/ holder[j] = Nil
     \/ expired[j]

\* Steps whose SQL does not compare lease_expires_at to now.
\* confirm_annotation_media_raw_deleted and finalize_annotation_media_ready.
IgnoresExpiry(p) == p \in {1, 4}

StepAllowed(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] < 5
  /\ \/ IgnoresExpiry(progress[j])
     \/ ~expired[j]

Init ==
  /\ status = [j \in Jobs |-> "queued"]
  /\ attempt = [j \in Jobs |-> 0]
  /\ expired = [j \in Jobs |-> FALSE]
  /\ holder = [j \in Jobs |-> Nil]
  /\ wake = [j \in Jobs |-> FALSE]
  /\ progress = [j \in Jobs |-> 0]
  /\ phase = [w \in Workers |-> "idle"]
  /\ assigned = [w \in Workers |-> Nil]
  /\ pulse = FALSE

\* Upload completion already set next_attempt_at = now. Initial state is due.
Dispatch(w, j) ==
  /\ phase[w] = "idle"
  /\ Listed(j)
  /\ phase' = [phase EXCEPT ![w] = "starting"]
  /\ assigned' = [assigned EXCEPT ![w] = j]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, progress, pulse>>

ClaimSuccess(w) ==
  /\ ClaimWouldSucceed(w)
  /\ LET j == assigned[w] IN
     /\ status' = [status EXCEPT ![j] = "leased"]
     /\ attempt' = [attempt EXCEPT ![j] =
          IF IncrementAttempt THEN attempt[j] + 1 ELSE attempt[j]]
     /\ expired' = [expired EXCEPT ![j] = FALSE]
     /\ holder' = [holder EXCEPT ![j] = w]
     /\ wake' = [wake EXCEPT ![j] = FALSE]
     /\ phase' = [phase EXCEPT ![w] = "running"]
     /\ UNCHANGED <<progress, assigned, pulse>>

ClaimMiss(w) ==
  /\ phase[w] = "starting"
  /\ ~ClaimWouldSucceed(w)
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, progress, pulse>>

ClaimAct(w) == ClaimSuccess(w) \/ ClaimMiss(w)

StageDerivative(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] = 0
  /\ ~expired[j]
  /\ progress' = [progress EXCEPT ![j] = 1]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, phase, assigned, pulse>>

\* No lease_expires_at comparison. The token must still match.
ConfirmRawDeleted(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] = 1
  /\ progress' = [progress EXCEPT ![j] = 2]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, phase, assigned, pulse>>

Publish(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] = 2
  /\ ~expired[j]
  /\ progress' = [progress EXCEPT ![j] = 3]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, phase, assigned, pulse>>

StageTranscript(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] = 3
  /\ ~expired[j]
  /\ progress' = [progress EXCEPT ![j] = 4]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, phase, assigned, pulse>>

Finalize(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ progress[j] = 4
  /\ progress' = [progress EXCEPT ![j] = 5]
  /\ status' = [status EXCEPT ![j] = "ready"]
  /\ holder' = [holder EXCEPT ![j] = Nil]
  /\ expired' = [expired EXCEPT ![j] = FALSE]
  /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<attempt, pulse>>

\* Retryable release. Attempt is not incremented here; claim already did.
\* attempt >= MaxAttempts is terminal. A playable row stays published.
FailRetryable(w) ==
  LET j == assigned[w] IN
  LET terminal == attempt[j] >= MaxAttempts IN
  LET nextStatus ==
    IF progress[j] < 3 /\ terminal THEN "failed"
    ELSE IF progress[j] >= 3 /\ terminal THEN "ready"
    ELSE "waiting"
  IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ ~expired[j]
  /\ progress[j] < 5
  /\ status' = [status EXCEPT ![j] = nextStatus]
  /\ holder' = [holder EXCEPT ![j] = Nil]
  /\ expired' = [expired EXCEPT ![j] = FALSE]
  /\ wake' = [wake EXCEPT ![j] = (nextStatus = "waiting")]
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<attempt, progress, pulse>>

\* Terminal before the excerpt is playable, even on attempt 1.
FailTerminal(w) ==
  LET j == assigned[w] IN
  /\ phase[w] = "running"
  /\ j \in Jobs
  /\ holder[j] = w
  /\ status[j] = "leased"
  /\ ~expired[j]
  /\ progress[j] < 3
  /\ status' = [status EXCEPT ![j] = "failed"]
  /\ holder' = [holder EXCEPT ![j] = Nil]
  /\ expired' = [expired EXCEPT ![j] = FALSE]
  /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<attempt, progress, pulse>>

\* Process is gone. The row keeps lease_token until expiry, reconcile, or a new claim.
Crash(w) ==
  /\ phase[w] = "running"
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, progress, pulse>>

\* The next RPC lost the lease (token mismatch, expiry on a checked RPC, or
\* release rejected). lease_lost does not clear the row.
Drop(w) ==
  /\ phase[w] = "running"
  /\ ~StepAllowed(w)
  /\ phase' = [phase EXCEPT ![w] = "idle"]
  /\ assigned' = [assigned EXCEPT ![w] = Nil]
  /\ UNCHANGED <<status, attempt, expired, holder, wake, progress, pulse>>

WorkerAct(w) ==
  \/ StageDerivative(w)
  \/ ConfirmRawDeleted(w)
  \/ Publish(w)
  \/ StageTranscript(w)
  \/ Finalize(w)
  \/ FailRetryable(w)
  \/ FailTerminal(w)
  \/ Crash(w)
  \/ Drop(w)

\* ExpireWhileRunning FALSE means the worker timeout has already killed the
\* process before lease_expires_at. The code does not enforce that ordering.
Expire(j) ==
  /\ status[j] = "leased"
  /\ holder[j] \in Workers
  /\ ~expired[j]
  /\ \/ ExpireWhileRunning
     \/ ~\E w \in Workers:
          /\ phase[w] = "running"
          /\ assigned[w] = j
          /\ holder[j] = w
  /\ expired' = [expired EXCEPT ![j] = TRUE]
  /\ UNCHANGED <<status, attempt, holder, wake, progress, phase, assigned, pulse>>

\* processing_status is still processing only before publication.
\* attempts_exhausted wins over a live lease, matching the function's order.
Reconcile(j) ==
  /\ status[j] = "leased"
  /\ progress[j] < 3
  /\ \/ attempt[j] >= MaxAttempts
     \/ expired[j]
  /\ IF attempt[j] >= MaxAttempts
     THEN /\ status' = [status EXCEPT ![j] = "failed"]
          /\ wake' = [wake EXCEPT ![j] = FALSE]
     ELSE /\ status' = [status EXCEPT ![j] = "queued"]
          /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ holder' = [holder EXCEPT ![j] = Nil]
  /\ expired' = [expired EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<attempt, progress, phase, assigned, pulse>>

BecomeDue(j) ==
  /\ status[j] = "waiting"
  /\ status' = [status EXCEPT ![j] = "queued"]
  /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<attempt, expired, holder, progress, phase, assigned, pulse>>

WakeOk(j) ==
  /\ wake[j]
  /\ status[j] = "waiting"
  /\ status' = [status EXCEPT ![j] = "queued"]
  /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<attempt, expired, holder, progress, phase, assigned, pulse>>

WakeFail(j) ==
  /\ wake[j]
  /\ status[j] = "waiting"
  /\ wake' = [wake EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<status, attempt, expired, holder, progress, phase, assigned, pulse>>

Rest ==
  /\ \A j \in Jobs: Done(j)
  /\ \A w \in Workers: phase[w] = "idle"
  /\ pulse' = ~pulse
  /\ UNCHANGED <<status, attempt, expired, holder, wake, progress, phase, assigned>>

Next ==
  \/ \E w \in Workers: WorkerAct(w)
  \/ \E w \in Workers: ClaimAct(w)
  \/ \E w \in Workers, j \in Jobs: Dispatch(w, j)
  \/ \E j \in Jobs: Expire(j)
  \/ \E j \in Jobs: Reconcile(j)
  \/ \E j \in Jobs: BecomeDue(j)
  \/ \E j \in Jobs: WakeOk(j)
  \/ \E j \in Jobs: WakeFail(j)
  \/ Rest

\* A running worker eventually takes some step (success, retry, terminal
\* failure, crash, or drop). That step is not required to be success.
\* A due job is eventually offered to an idle worker. Time passes. The
\* reconciler and the post-retry wake eventually run when they stay enabled.
Fairness ==
  /\ \A w \in Workers: WF_vars(WorkerAct(w))
  /\ \A w \in Workers: WF_vars(ClaimAct(w))
  /\ \A w \in Workers, j \in Jobs: WF_vars(Dispatch(w, j))
  /\ \A j \in Jobs: WF_vars(Expire(j))
  /\ \A j \in Jobs: WF_vars(Reconcile(j))
  /\ \A j \in Jobs: WF_vars(BecomeDue(j))
  /\ \A j \in Jobs: WF_vars(WakeOk(j))

Spec == Init /\ [][Next]_vars /\ Fairness

\* (1) A media job is never processed by two workers at once.
\* "Processed" means phase = running inside runOneMediaJob after a claim
\* and before return. starting is only "dispatched, not claimed yet".
MutualExclusion ==
  \A j \in Jobs:
    Cardinality({w \in Workers: phase[w] = "running" /\ assigned[w] = j}) <= 1

\* attempt_count never exceeds the claim cap. The cap is 3 in the SQL.
AttemptBound ==
  \A j \in Jobs: attempt[j] <= MaxAttempts

\* (2) Every job eventually reaches ready/published or failed.
Termination == <>(\A j \in Jobs: Done(j))

=============================================================================
