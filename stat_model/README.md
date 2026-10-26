# Football goal and shot predictor

It returns separate cumulative goal and shot probabilities for any
integer window from 1 to 30 seconds after a completed pass or carry.

## Contents

- src/football_value/predict.py: load once, prepare the input matrix and predict.
- src/football_value/features.py: the ordered 13 predictors.
- src/football_value/__init__.py and __main__.py: Python API and command line.
- src/football_value/models/role_skills.json: current role-group skill values.
- src/football_value/models/config.json: file checksums, schema and alert thresholds.
- run_current.sh: run directly from the extracted package.
- requirements.txt and pyproject.toml: dependency and optional installation.

## Run

Requires Python 3.10+. Run from this repository's stat_model directory (macOS/Linux):

~~~sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./run_current.sh --input /path/to/input.json --horizons 1 3 30
~~~

The first two commands are only needed for initial setup. Replace
/path/to/input.json with your input file.

## Statistical model

The forecast has two stages: role-group action-skill estimates and separate
discrete-time hazard models for goals and shots. This package contains their
frozen prediction parameters.

### Role-group action skills

For skill $k$ and a group $c$ of attempts with the same role and context:

$$
Y_{kc}\sim\mathrm{Binomial}(n_{kc},q_{kc}),\qquad
\mathrm{logit}(q_{kc})
=\alpha_k+\gamma_{k,g(c)}+\boldsymbol{\theta}_k^\top\mathbf d_c.
$$

Here, $Y_{kc}$ and $n_{kc}$ are successful and total attempts, $q_{kc}$ is the
success probability, $g(c)$ is the role group, and $\mathbf d_c$ contains the
action-context predictors. $\alpha_k$ is an intercept, $\gamma_{k,g}$ a role
effect, and $\boldsymbol{\theta}_k$ the context coefficients.

| Skill | Predictors in the historical fit |
|---|---|
| Passing | Role, pass-length group and pass height |
| Finishing | Role, shot-distance group and shot-angle group |
| Dribbling | Role only in the current fitted model |

The ability inputs are fitted role effects, centred using each role's
skill-specific historical share of attempts. Missing role effects use the
stored neutral fallback. Values are log-odds effects, not probabilities or
individual player ratings. Players in the same role share all three values.

The original fits used arm::bayesglm with normal priors: Normal(0, 10^2)
for intercepts and Normal(0, 2.5^2) for slopes. Saved values are regularized
posterior-mode point estimates. Historical training features used strictly earlier
training dates; prediction uses the final training-only role table.

### Goal and shot event times

Let $i$ index a completed successful pass or carry at time $t_i$, with a
13-feature vector $\mathbf x_i$. Features are standardized element by element
using the saved training means $\boldsymbol\mu$ and scales $\mathbf s$:

$$
\mathbf z_i=(\mathbf x_i-\boldsymbol\mu)/\mathbf s.
$$

For target $r\in\{\mathrm{goal},\mathrm{shot}\}$, let $T_i^{(r)}$ be the waiting
time from $t_i$ to the first eligible same-team target event. For future second
$j=1,\ldots,30$, the conditional event probability is:

$$
h_{ij}^{(r)}
=\Pr(j-1\lt T_i^{(r)}\le j\mid T_i^{(r)}\gt j-1,\mathbf x_i)
=\mathrm{logit}^{-1}
\left(a_j^{(r)}+\boldsymbol\beta_r^\top\mathbf z_i\right).
$$

Each target has 30 future-second intercepts $a_j^{(r)}$ and 13 feature
coefficients $\boldsymbol\beta_r$ shared across seconds. Original fitting
used the summed observed-interval logistic likelihood with ridge penalty
$\lambda\|\boldsymbol\beta_r\|^2/2$, plus a small intercept penalty. Both targets
selected $\lambda=1$ on the validation set. Unobserved future intervals were
censored rather than labelled as no event, using a one-second discretization.

The cumulative probability for a requested window $H$ is:

$$
p_H^{(r)}(\mathbf x_i)
=\Pr(T_i^{(r)}\le H\mid\mathbf x_i)
=1-\prod_{j=1}^{H}(1-h_{ij}^{(r)}),
\qquad H=1,\ldots,30.
$$

