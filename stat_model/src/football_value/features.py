"""Ordered input features for the frozen 30-second forecasts."""
MINIMAL = (
    "goal_distance_m", "goal_angle_rad", "lateral_squared",
    "is_pass", "forward_progress_m", "move_speed_mps", "is_cross",
    "recent_5s_count", "recent_5s_forward_m", "under_pressure",
    "ability_finishing", "ability_passing", "ability_dribbling",
)
