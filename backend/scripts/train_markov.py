"""Fit an absorbing location-only pass/shot Markov chain. No dependencies."""
import argparse
import json
import math
from pathlib import Path


def records(path):
    decoder = json.JSONDecoder()
    with path.open() as source:
        buf = ''
        while True:
            buf = buf.lstrip(' \r\n\t[,')
            if buf.startswith(']'):
                return
            try:
                row, end = decoder.raw_decode(buf)
            except json.JSONDecodeError:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    if buf.strip():
                        raise ValueError('Incomplete JSON event array')
                    return
                buf += chunk
                continue
            yield row
            buf = buf[end:]


def train(source, out, nx=16, ny=12):
    n = nx * ny
    counts, goals, shots, passes, completed = [[0] * n for _ in range(5)]
    transitions = [[0] * n for _ in range(n)]
    games = set()
    def zone(p):
        x, y = float(p['x']), float(p['y'])
        if not math.isfinite(x + y):
            raise ValueError('Invalid event location')
        return min(ny - 1, max(0, int(y / 100 * ny))) * nx + min(nx - 1, max(0, int(x / 100 * nx)))
    for e in records(source):
        if e.get('eventName') not in ('Pass', 'Shot') or not e.get('positions'):
            continue
        i = zone(e['positions'][0])
        tags = {t['id'] for t in e.get('tags', [])}
        if e['eventName'] == 'Pass' and len(e['positions']) < 2:
            continue
        games.add(e['matchId'])
        counts[i] += 1
        if e['eventName'] == 'Shot':
            shots[i] += 1
            goals[i] += int(101 in tags)
        else:
            passes[i] += 1
            if 1801 in tags:
                completed[i] += 1
                transitions[i][zone(e['positions'][1])] += 1
    q = [[v / counts[i] if counts[i] else 0 for v in row] for i, row in enumerate(transitions)]
    g = [goals[i] / counts[i] if counts[i] else 0 for i in range(n)]
    values = [0.] * n
    for iteration in range(10000):
        nxt = [g[i] + sum(p * v for p, v in zip(q[i], values)) for i in range(n)]
        residual = max(abs(a-b) for a,b in zip(nxt, values))
        values = nxt
        if residual < 1e-12:
            break
    assert residual < 1e-10, 'Value iteration did not converge'
    assert all(0 <= v <= 1 for v in values)
    assert all(sum(q[i]) + g[i] <= 1 + 1e-10 for i in range(n))
    model = {'nx': nx, 'ny': ny, 'values': values, 'transition': q,
             'goalProbability': g, 'counts': counts, 'shots': shots, 'goals': goals,
             'passes': passes, 'completed': completed,
             'meta': {'source': source.name, 'matches': len(games), 'actions': sum(counts),
                      'iterations': iteration+1, 'residual': residual,
                      'equation': 'V = g + QV', 'direction': 'attack left to right',
                      'scope': 'Pass and shot actions only. Failed passes and non-goal shots terminate the modeled possession. Rebounds, carries, defenders and player skill are not modeled. No held-out calibration.',
                      'citation': 'Pappalardo et al. (2019). doi:10.1038/s41597-019-0247-7'}}
    out.write_text(json.dumps(model, separators=(',', ':')))
    print(f'{len(games)} matches, {sum(counts)} actions; {iteration+1} iterations; residual {residual:.2g}; maximum {max(values):.3%}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('../events/events_England.json'))
    parser.add_argument('--out', type=Path, default=Path('markov-model.json'))
    a = parser.parse_args()
    train(a.source, a.out)
