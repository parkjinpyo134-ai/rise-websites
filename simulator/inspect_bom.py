from pathlib import Path
import openpyxl
p = Path('C:/Users/jinpy/OneDrive/바탕 화면/대학원/RISE_ICT_Project/KAISTONE_스마트팩토리_통합_BOM_정리본.xlsx')
w = openpyxl.load_workbook(p, read_only=True, data_only=True)
for s in w:
    print('SHEET', s.title, s.max_row, s.max_column)
    for row_number, row in enumerate(s.iter_rows(), 1):
        parts = [f'{c.coordinate}={c.value}' for c in row if c.value is not None]
        text = ' | '.join(parts)
        if row_number <= 5 or any(k in text.lower() for k in ['스크류','리드','모터','스텝','펄스','리미트','motor','screw','lead','1600','t8']): print(text)
w.close()

