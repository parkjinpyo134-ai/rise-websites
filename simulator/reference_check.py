"""Compare JS geometry to extracted notebook functions without running other cells."""
import ast
import json
import math
from pathlib import Path
import random
import subprocess
from types import SimpleNamespace

root = Path(__file__).resolve().parent.parent
notebook = json.loads((root / 'colab' / 'RISE_simulation_export.ipynb').read_text(encoding='utf-8-sig'))
names = {'clip_slanted_line_to_slab', 'calculate_layout_cut_lines'}
namespace = {'math': math, 'np': SimpleNamespace(clip=lambda x, lo, hi: max(lo, min(hi, x))),
             'SLAB_WIDTH_MM': 300.0, 'SLAB_HEIGHT_MM': 60.0, 'GEOMETRY_TOLERANCE': 1e-9}
found = set()
for cell in notebook['cells']:
    source = ''.join(cell.get('source', []))
    if cell['cell_type'] != 'code' or not any(f'def {name}(' in source for name in names):
        continue
    for node in ast.parse(source).body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            exec(compile(ast.Module(body=[node], type_ignores=[]), '<notebook geometry>', 'exec'), namespace)
            found.add(node.name)
assert found == names
rng = random.Random(42)
cases = [{'w': 30, 'h': 20, 'theta': 90}, {'w': 40, 'h': 20, 'theta': 70},
         {'w': 20, 'h': 10, 'theta': 90}, {'w': 60, 'h': 60, 'theta': 90},
         {'w': 37.125, 'h': 17.75, 'theta': 43.123}, {'w': 300, 'h': 60, 'theta': .001}]
cases += [{'w': rng.uniform(8, 140), 'h': rng.uniform(5, 60), 'theta': rng.uniform(10, 89.999)} for _ in range(50)]
script = "const fs=require('fs'),m=require('./prototype/model.js');const cases=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(cases.map(c=>m.generateLayout(c).lines)));"
result = subprocess.run(['node', '-e', script], input=json.dumps(cases), text=True, encoding='utf-8', capture_output=True, check=True, cwd=root)
actual = json.loads(result.stdout)
for case, lines in zip(cases, actual):
    horizontal, slanted = namespace['calculate_layout_cut_lines'](case['w'], case['h'], case['theta'])
    expected = [[0, y, 300, y] for y in horizontal] + [list(line) for line in slanted]
    assert len(expected) == len(lines), (case, len(expected), len(lines))
    for ref, line in zip(expected, lines):
        got = [line['a']['x'], line['a']['y'], line['b']['x'], line['b']['y']]
        reverse = got[2:] + got[:2]
        assert min(max(abs(a - b) for a, b in zip(ref, got)), max(abs(a - b) for a, b in zip(ref, reverse))) < 1e-7, (case, ref, got)
print(f'PASS: JS cut coordinates match original notebook functions for {len(cases)} designs.')