Features stay fixed within one forecast. The next completed move creates a
new forecast from updated features. The requested horizon is an output setting,
not an observed predictor or elapsed attacking-sequence time.

Targets use shot-start timestamps: any eligible shot for the shot target,
and a goal-scoring shot for the goal target. Targets belong to the same team
and regulation period but may occur after a possession change. They are not
restricted to the current possession. Goal and shot models are fitted
independently, so their probabilities are not constrained to be nested.

## Match simulation data

### Match and players

Use a 105 x 68 m reference pitch and keep a match_id, two team IDs, and the
observed end time of each regulation half. Timestamps below are seconds since
the start of the corresponding half. Orient each attacking team towards
increasing x, with the opposing goal centre at (105, 34).

| Player field | Meaning |
|---|---|
| player_id | Unique player ID |
| team_id | Player's team |
| role | Current role group from the table below |

You may simulate positions and movement for every player. The current forecast
uses the ball movement and the holder's role; it does not directly consume all
22 players' coordinates, body attributes, market values or fitness.

| Role value | Group |
|---|---|
| goalkeeper | Goalkeeper |
| centre_back | Centre back |
| fullback_wingback | Fullback or wingback |
| central_midfield | Central or defensive midfield |
| attacking_wide | Attacking midfield or wide attack |
| striker | Striker |

### Event stream

| Event field | Meaning |
|---|---|
| match_id, event_id | Match and unique event IDs |
| period | 1 for the first half, 2 for the second half |
| team_id | Team performing the action |
| possession_id | Current continuous-possession identifier |
| event_type | pass, carry, shot, turnover, restart, etc. |
| actor_id | Player performing the action |
| recipient_id | Receiving player for a pass; otherwise null |
| start_time_s, end_time_s | Action start and completion, in seconds within the half |
| start_x_m, start_y_m | Action start coordinates in metres |
| end_x_m, end_y_m | Action end coordinates in metres |
| success | 1 for a completed successful action, otherwise 0 |
| is_cross | 1 for a cross, otherwise 0; carry uses 0 |
| under_pressure | 1 if the actor was under pressure during the action, otherwise 0 |
| phase | open_play, corner, free_kick or penalty |
| shot_outcome | For shots: goal, saved, missed, blocked, etc.; otherwise null |

Update possession_id on a new possession or restart and distinguish halves
and teams when building history. Trigger predictions only after completed
successful passes and carries. After a pass, use the receiver's role; after
a carry, use the actor's role. A successful take-on/dribble event is not itself
a completed carry with observed start/end coordinates.

Use open-play actions in regulation periods. Exclude entire corner, free-kick
and penalty phases, not only the restart kick. Save shot starts and outcomes
as simulated ground truth, separately from the current model inputs. To
construct a future-window label, search for the next eligible same-team shot
or scoring-shot start in the same half, allowing possession changes.

## Input contract

The input is a JSON array of records. Each record contains a features object;
the output preserves input order. Raw match events are not converted into
features automatically by this package.

| Predictor | Definition |
|---|---|
| goal_distance_m | End-point distance to goal centre, in metres |
| goal_angle_rad | Angle between goalposts from the end point, in radians |
| lateral_squared | (end_y_m / 68 - 0.5)^2 |
| is_pass | 1 for a completed successful pass, 0 for a completed carry |
| forward_progress_m | Signed forward progress in metres |
| move_speed_mps | Straight-line move distance divided by max(0.1, duration in seconds) |
| is_cross | Cross indicator, 0 or 1; carry uses 0 |
| recent_5s_count | Completed-move count in the same possession over the past 5 seconds, including the current move |
| recent_5s_forward_m | Signed forward-progress sum over those moves |
| under_pressure | Actor under-pressure indicator for the just-completed action, 0 or 1 |

### Prepared input JSON

This illustrates a completed forward pass ending at (85, 34) metres with
a two-second duration. The other recent moves are summarized in the two
history predictors.

~~~json
[
  {
    "role": "striker",
    "features": {
      "goal_distance_m": 20.0,
      "goal_angle_rad": 0.36199452278241806,
      "lateral_squared": 0.0,
      "is_pass": 1,
      "forward_progress_m": 10.0,
      "move_speed_mps": 5.0,
      "is_cross": 0,
      "recent_5s_count": 3,
      "recent_5s_forward_m": 20.0,
      "under_pressure": 0
    }
  }
]
~~~

