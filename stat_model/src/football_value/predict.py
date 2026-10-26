"""Load frozen parameters and predict; no training or evaluation dependencies."""
import argparse
import hashlib
import json
from numbers import Integral
from pathlib import Path
import sys

import numpy as np

from .features import MINIMAL

SKILLS = ("finishing", "passing", "dribbling")


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _checked_file(directory, item):
    name = item.get("file")
    if not isinstance(name, str) or Path(name).name != name:
        raise ValueError("Model configuration must use local filenames")
    path = directory / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != item.get("sha256"):
        raise ValueError("Model checksum mismatch: " + name)
    return path


class _Hazard:
    """Read-only standardized logistic hazards, with one intercept per second."""

    def __init__(self, payload, target):
        if (payload.get("format_version") != 1
                or payload.get("model_type") != "landmark_discrete_time_hazard"
                or payload.get("max_horizon") != 30
                or payload.get("target") != target
                or payload.get("feature_names") != list(MINIMAL)):
            raise ValueError("Unexpected saved forecast schema")
        for name in ("mean", "scale", "coef", "intercepts"):
            value = np.asarray(payload[name], dtype=float)
            expected = 30 if name == "intercepts" else len(MINIMAL)
            if value.shape != (expected,) or not np.all(np.isfinite(value)):
                raise ValueError("Invalid model parameter: " + name)
            value.setflags(write=False)
            setattr(self, name, value)
        if np.any(self.scale <= 0):
            raise ValueError("Model scales must be positive")

    def cumulative(self, features):
        with np.errstate(over="ignore", invalid="ignore"):
            linear = ((features - self.mean) / self.scale) @ self.coef
            eta = linear[:, None] + self.intercepts[None, :]
        if not np.all(np.isfinite(eta)):
            raise ValueError("Prediction feature scale overflow")
        decay = np.exp(-np.abs(eta))
        hazard = np.where(eta >= 0, 1.0 / (1.0 + decay), decay / (1.0 + decay))
        return 1.0 - np.cumprod(1.0 - hazard, axis=1)


class Forecaster:
    """Load once and reuse. Input is prepared features, not raw match events."""

    def __init__(self, model_dir=None):
        directory = Path(model_dir) if model_dir is not None else Path(__file__).parent / "models"
        config = _read(directory / "config.json")
        if (config.get("format_version") != 1 or config.get("max_horizon") != 30
                or config.get("features") != list(MINIMAL)):
            raise ValueError("Unexpected prediction configuration")
        self._models = {
            target: _Hazard(_read(_checked_file(directory, config["models"][target])), target)
            for target in ("goal", "shot")
        }
        profile = _read(_checked_file(directory, config["role_skills"]))
        if profile.get("variant") != "group_only":
            raise ValueError("Only frozen role-group skills are supported")
        self._role_skills = {}
        for role, values in profile["roles"].items():
            if set(values) != {"ability_" + skill for skill in SKILLS}:
                raise ValueError("Incomplete role skill values")
            if not all(np.isfinite(float(value)) for value in values.values()):
                raise ValueError("Nonfinite role skill values")
            self._role_skills[role] = {name: float(value) for name, value in values.items()}
        if not self._role_skills:
            raise ValueError("Role skill table is empty")
        self._thresholds = {target: float(config["thresholds"][target]) for target in ("goal", "shot")}
        if not all(np.isfinite(value) and 0 <= value <= 1 for value in self._thresholds.values()):
            raise ValueError("Invalid alert thresholds")
        self.roles = tuple(self._role_skills)

    @property
    def thresholds(self):
        return dict(self._thresholds)

    def role_features(self, role):
        """Return the saved three skill values for a supported holder role."""
        if not isinstance(role, str) or role not in self._role_skills:
            raise ValueError("Unknown role; choose one of: " + ", ".join(self.roles))
        return dict(self._role_skills[role])

    def _matrix(self, records):
        if not isinstance(records, list):
            raise ValueError("Input must be a JSON array of records")
        rows = []
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                raise ValueError("Each input record must be an object")
            values = record.get("features", record)
            if not isinstance(values, dict):
                raise ValueError("features must be an object")
            values = dict(values)
            role = record.get("role", values.get("role"))
            if role is not None:
                values.update(self.role_features(role))
            missing = [name for name in MINIMAL if name not in values]
            if missing:
                raise ValueError("Record " + str(index) + " missing predictors: " + ", ".join(missing))
            row = []
            for name in MINIMAL:
                value = values[name]
                if not isinstance(value, (int, float, np.integer, np.floating, np.bool_)):
                    raise ValueError("Predictor must be numeric: " + name)
                try:
                    value = float(value)
                except (ValueError, OverflowError):
                    raise ValueError("Predictor must be finite: " + name) from None
                if not np.isfinite(value):
                    raise ValueError("Predictor must be finite: " + name)
                row.append(value)
            rows.append(row)
        return np.asarray(rows, dtype=float).reshape(-1, len(MINIMAL))

    def predict(self, records, horizons=None, include_alerts=False):
        """Return cumulative goal/shot probabilities in input order.

        With role supplied, saved role-group values fill the three ability
        predictors. Alerts always compare the 30-second probability against
        the stored threshold, regardless of the requested output horizons.
        """
        horizons = list(range(1, 31)) if horizons is None else list(horizons)
        if not horizons or any(isinstance(h, (bool, np.bool_)) or not isinstance(h, Integral)
                               or not 1 <= h <= 30 for h in horizons):
            raise ValueError("horizons must be integer seconds from 1 to 30")
        horizons = [int(h) for h in horizons]
        matrix = self._matrix(records)
        if not len(matrix):
            return []
        indices = np.asarray(horizons, dtype=int) - 1
        results = [{} for _ in records]
        for target, model in self._models.items():
            cumulative = model.cumulative(matrix)
            for index, probabilities in enumerate(cumulative):
                results[index][target] = {
                    str(h): float(p) for h, p in zip(horizons, probabilities[indices])
                }
                if include_alerts:
                    results[index].setdefault("alerts", {})[target] = bool(
                        probabilities[29] > self._thresholds[target]
                    )
        return results


def main():
    parser = argparse.ArgumentParser(
        description="Predict goal/shot probabilities over future 1..30-second windows."
    )
    parser.add_argument("--input", required=True, help="Prepared JSON input file, or - for stdin")
    parser.add_argument("--horizons", nargs="+", type=int, help="Requested integer seconds, default 1..30")
    parser.add_argument("--alerts", action="store_true", help="Also return 30-second threshold alert flags")
    parser.add_argument("--model-dir", help="Optional directory with config.json and frozen model files")
    args = parser.parse_args()
    try:
        if args.input == "-":
            records = json.load(sys.stdin)
        else:
            records = _read(Path(args.input))
        result = Forecaster(args.model_dir).predict(records, args.horizons, args.alerts)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, allow_nan=False))
