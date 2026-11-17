# RISE 웹사이트

- [절단 시뮬레이터](simulator/index.html): 설계 JSON을 불러와 절단 과정과 모터 동작을 확인합니다.
- [결과물 한눈에 보기](results/index.html): 설계별 사진, 배치도, GIF와 실제 구동 영상 16개를 확인합니다.

## 웹에서 실행

- [시뮬레이터](https://parkjinpyo134-ai.github.io/rise-websites/simulator/)
- [결과물 한눈에 보기](https://parkjinpyo134-ai.github.io/rise-websites/results/)

## 로컬 실행
저장소 전체를 다운로드하고 압축을 푼 뒤 각 폴더의 `index.html`을 브라우저로 여세요. 결과물 뷰어는 오프라인 실행을 지원합니다. 시뮬레이터의 웹폰트는 인터넷 연결 시 표시됩니다.

저장소에는 영상과 이미지가 포함되어 약 570MB입니다. GitHub 저장소의 HTML 파일 화면은 홈페이지 실행 화면이 아닙니다. 웹사이트는 GitHub Pages로 배포합니다.

## 검증

`node --test simulator/motor.test.cjs simulator/multi-pass.test.cjs simulator/python-plan.test.cjs simulator/production-playback.test.cjs simulator/top-down-motion.test.cjs`

33개 통과, 0개 실패. 별도 최적화 실험 산출물이 필요한 2개 검사는 건너뜁니다. `bench-plan`과 `profile-plan` 검사는 원본 연구 프로젝트의 Python 환경과 보정 파일이 필요합니다.