The ten values plus role become the model's 13-feature vector. match_id,
event_id and player IDs can remain in your simulation for bookkeeping; they
are not predictors and are not echoed by the prediction API. Horizons such
as 1, 3 and 30 are requested when calling the predictor, not added to features.

## Output and alerts

Each output record has goal and shot objects. Keys such as "3" and "30" are
future windows in seconds; values are probabilities between 0 and 1.
For example, 0.02 means a 2% cumulative probability within that window, not
the probability exactly at its final second.

With --alerts, the fixed 30-second goal and shot cutoffs are 2.1471% and
20.7779%, respectively. A flag is true when probability > cutoff.


## Validation diagnostics

The models were trained on 484 matches and assessed on 24 later World Cup
2022 validation matches. Of 34,528 completed-move forecast records, 34,523 had
full 1-second follow-up and 34,510 had full 3-second follow-up.
The same validation set was used for model and threshold selection; these
are exploratory validation results, not independent test results.

### Probability prediction: next 1s and 3s

**Next 1s**

| Metric | Goal | Shot |
|---|---:|---:|
| Observed positive-record rate | 0.10% | 0.72% |
| Average precision  | 17.91% | 40.29% |
| ROC-AUC  | 0.9884 | 0.9843 |
| Brier score (lower is better) | 0.000942 | 0.006545 |

**Next 3s**

| Metric | Goal | Shot |
|---|---:|---:|
| Observed positive-record rate | 0.25% | 1.75% |
| Average precision  | 11.43% | 40.75% |
| ROC-AUC  | 0.9615 | 0.9629 |
| Brier score (lower is better) | 0.002443 | 0.015211 |


### Forecast-record confusion matrices: next 1s and 3s

These classify whether an event occurs within the next 1 or 3 seconds.
They do not measure whether a warning arrived at least 1 or 3 seconds early.
Counts are forecast records, not distinct goals or shots.

Each target/window uses a separate threshold selected on the same validation
set, keeping forecast-record FPR within the existing approximately 7.84%
budget. These diagnostic cutoffs do not change the fixed 30-second --alerts rule.

**Goal: next 1s** — 34,523 forecast records; cutoff approximately 0.1477%.

| Actual outcome | Predict event | Predict no event |
|---|---:|---:|
| Goal | 33 (TP) | 0 (FN) |
| No goal | 2,704 (FP) | 31,786 (TN) |

**Shot: next 1s** — 34,523 forecast records; cutoff approximately 1.5372%.

| Actual outcome | Predict event | Predict no event |
|---|---:|---:|
| Shot | 245 (TP) | 3 (FN) |
| No shot | 2,687 (FP) | 31,588 (TN) |

**Goal: next 3s** — 34,510 forecast records; cutoff approximately 0.3889%.

| Actual outcome | Predict event | Predict no event |
|---|---:|---:|
| Goal | 73 (TP) | 13 (FN) |
| No goal | 2,699 (FP) | 31,725 (TN) |

**Shot: next 3s** — 34,510 forecast records; cutoff approximately 3.7746%.

| Actual outcome | Predict event | Predict no event |
|---|---:|---:|
| Shot | 521 (TP) | 82 (FN) |
| No shot | 2,658 (FP) | 31,249 (TN) |


## Python API

~~~python
from football_value import Forecaster

predictor = Forecaster()
# records is your list of prepared input records.
probabilities = predictor.predict(records, horizons=[1, 3, 30], include_alerts=True)
# Reuse predictor for subsequent moves; parameters stay loaded in memory.
~~~

## References

1. StatsBomb. [StatsBomb Open Data](https://github.com/statsbomb/open-data).
2. Singer, J. D., and Willett, J. B. (1993). [It's About Time: Using Discrete-Time Survival Analysis to Study Duration and the Timing of Events](https://doi.org/10.3102/10769986018002155).
3. R package arm. [bayesglm documentation](https://search.r-project.org/CRAN/refmans/arm/help/bayesglm.html).
4. Gelman, A., et al. (2008). [A weakly informative default prior distribution for logistic and other regression models](https://doi.org/10.1214/08-AOAS191).
5. Harris, C. R., et al. (2020). [Array programming with NumPy](https://doi.org/10.1038/s41586-020-2649-2).
