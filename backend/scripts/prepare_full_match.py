"""Stream downloaded full-match GSR/BAS into compact, half-specific web replays.
Original 25 fps data is preserved. The derived positions are sampled at 1 Hz.
"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
import ijson

ROOT = Path(__file__).resolve().parent.parent / 'data/soccertrack-full/117092'
OUT = ROOT / 'prepared'
LABELS = {s.upper(): s for s in ['Pass', 'Drive', 'Header', 'High Pass', 'Out', 'Cross', 'Throw In', 'Shot', 'Ball Player Block', 'Player Successful Tackle', 'Free Kick', 'Goal']}

def write(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bas = json.loads((ROOT / 'bas/117092/117092_12_class_events.json').read_text())
    actions = bas.get('actions', bas.get('annotations', []))
    summary = {'matchId': '117092', 'source': 'SoccerTrack v2 v1.2', 'license': 'CC BY 4.0', 'derivedSampleFps': 1, 'halves': []}
    identities = {}
    for half, suffix in [(1, '1st'), (2, '2nd')]:
        path = ROOT / f'gsr/117092/117092_{suffix}.json'
        with path.open('rb') as source:
            info = next(ijson.items(source, 'info', use_float=True))
        fps = float(info['frame_rate'])
        image_count, origin, last = 0, None, None
        with path.open('rb') as source:
            for image in ijson.items(source, 'images.item', use_float=True):
                image_id = int(image.get('image_id', image.get('id')))
                origin = image_id if origin is None else min(origin, image_id)
                last = image_id if last is None else max(last, image_id)
                image_count += 1
        duration = (last - origin + 1) / fps
        groups = defaultdict(dict)
        counts = Counter()
        roster = {}
        object_count, invalid, sampled = 0, 0, 0
        first_object_frame = None
        print(f'Half {half}: streaming {image_count} source frames ({duration:.2f}s)...', flush=True)
        with path.open('rb') as source:
            for row in ijson.items(source, 'annotations.item', use_float=True):
                if row.get('supercategory') != 'object':
                    continue
                object_count += 1
                image_id = int(row['image_id'])
                attrs = row.get('attributes', {})
                role, team = attrs.get('role'), attrs.get('team_side', attrs.get('team'))
                # Keep on-field players and officials; do not invent missing entities.
                if role not in ('player', 'goalkeeper', 'referee'):
                    continue
                raw_id = attrs.get('player_id')
                player_id = str(raw_id) if raw_id is not None else f'h{half}-track-{row["track_id"]}'
                pitch = row.get('bbox_pitch', {})
                x, y = pitch.get('x_bottom_middle'), pitch.get('y_bottom_middle')
                if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
                    invalid += 1
                    continue
                if role in ('player', 'goalkeeper'):
                    counts[image_id] += 1
                jersey = attrs.get('jersey_number', attrs.get('jersey'))
                number = int(jersey) if jersey is not None and str(jersey).isdigit() else None
                player = {'id': player_id, 'number': number, 'team': team, 'role': role, 'x': round(x, 3), 'y': round(y, 3)}
                roster[player_id] = {k: v for k, v in player.items() if k not in ('x', 'y')}
                if first_object_frame is None:
                    first_object_frame = image_id
                if image_id == first_object_frame or (image_id - origin) % round(fps) == 0 or image_id == last:
                    groups[image_id][player_id] = player
                    sampled += 1
        frames = [{'t': round((image_id - origin) / fps, 6), 'players': list(players.values())} for image_id, players in sorted(groups.items())]
        metadata = {'matchId': '117092', 'half': half, 'synthetic': False, 'duration': duration, 'sourceFps': fps, 'sampleFps': 1, 'source': 'SoccerTrack v2 v1.2', 'license': 'CC BY 4.0'}
        events = []
        for index, action in enumerate(actions):
            if int(action['gameTime'].split(' - ')[0]) != half:
                continue
            label = LABELS.get(action['label'].upper())
            if label is None:
                raise ValueError('Unknown BAS action label: ' + action['label'])
            t = int(action['position']) / 1000
            if not 0 <= t < duration:
                raise ValueError(f'BAS action outside half {half}: {t}')
            # Preserve real outcomes as unknown; event labels do not establish success.
            events.append({**action, 'label': label, 'pass_complete': None})
        missing_ids = sorted({str(e['player_id']) for e in events if e.get('player_id') is not None} - roster.keys())
        min_count = min(counts.values()) if counts else 0
        half_report = {**metadata, 'sourceFrames': image_count, 'sourceObjectAnnotations': object_count, 'sampledFrames': len(frames), 'firstPositionSeconds': frames[0]['t'], 'lastPositionSeconds': frames[-1]['t'], 'uniquePlayerIdentities': sum(p['role'] != 'referee' for p in roster.values()), 'uniqueOfficials': sum(p['role'] == 'referee' for p in roster.values()), 'sourceFramesWithNoPlayerAnnotation': image_count - len(counts), 'minPlayersPerAnnotatedFrame': min_count, 'maxPlayersPerAnnotatedFrame': max(counts.values()) if counts else 0, 'sourceFramesWithExactly22Players': sum(n == 22 for n in counts.values()), 'events': len(events), 'firstEventSeconds': min(int(e['position']) / 1000 for e in events), 'lastEventSeconds': max(int(e['position']) / 1000 for e in events), 'unmatchedEventPlayerIds': missing_ids, 'invalidCoordinateRecords': invalid}
        write(OUT / f'117092_{suffix}_gsr.json', {**metadata, 'frames': frames})
        write(OUT / f'117092_{suffix}_bas.json', {**metadata, 'annotations': events})
        profiles = [{'id': p['id'], 'name': f'{"Left" if p["team"] == "left" else "Right"} team #{p["number"]}' if p['number'] is not None else f'Player {p["id"]}', 'position': 'Goalkeeper' if p['role'] == 'goalkeeper' else 'Position not provided', 'number': p['number'], 'team': p['team'], 'history': [], 'source': 'SoccerTrack v2: pseudonymous jersey identity; no historical profile'} for p in roster.values() if p['role'] != 'referee']
        write(OUT / f'117092_{suffix}_profiles.json', {**metadata, 'profiles': profiles})
        summary['halves'].append(half_report)
        identities[half] = roster
        print(f'Half {half}: {len(frames)} web frames, {len(events)} events, {len(missing_ids)} unmatched actor IDs.', flush=True)
    summary['recordedSeconds'] = sum(h['duration'] for h in summary['halves'])
    summary['notes'] = ['Two released halves; no fabricated padding to exactly 90 minutes.', 'Original source GSR remains at 25 fps; web derivative samples at 1 Hz and rounds coordinates to 0.001 m.', 'Source frame counts include missing player observations; not every frame necessarily contains 22 players.', 'No ball measurement, pass outcome, pressure or player history has been invented.', 'Team sides and player IDs are presented independently per half; no unverified cross-half identity or team linkage is asserted.']
    write(OUT / 'coverage-report.json', summary)
    print(json.dumps(summary, indent=2), flush=True)

if __name__ == '__main__':
    main()
